// server/systems/CombatSystem.js
// Multiplayer wrapper around shared/logic/combat.js.

import {
  resolveAttack, applyDamage, rollDice,
  getModifier, getProficiencyBonus, pickAttackMode, sneakAttackEligibility,
} from '../../shared/logic/combat.js';
import { isLineBlocked, platformPerimeterRects } from '../../shared/logic/geometry.js';
import { computeKnockbackPx, resolveKnockback } from '../../shared/logic/knockback.js';
import {
  ATTACK_COOLDOWN_MS, MELEE_HIT_RANGE_PX, ADJACENT_FOE_PX, RAGE_DAMAGE_BONUS,
  KI_ABILITY_COST, OPEN_HAND_STAGGER_MS,
  SNEAK_ATTACK_DIE_SIDES, ALLY_ADJACENT_PX, CRIT_MULTIPLIER,
  WALL_SLAM_DAMAGE_RATIO,
} from '../../shared/data/constants.js';
import { WEAPON_REGISTRY, UNARMED } from '../../shared/data/weapons/index.js';
import { SHIELD_REGISTRY } from '../../shared/data/items/shields.js';
import { CLASS_REGISTRY, DEFAULT_CLASS } from '../../shared/data/classes/index.js';
import {
  getDerivedClassFeatures, getClassLevel, getGrantedFeatures, getSneakAttackDice,
  getKnockbackProfile,
} from '../../shared/logic/class-progression.js';

// Monk weapons: unarmed strikes and light/simple melee weapons per SRD.
const MONK_WEAPON_IDS = new Set(['shortsword', 'dagger', 'handaxe', 'mace', 'unarmed', '']);

function getWeapon(equippedWeaponId) {
  // Empty/unknown slot → UNARMED (the registry intentionally excludes 'unarmed'
  // since it's a fallback, not an equippable item).
  return WEAPON_REGISTRY[equippedWeaponId] ?? UNARMED;
}

/**
 * Versatile weapons deal 1d10 (instead of 1d8) when no offhand item is equipped —
 * the player is gripping two-handed.
 */
function getEffectiveWeapon(weapon, player) {
  if (weapon.properties?.includes('versatile') && !player.offhandId) {
    return { ...weapon, damageDice: { count: 1, sides: 10 } };
  }
  return weapon;
}

/**
 * Dueling fighting style: +2 damage when wielding a one-handed melee weapon
 * and offhand holds no weapon (empty or shield are both fine — SRD rule).
 */
function applyDueling(weapon, player, fightingStyle) {
  if (fightingStyle !== 'dueling') return weapon;
  if (weapon.properties?.includes('two-handed')) return weapon;
  if (weapon.id === 'unarmed') return weapon;
  // Dueling bonus is lost when dual-wielding (another weapon in offhand).
  const offhandIsWeapon = player.offhandId && !SHIELD_REGISTRY[player.offhandId];
  if (offhandIsWeapon) return weapon;
  return { ...weapon, damageBonus: (weapon.damageBonus ?? 0) + 2 };
}

/**
 * Build a short "d20:14 +2p +3str = 19" roll string.
 * Shows proficiency and ability mod separately so players can verify the math.
 * Surfaces the resolved roll mode + winning sources ("adv: 14, 5 — high-ground"
 * or "dis: 5, 14 — long range, foe adjacent") so players see why.
 */
function rollStr(result, profBonus, abilityMod, abilityKey) {
  let dieLabel;
  if (result.rollMode === 'advantage' && result.advantageRolls) {
    const reasons = result.rollModeSources?.map(s => s.reason).join(', ');
    dieLabel = `d20:${result.rawD20} [adv: ${result.advantageRolls[0]}, ${result.advantageRolls[1]}${reasons ? ` — ${reasons}` : ''}]`;
  } else if (result.rollMode === 'disadvantage' && result.advantageRolls) {
    const reasons = result.rollModeSources?.map(s => s.reason).join(', ');
    dieLabel = `d20:${result.rawD20} [dis: ${result.advantageRolls[0]}, ${result.advantageRolls[1]}${reasons ? ` — ${reasons}` : ''}]`;
  } else {
    dieLabel = `d20:${result.rawD20}`;
  }
  const parts = [dieLabel];
  if (profBonus !== 0) parts.push(`${profBonus >= 0 ? '+' : ''}${profBonus}p`);
  if (abilityMod !== 0) parts.push(`${abilityMod >= 0 ? '+' : ''}${abilityMod}${abilityKey}`);
  if (result.conditionBonus) parts.push(`+${result.conditionBonus}bls`);
  parts.push(`= ${result.roll}`);
  return parts.join(' ');
}

/**
 * Attempt a player attack against the nearest living enemy in melee range.
 * Accepts enemyDefs so enemy resistances are respected in damage resolution.
 * If a weapon is in the offhand (Two-Weapon Fighting), also makes a bonus attack
 * with it — no ability modifier to damage unless negative (SRD rule).
 *
 * Returns { hit, crit, damage, targetId, logs: string[] }.
 *
 * @param {Map} [enemyDefs] - Map of enemyId → enemy definition (for resistances)
 */
export function playerAttack(state, sessionId, enemyDefs = new Map(), targetId = null, geometry = null) {
  const player = state.players.get(sessionId);
  if (!player || !player.alive) return { hit: false, crit: false, damage: 0, targetId: null, logs: [] };
  if (player.attackCooldownMs > 0) return { hit: false, crit: false, damage: 0, targetId: null, logs: [] };

  // Equipped weapon dictates whether a target is required and how dispatch works.
  const equippedWeapon = getWeapon(player.equippedWeaponId);
  const isRangedWeapon = equippedWeapon.type === 'ranged';

  // Target resolution. Explicit targetId always validated. Missing targetId is
  // only legal for melee weapons (nearest-enemy fallback); ranged refuses.
  let target;
  if (targetId) {
    const enemy = state.enemies.get(String(targetId));
    if (!enemy || !enemy.alive) {
      return { hit: false, crit: false, damage: 0, targetId: null, logs: [], denied: 'invalid_target' };
    }
    target = { id: String(targetId), state: enemy };
  } else if (isRangedWeapon) {
    return { hit: false, crit: false, damage: 0, targetId: null, logs: [], denied: 'no_target' };
  } else {
    target = nearestLivingEnemy(state, player);
    if (!target) return { hit: false, crit: false, damage: 0, targetId: null, logs: [] };
  }

  // Dispatch: melee vs ranged vs thrown vs out-of-range.
  const distance = dist2d(player.x, player.y, target.state.x, target.state.y);
  const mode = pickAttackMode(equippedWeapon, distance);
  if (mode === null) {
    return { hit: false, crit: false, damage: 0, targetId: null, logs: [], denied: 'out_of_range' };
  }
  if (mode === 'thrown') {
    // TODO(deferred): thrown weapons sprint — reach this branch when a melee
    // weapon with a `thrown` sub-block is equipped and the target is beyond
    // melee range. No weapon ships with `thrown` today.
    return { hit: false, crit: false, damage: 0, targetId: null, logs: [], denied: 'invalid_target' };
  }

  // LoS gate (ranged only). Caller passes pre-filtered obstacle rects:
  // walls + locked-door rects only. Platforms never block.
  if (mode === 'ranged' && geometry?.obstacles) {
    if (isLineBlocked(player.x, player.y, target.state.x, target.state.y, geometry.obstacles)) {
      return { hit: false, crit: false, damage: 0, targetId: null, logs: [], denied: 'no_line_of_sight' };
    }
  }

  const logs      = [];
  const tLabel    = target.state.type || 'enemy';
  const derived   = getDerivedClassFeatures(player);
  const attacker  = playerToAttacker(player, derived);
  const profBonus = getProficiencyBonus(attacker.level);

  // Look up the target's damage traits from the enemy definition (not in schema).
  const enemyDef          = enemyDefs.get(target.id) ?? {};
  const targetResistances = enemyDef.resistances ?? [];
  const targetDR          = enemyDef.damageReduction ?? null;

  // ── Main hand attack ────────────────────────────────────────────────────────
  const classDef = CLASS_REGISTRY[player.class] ?? DEFAULT_CLASS;
  const pLabel   = player.class ? player.class[0].toUpperCase() + player.class.slice(1) : 'Player';

  let baseWeapon = equippedWeapon;
  if (player.conditions.includes('rage') && mode === 'melee') {
    // Rage damage bonus is melee-only per SRD.
    baseWeapon = { ...baseWeapon, damageBonus: (baseWeapon.damageBonus ?? 0) + RAGE_DAMAGE_BONUS };
  }
  // Dueling and versatile two-handed apply to melee only.
  const weapon = mode === 'melee'
    ? applyDueling(getEffectiveWeapon(baseWeapon, player), player, derived.fightingStyle)
    : baseWeapon;

  const isFinesse   = weapon.properties?.includes('finesse');
  const strMod      = getModifier(attacker.abilityScores.str);
  const dexMod      = getModifier(attacker.abilityScores.dex);
  // Ranged weapons use their declared attackAbility (DEX for bows).
  // Melee weapons: finesse picks higher of STR/DEX; else attackAbility.
  let mainAbilMod, mainAbilKey;
  if (mode === 'ranged') {
    mainAbilKey = weapon.attackAbility;
    mainAbilMod = getModifier(attacker.abilityScores[mainAbilKey]);
  } else if (isFinesse && dexMod > strMod) {
    mainAbilMod = dexMod;
    mainAbilKey = 'dex';
  } else {
    mainAbilMod = strMod;
    mainAbilKey = 'str';
  }

  // Source assembly: high-ground advantage (any mode), reckless advantage
  // (melee only — SRD), long-range and foe-adjacent disadvantage (ranged only).
  const sources = [];
  if (player.elevation === 1 && target.state.elevation === 0) {
    sources.push({ kind: 'advantage', reason: 'high-ground' });
  }
  if (mode === 'melee' && player.conditions.includes('reckless')) {
    sources.push({ kind: 'advantage', reason: 'reckless' });
  }
  if (mode === 'ranged') {
    if (weapon.range && distance > weapon.range.normal) {
      sources.push({ kind: 'disadvantage', reason: 'long range' });
    }
    if (_anyOtherEnemyAdjacent(state, player, target.id)) {
      sources.push({ kind: 'disadvantage', reason: 'foe adjacent' });
    }
  }

  // Sneak Attack (Rogue): once per Attack event, the first eligible hit (main
  // hand, else offhand) carries the sneak dice. Eligibility is the pure helper
  // in shared/logic/combat.js; movement is sampled at resolution time.
  const sneakDiceCount = getSneakAttackDice(player);
  const sneakCtx = sneakDiceCount > 0 ? {
    allyAdjacent:   _anyAllyAdjacent(state, sessionId, target.state),
    skirmish:       derived.skirmish,
    attackerMoving: player.vx !== 0 || player.vy !== 0,
    targetMoving:   target.state.vx !== 0 || target.state.vy !== 0,
  } : null;
  let sneakSpent = false;

  const result = resolveAttack({ attacker, target: enemyToTarget(target.state, targetResistances, targetDR), weapon, sources });

  if (result.hit) {
    let mainDamage = result.damage;
    let sneakTag   = '';
    if (sneakCtx && !sneakSpent) {
      const reason = sneakAttackEligibility({ weapon, rollMode: result.rollMode, ...sneakCtx });
      if (reason) {
        // Sneak dice double on a crit (SRD: all dice of the attack are doubled).
        const sneakDamage = rollDice(sneakDiceCount * (result.crit ? CRIT_MULTIPLIER : 1), SNEAK_ATTACK_DIE_SIDES);
        mainDamage += sneakDamage;
        sneakSpent  = true;
        sneakTag    = ` (sneak +${sneakDamage} — ${reason})`;
      }
    }
    const applied = applyDamage({
      target: enemyToTarget(target.state, targetResistances, targetDR),
      damage: mainDamage,
      damageType: weapon.damageType,
    });
    target.state.hp = applied.newHP;
    if (target.state.hp <= 0) {
      target.state.hp = 0;
      target.state.alive = false;
      target.state.vx    = 0;
      target.state.vy    = 0;
      player.kills += 1;
    }
    // Knockback: melee hits shove; the killing blow doesn't (corpses stay put).
    let kbTag = '';
    if (mode === 'melee' && target.state.alive) {
      kbTag = _applyKnockbackToEnemy(state, player, target.state, enemyDef, applied.finalDamage, geometry?.terrain);
    }
    const tag = _damageTag(applied, result.crit);
    logs.push(`${pLabel} → ${tLabel}: hit (${rollStr(result, profBonus, mainAbilMod, mainAbilKey)} vs AC ${target.state.ac}), ${mainDamage}${tag} ${weapon.damageType}${sneakTag}${kbTag}`);
  } else {
    logs.push(`${pLabel} → ${tLabel}: miss (${rollStr(result, profBonus, mainAbilMod, mainAbilKey)} vs AC ${target.state.ac})`);
  }

  // ── Offhand attack (Two-Weapon Fighting) ────────────────────────────────────
  // Melee-only. Two-handed bows can't have an offhand weapon equipped anyway,
  // but the mode gate keeps the path explicit.
  // Offhand attack does NOT add the ability modifier to damage unless the
  // modifier is negative (standard SRD Two-Weapon Fighting rule). No Dueling.
  const offhandId = player.offhandId;
  if (mode === 'melee' && offhandId && WEAPON_REGISTRY[offhandId] && target.state.alive) {
    const offWeapon = WEAPON_REGISTRY[offhandId];

    const offIsFinesse = offWeapon.properties?.includes('finesse');
    const offAbilMod   = offIsFinesse && dexMod > strMod ? dexMod : strMod;
    const offAbilKey   = offIsFinesse && dexMod > strMod ? 'dex' : 'str';

    const offResult = resolveAttack({ attacker, target: enemyToTarget(target.state, targetResistances, targetDR), weapon: offWeapon, sources });

    // TWF: remove positive ability mod from damage (SRD rule).
    let offRawDamage = offResult.damage;
    if (offResult.hit && offAbilMod > 0) {
      offRawDamage = Math.max(1, offRawDamage - offAbilMod);
    }

    // Sneak Attack still available if the main hand missed or wasn't eligible
    // (the SRD once-per-turn rule — offhand fishing is the classic Rogue play).
    let offSneakTag = '';
    if (offResult.hit && sneakCtx && !sneakSpent) {
      const reason = sneakAttackEligibility({ weapon: offWeapon, rollMode: offResult.rollMode, ...sneakCtx });
      if (reason) {
        const sneakDamage = rollDice(sneakDiceCount * (offResult.crit ? CRIT_MULTIPLIER : 1), SNEAK_ATTACK_DIE_SIDES);
        offRawDamage += sneakDamage;
        sneakSpent    = true;
        offSneakTag   = ` (sneak +${sneakDamage} — ${reason})`;
      }
    }

    if (offResult.hit) {
      const applied = applyDamage({
        target: enemyToTarget(target.state, targetResistances, targetDR),
        damage: offRawDamage,
        damageType: offWeapon.damageType,
      });
      target.state.hp = applied.newHP;
      if (target.state.hp <= 0) {
        target.state.hp = 0;
        target.state.alive = false;
        target.state.vx    = 0;
        target.state.vy    = 0;
        player.kills += 1;
      }
      let offKbTag = '';
      if (target.state.alive) {
        offKbTag = _applyKnockbackToEnemy(state, player, target.state, enemyDef, applied.finalDamage, geometry?.terrain);
      }
      const tag = _damageTag(applied, offResult.crit);
      logs.push(`${pLabel} [off] → ${tLabel}: hit (${rollStr(offResult, profBonus, offAbilMod, offAbilKey)} vs AC ${target.state.ac}), ${offRawDamage}${tag} ${offWeapon.damageType}${offSneakTag}${offKbTag}`);
    } else {
      logs.push(`${pLabel} [off] → ${tLabel}: miss (${rollStr(offResult, profBonus, offAbilMod, offAbilKey)} vs AC ${target.state.ac})`);
    }
  }

  // ── Berserker Frenzy bonus weapon attack ────────────────────────────────────
  // One extra main-weapon attack per Attack event while raging (GDD Berserker).
  if (mode === 'melee' && derived.frenzy && player.conditions.includes('rage') && target.state.alive) {
    const fzResult = resolveAttack({ attacker, target: enemyToTarget(target.state, targetResistances, targetDR), weapon, sources });
    if (fzResult.hit) {
      const applied = applyDamage({
        target: enemyToTarget(target.state, targetResistances, targetDR),
        damage: fzResult.damage,
        damageType: weapon.damageType,
      });
      target.state.hp = applied.newHP;
      if (target.state.hp <= 0) {
        target.state.hp    = 0;
        target.state.alive = false;
        target.state.vx    = 0;
        target.state.vy    = 0;
        player.kills += 1;
      }
      let fzKbTag = '';
      if (target.state.alive) {
        fzKbTag = _applyKnockbackToEnemy(state, player, target.state, enemyDef, applied.finalDamage, geometry?.terrain);
      }
      const tag = _damageTag(applied, fzResult.crit);
      logs.push(`${pLabel} [frenzy] → ${tLabel}: hit (${rollStr(fzResult, profBonus, mainAbilMod, mainAbilKey)} vs AC ${target.state.ac}), ${fzResult.damage}${tag} ${weapon.damageType}${fzKbTag}`);
    } else {
      logs.push(`${pLabel} [frenzy] → ${tLabel}: miss (${rollStr(fzResult, profBonus, mainAbilMod, mainAbilKey)} vs AC ${target.state.ac})`);
    }
  }

  // ── Martial Arts bonus unarmed strike ────────────────────────────────────────
  // Triggers when a character with any Monk level attacks unarmored, no shield,
  // with a monk weapon (post-multiclass: the feature follows monk levels, not
  // the primary class).
  const hasShieldEquipped = !!SHIELD_REGISTRY[player.offhandId];
  if (
    mode === 'melee' &&
    getClassLevel(player, 'monk') >= 1 &&
    !player.equippedArmorId &&
    !hasShieldEquipped &&
    MONK_WEAPON_IDS.has(player.equippedWeaponId) &&
    target.state.alive
  ) {
    const maWeapon  = { ...UNARMED, properties: [...(UNARMED.properties ?? []), 'finesse'] };
    const maAbilMod = dexMod > strMod ? dexMod : strMod;
    const maAbilKey = dexMod > strMod ? 'dex' : 'str';

    const maResult = resolveAttack({ attacker, target: enemyToTarget(target.state, targetResistances, targetDR), weapon: maWeapon, sources });

    if (maResult.hit) {
      const applied = applyDamage({
        target: enemyToTarget(target.state, targetResistances, targetDR),
        damage: maResult.damage,
        damageType: maWeapon.damageType,
      });
      target.state.hp = applied.newHP;
      if (target.state.hp <= 0) {
        target.state.hp    = 0;
        target.state.alive = false;
        target.state.vx    = 0;
        target.state.vy    = 0;
        player.kills += 1;
      }
      let maKbTag = '';
      if (target.state.alive) {
        maKbTag = _applyKnockbackToEnemy(state, player, target.state, enemyDef, applied.finalDamage, geometry?.terrain);
      }
      const tag = _damageTag(applied, maResult.crit);
      logs.push(`${pLabel} [MA] → ${tLabel}: hit (${rollStr(maResult, profBonus, maAbilMod, maAbilKey)} vs AC ${target.state.ac}), ${maResult.damage}${tag} ${maWeapon.damageType}${maKbTag}`);
    } else {
      logs.push(`${pLabel} [MA] → ${tLabel}: miss (${rollStr(maResult, profBonus, maAbilMod, maAbilKey)} vs AC ${target.state.ac})`);
    }
  }

  // For ranged attacks, return a projectile-fire descriptor that the room
  // handler broadcasts as `projectile_fired`. Style is per-weapon; bows = arrow.
  // Future ranged weapons / spells set their own style ('bolt', 'firebolt', ...).
  let projectile = null;
  if (mode === 'ranged') {
    projectile = {
      attackerId: sessionId,
      fromX: player.x, fromY: player.y,
      toX: target.state.x, toY: target.state.y,
      hit:  result.hit,
      style: 'arrow', // shortbow + longbow both use the arrow visual
    };
  }

  player.attackCooldownMs = ATTACK_COOLDOWN_MS;
  return { hit: result.hit, crit: result.crit, damage: result.damage, targetId: target.id, logs, projectile };
}

/**
 * Build the obstacle rects a knockback target collides with: walls + locked
 * doors always; platform perimeter rects only when the target is at elevation
 * 0 — knockback never shoves anyone UP a platform wall (climbing is
 * voluntary), which is exactly what makes platform side-walls slammable.
 * See docs/design/dynamic-combat.md §Pillar 1.
 */
function _knockbackObstacles(state, terrain, targetElevation) {
  const rects = [...(terrain?.walls ?? [])];
  if (state.doors) {
    for (const [, door] of state.doors) {
      if (door.locked) rects.push({ x: door.x, y: door.y, w: door.w, h: door.h });
    }
  }
  if (targetElevation === 0) {
    for (const p of terrain?.platforms ?? []) {
      for (const r of platformPerimeterRects(p)) rects.push(r);
    }
  }
  return rects;
}

/**
 * Shove a just-hit enemy away from the attacking player (melee hits only).
 * Mutates the enemy's position/elevation; a wall slam deals half again the
 * hit's damage and can kill (credited to the attacker). Returns a combat-log
 * suffix ('' when nothing notable happened).
 */
function _applyKnockbackToEnemy(state, player, targetState, enemyDef, damageDealt, terrain) {
  const profile = getKnockbackProfile(player); // attacker side — shield irrelevant
  const px = computeKnockbackPx({
    attackerLevel:   player.level,
    targetLevel:     enemyDef.level ?? 1,
    bonusPx:         profile.bonusPx,
    bonusClassLevel: profile.bonusClassLevel,
  });
  const kb = resolveKnockback({
    fromX: player.x, fromY: player.y, target: targetState, distancePx: px,
    obstacles: _knockbackObstacles(state, terrain, targetState.elevation),
    platforms: terrain?.platforms ?? [],
    bounds:    terrain?.bounds ?? null,
  });
  targetState.x = kb.x;
  targetState.y = kb.y;
  if (kb.elevation !== targetState.elevation) targetState.elevation = kb.elevation;
  if (kb.wallSlam) {
    const slam = Math.max(1, Math.floor(damageDealt * WALL_SLAM_DAMAGE_RATIO));
    targetState.hp = Math.max(0, targetState.hp - slam);
    let suffix = ` — slammed into the wall (+${slam})`;
    if (targetState.hp <= 0) {
      targetState.alive = false;
      targetState.vx    = 0;
      targetState.vy    = 0;
      player.kills += 1;
      suffix += ' — killed!';
    }
    return suffix;
  }
  if (kb.droppedElevation) return ' — knocked off the ledge!';
  return '';
}

/**
 * Helper: is any other living player within ALLY_ADJACENT_PX of the target?
 * The SRD Sneak Attack "ally within 5 ft of the target" leg — only players
 * count as allies (enemies are never allies of a player).
 */
function _anyAllyAdjacent(state, attackerSessionId, targetState) {
  for (const [sid, p] of state.players) {
    if (sid === attackerSessionId || !p.alive) continue;
    if (dist2d(p.x, p.y, targetState.x, targetState.y) <= ALLY_ADJACENT_PX) return true;
  }
  return false;
}

/**
 * Helper: is any enemy other than the named target within ADJACENT_FOE_PX of
 * the player? Used for the SRD ranged-into-melee disadvantage rule.
 */
function _anyOtherEnemyAdjacent(state, player, excludeTargetId) {
  for (const [id, enemy] of state.enemies) {
    if (!enemy.alive || id === excludeTargetId) continue;
    if (dist2d(player.x, player.y, enemy.x, enemy.y) <= ADJACENT_FOE_PX) return true;
  }
  return false;
}

/**
 * Enemy attacks the nearest living player. Returns { log }.
 */
export function enemyAttack(state, enemyState, enemyDef, targetPlayer, terrain = null) {
  if (!enemyState.alive || !targetPlayer.alive) return { log: null };
  if (enemyState.attackCooldownMs > 0) return { log: null };

  const attacker = {
    attackBonus: enemyDef.attackBonus,
    damageDice:  enemyDef.damageDice,
    damageBonus: enemyDef.damageBonus,
    conditions:  [],
  };

  // High-ground advantage: enemy on a platform vs player on the ground.
  // Reckless Attack: attacks against a reckless player have advantage (SRD).
  // Patient Defense: attacks against a dodging monk have disadvantage.
  const sources = [];
  if (enemyState.elevation === 1 && targetPlayer.elevation === 0) {
    sources.push({ kind: 'advantage', reason: 'high-ground' });
  }
  if (targetPlayer.conditions?.includes('reckless')) {
    sources.push({ kind: 'advantage', reason: 'reckless target' });
  }
  if (targetPlayer.conditions?.includes('patient_defense')) {
    sources.push({ kind: 'disadvantage', reason: 'patient defense' });
  }

  const result = resolveAttack({ attacker, target: playerToTarget(targetPlayer), weapon: null, sources });

  let kbTag = '';
  if (result.hit) {
    const applied = applyDamage({
      target: playerToTarget(targetPlayer),
      damage: result.damage,
      damageType: enemyDef.damageType,
    });
    // Temp HP absorbs final damage before regular HP (SRD rule).
    let damageToHp = applied.finalDamage;
    if (targetPlayer.tempHp > 0) {
      const absorbed = Math.min(targetPlayer.tempHp, damageToHp);
      targetPlayer.tempHp -= absorbed;
      damageToHp -= absorbed;
    }
    targetPlayer.hp = Math.max(0, targetPlayer.hp - damageToHp);
    if (targetPlayer.hp <= 0) {
      targetPlayer.hp = 0;
      targetPlayer.alive = false;
      targetPlayer.vx = 0;
      targetPlayer.vy = 0;
    }

    // Knockback: enemy melee hits shove the player. Fighter levels brace
    // against it (more with a shield); the killing blow doesn't push.
    if (targetPlayer.alive) {
      const profile = getKnockbackProfile(targetPlayer, !!SHIELD_REGISTRY[targetPlayer.offhandId]);
      const px = computeKnockbackPx({
        attackerLevel:    enemyDef.level ?? 1,
        targetLevel:      targetPlayer.level,
        resistFraction:   profile.resistFraction,
        resistClassLevel: profile.resistClassLevel,
      });
      const kb = resolveKnockback({
        fromX: enemyState.x, fromY: enemyState.y, target: targetPlayer, distancePx: px,
        obstacles: _knockbackObstacles(state, terrain, targetPlayer.elevation),
        platforms: terrain?.platforms ?? [],
        bounds:    terrain?.bounds ?? null,
      });
      targetPlayer.x = kb.x;
      targetPlayer.y = kb.y;
      if (kb.elevation !== targetPlayer.elevation) targetPlayer.elevation = kb.elevation;
      if (kb.wallSlam) {
        let slam = Math.max(1, Math.floor(applied.finalDamage * WALL_SLAM_DAMAGE_RATIO));
        kbTag = ` — slammed into the wall (+${slam})`;
        if (targetPlayer.tempHp > 0) {
          const absorbed = Math.min(targetPlayer.tempHp, slam);
          targetPlayer.tempHp -= absorbed;
          slam -= absorbed;
        }
        targetPlayer.hp = Math.max(0, targetPlayer.hp - slam);
        if (targetPlayer.hp <= 0) {
          targetPlayer.hp = 0;
          targetPlayer.alive = false;
          targetPlayer.vx = 0;
          targetPlayer.vy = 0;
          kbTag += ' — down!';
        }
      } else if (kb.droppedElevation) {
        kbTag = ' — knocked off the ledge!';
      }
    }
  }

  enemyState.attackCooldownMs = ATTACK_COOLDOWN_MS;

  const tLabel = enemyState.type || 'enemy';
  const pLabel = targetPlayer.class ? targetPlayer.class[0].toUpperCase() + targetPlayer.class.slice(1) : 'Player';
  let dieLabel;
  if (result.rollMode === 'advantage' && result.advantageRolls) {
    const reasons = result.rollModeSources?.map(s => s.reason).join(', ');
    dieLabel = `d20:${result.rawD20} [adv: ${result.advantageRolls[0]}, ${result.advantageRolls[1]}${reasons ? ` — ${reasons}` : ''}]`;
  } else if (result.rollMode === 'disadvantage' && result.advantageRolls) {
    const reasons = result.rollModeSources?.map(s => s.reason).join(', ');
    dieLabel = `d20:${result.rawD20} [dis: ${result.advantageRolls[0]}, ${result.advantageRolls[1]}${reasons ? ` — ${reasons}` : ''}]`;
  } else {
    dieLabel = `d20:${result.rawD20}`;
  }
  const log = result.hit
    ? `${tLabel} → ${pLabel}: hit (${dieLabel}+${enemyDef.attackBonus}atk = ${result.roll} vs AC ${targetPlayer.ac}), ${result.damage} ${enemyDef.damageType}${kbTag}`
    : `${tLabel} → ${pLabel}: miss (${dieLabel}+${enemyDef.attackBonus}atk = ${result.roll} vs AC ${targetPlayer.ac})`;

  return { log };
}

/**
 * Use the Second Wind class feature. Returns HP healed, or null if unavailable.
 * SRD: 1d10 + fighter level (class level, not character level).
 */
export function applySecondWind(state, sessionId) {
  const player = state.players.get(sessionId);
  if (!player || !player.alive || !player.secondWindAvailable) return null;
  const fighterLevel = Math.max(1, getClassLevel(player, 'fighter'));
  const heal = rollDice(1, 10) + fighterLevel;
  player.hp = Math.min(player.maxHp, player.hp + heal);
  player.secondWindAvailable = false;
  return heal;
}

/**
 * Use Action Surge (Fighter 2): instantly reset the attack timer. 1/rest.
 * Returns true on success, null if unavailable or the timer is already ready
 * (don't burn the use on a no-op).
 */
export function applyActionSurge(state, sessionId) {
  const player = state.players.get(sessionId);
  if (!player || !player.alive || !player.actionSurgeAvailable) return null;
  if (player.attackCooldownMs <= 0) return null;
  player.attackCooldownMs = 0;
  player.actionSurgeAvailable = false;
  return true;
}

/**
 * Flurry of Blows (Monk 2): spend 1 ki for two immediate unarmed strikes
 * against the nearest living enemy in melee range. Independent of the attack
 * timer (bonus action per GDD action-economy translation). Requires the
 * martial-arts stance: no armor, no shield, monk weapon.
 *
 * Open Hand Technique (Way of the Open Hand): each flurry hit staggers the
 * target — its attack timer is pushed back to OPEN_HAND_STAGGER_MS.
 *
 * Returns { logs } on success, { denied } otherwise
 * ('no_ki' | 'no_target' | 'not_unarmored').
 */
export function applyFlurryOfBlows(state, sessionId, enemyDefs = new Map(), terrain = null) {
  const player = state.players.get(sessionId);
  if (!player || !player.alive) return { denied: 'no_target' };
  if ((player.kiPoints ?? 0) < KI_ABILITY_COST) return { denied: 'no_ki' };

  const hasShieldEquipped = !!SHIELD_REGISTRY[player.offhandId];
  if (player.equippedArmorId || hasShieldEquipped || !MONK_WEAPON_IDS.has(player.equippedWeaponId)) {
    return { denied: 'not_unarmored' };
  }

  const target = nearestLivingEnemy(state, player);
  if (!target) return { denied: 'no_target' };

  player.kiPoints -= KI_ABILITY_COST;

  const derived   = getDerivedClassFeatures(player);
  const attacker  = playerToAttacker(player, derived);
  const profBonus = getProficiencyBonus(attacker.level);
  const enemyDef          = enemyDefs.get(target.id) ?? {};
  const targetResistances = enemyDef.resistances ?? [];
  const targetDR          = enemyDef.damageReduction ?? null;

  const pLabel = player.class ? player.class[0].toUpperCase() + player.class.slice(1) : 'Player';
  const tLabel = target.state.type || 'enemy';

  const maWeapon  = { ...UNARMED, properties: [...(UNARMED.properties ?? []), 'finesse'] };
  const strMod    = getModifier(player.str);
  const dexMod    = getModifier(player.dex);
  const abilMod   = dexMod > strMod ? dexMod : strMod;
  const abilKey   = dexMod > strMod ? 'dex' : 'str';

  const sources = [];
  if (player.elevation === 1 && target.state.elevation === 0) {
    sources.push({ kind: 'advantage', reason: 'high-ground' });
  }

  const logs = [];
  for (let strike = 0; strike < 2 && target.state.alive; strike++) {
    const result = resolveAttack({ attacker, target: enemyToTarget(target.state, targetResistances, targetDR), weapon: maWeapon, sources });
    if (result.hit) {
      const applied = applyDamage({
        target: enemyToTarget(target.state, targetResistances, targetDR),
        damage: result.damage,
        damageType: maWeapon.damageType,
      });
      target.state.hp = applied.newHP;
      if (target.state.hp <= 0) {
        target.state.hp    = 0;
        target.state.alive = false;
        target.state.vx    = 0;
        target.state.vy    = 0;
        player.kills += 1;
      }
      let staggerTag = '';
      if (derived.openHandTechnique && target.state.alive) {
        target.state.attackCooldownMs = Math.max(target.state.attackCooldownMs, OPEN_HAND_STAGGER_MS);
        staggerTag = ' — staggered!';
      }
      let kbTag = '';
      if (target.state.alive) {
        kbTag = _applyKnockbackToEnemy(state, player, target.state, enemyDef, applied.finalDamage, terrain);
      }
      const tag = _damageTag(applied, result.crit);
      logs.push(`${pLabel} [flurry] → ${tLabel}: hit (${rollStr(result, profBonus, abilMod, abilKey)} vs AC ${target.state.ac}), ${result.damage}${tag} ${maWeapon.damageType}${staggerTag}${kbTag}`);
    } else {
      logs.push(`${pLabel} [flurry] → ${tLabel}: miss (${rollStr(result, profBonus, abilMod, abilKey)} vs AC ${target.state.ac})`);
    }
  }
  return { logs };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nearestLivingEnemy(state, player) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const [id, enemy] of state.enemies) {
    if (!enemy.alive) continue;
    const dist = dist2d(player.x, player.y, enemy.x, enemy.y);
    if (dist <= MELEE_HIT_RANGE_PX && dist < nearestDist) {
      nearestDist = dist;
      nearest = { id, state: enemy };
    }
  }
  return nearest;
}

/**
 * `derived` is the getDerivedClassFeatures(player) result — passed in so a
 * multi-attack sequence computes it once. critRange carries the Champion's
 * Improved Critical (19) into resolveAttack; omitted → natural 20 only.
 */
function playerToAttacker(player, derived = null) {
  return {
    abilityScores: { str: player.str, dex: player.dex, con: player.con,
                     int: player.int, wis: player.wis, cha: player.cha },
    level: player.level,
    conditions: [...player.conditions],
    critRange: derived?.critRange ?? 20,
  };
}

/**
 * Build a compact damage suffix for the combat log.
 * Shows reduction info so the player understands why damage was lower than the dice roll.
 *   Normal hit:        ""           (no suffix)
 *   Resisted:          " (resisted)"
 *   DR applied:        " → 3 dealt (DR 5)"
 *   Crit:              " CRIT!"
 */
function _damageTag(applied, isCrit) {
  const parts = [];
  if (applied.resisted)    parts.push('resisted');
  if (applied.drApplied)   parts.push(`DR -${applied.drApplied} = ${applied.finalDamage} dealt`);
  if (isCrit)              parts.push('CRIT!');
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function playerToTarget(player) {
  const resistances = player.conditions.includes('rage')
    ? ['bludgeoning', 'piercing', 'slashing']
    : [];
  return { ac: player.ac, hp: player.hp, resistances, damageReduction: null };
}

function enemyToTarget(enemy, resistances = [], damageReduction = null) {
  return { ac: enemy.ac, hp: enemy.hp, resistances, damageReduction };
}

function dist2d(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
