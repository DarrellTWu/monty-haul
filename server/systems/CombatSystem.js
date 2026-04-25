// server/systems/CombatSystem.js
// Multiplayer wrapper around shared/logic/combat.js.

import {
  resolveAttack, applyDamage, rollDice,
  getModifier, getProficiencyBonus,
} from '../../shared/logic/combat.js';
import { ATTACK_COOLDOWN_MS, MELEE_HIT_RANGE_PX, RAGE_DAMAGE_BONUS } from '../../shared/data/constants.js';
import { LONGSWORD, SHORTSWORD, HANDAXE, GREATAXE, GREATSWORD, DAGGER, MACE, UNARMED } from '../../shared/data/weapons/melee.js';
import { SHIELD_REGISTRY } from '../../shared/data/items/shields.js';
import { CLASS_REGISTRY, DEFAULT_CLASS } from '../../shared/data/classes/index.js';

const WEAPON_REGISTRY = {
  longsword:  LONGSWORD,
  shortsword: SHORTSWORD,
  handaxe:    HANDAXE,
  greataxe:   GREATAXE,
  greatsword: GREATSWORD,
  dagger:     DAGGER,
  mace:       MACE,
  unarmed:    UNARMED,
};

// Monk weapons: unarmed strikes and light/simple melee weapons per SRD.
const MONK_WEAPON_IDS = new Set(['shortsword', 'dagger', 'handaxe', 'mace', 'unarmed', '']);

function getWeapon(equippedWeaponId) {
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
 */
function rollStr(result, profBonus, abilityMod, abilityKey) {
  const parts = [`d20:${result.rawD20}`];
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
export function playerAttack(state, sessionId, enemyDefs = new Map()) {
  const player = state.players.get(sessionId);
  if (!player || !player.alive) return { hit: false, crit: false, damage: 0, targetId: null, logs: [] };
  if (player.attackCooldownMs > 0) return { hit: false, crit: false, damage: 0, targetId: null, logs: [] };

  const target = nearestLivingEnemy(state, player);
  if (!target) return { hit: false, crit: false, damage: 0, targetId: null, logs: [] };

  const logs      = [];
  const tLabel    = target.state.type || 'enemy';
  const attacker  = playerToAttacker(player);
  const profBonus = getProficiencyBonus(attacker.level);

  // Look up the target's damage traits from the enemy definition (not in schema).
  const enemyDef          = enemyDefs.get(target.id) ?? {};
  const targetResistances = enemyDef.resistances ?? [];
  const targetDR          = enemyDef.damageReduction ?? null;

  // ── Main hand attack ────────────────────────────────────────────────────────
  const classDef = CLASS_REGISTRY[player.class] ?? DEFAULT_CLASS;
  const pLabel   = player.class ? player.class[0].toUpperCase() + player.class.slice(1) : 'Player';

  let baseWeapon = getWeapon(player.equippedWeaponId);
  if (player.conditions.includes('rage')) {
    baseWeapon = { ...baseWeapon, damageBonus: (baseWeapon.damageBonus ?? 0) + RAGE_DAMAGE_BONUS };
  }
  const weapon = applyDueling(getEffectiveWeapon(baseWeapon, player), player, classDef.fightingStyle);

  const isFinesse   = weapon.properties?.includes('finesse');
  const strMod      = getModifier(attacker.abilityScores.str);
  const dexMod      = getModifier(attacker.abilityScores.dex);
  const mainAbilMod = isFinesse && dexMod > strMod ? dexMod : strMod;
  const mainAbilKey = isFinesse && dexMod > strMod ? 'dex' : 'str';

  const result = resolveAttack({ attacker, target: enemyToTarget(target.state, targetResistances, targetDR), weapon });

  if (result.hit) {
    const applied = applyDamage({
      target: enemyToTarget(target.state, targetResistances, targetDR),
      damage: result.damage,
      damageType: weapon.damageType,
    });
    target.state.hp = applied.newHP;
    if (target.state.hp <= 0) {
      target.state.hp = 0;
      target.state.alive = false;
      target.state.vx    = 0;
      target.state.vy    = 0;
    }
    const tag = _damageTag(applied, result.crit);
    logs.push(`${pLabel} → ${tLabel}: hit (${rollStr(result, profBonus, mainAbilMod, mainAbilKey)} vs AC ${target.state.ac}), ${result.damage}${tag} ${weapon.damageType}`);
  } else {
    logs.push(`${pLabel} → ${tLabel}: miss (${rollStr(result, profBonus, mainAbilMod, mainAbilKey)} vs AC ${target.state.ac})`);
  }

  // ── Offhand attack (Two-Weapon Fighting) ────────────────────────────────────
  // Triggered when offhand holds a weapon (not a shield). The offhand attack
  // does NOT add the ability modifier to damage unless the modifier is negative
  // (standard SRD Two-Weapon Fighting rule). No Dueling bonus either.
  const offhandId = player.offhandId;
  if (offhandId && WEAPON_REGISTRY[offhandId] && target.state.alive) {
    const offWeapon = WEAPON_REGISTRY[offhandId];

    const offIsFinesse = offWeapon.properties?.includes('finesse');
    const offAbilMod   = offIsFinesse && dexMod > strMod ? dexMod : strMod;
    const offAbilKey   = offIsFinesse && dexMod > strMod ? 'dex' : 'str';

    const offResult = resolveAttack({ attacker, target: enemyToTarget(target.state, targetResistances, targetDR), weapon: offWeapon });

    // TWF: remove positive ability mod from damage (SRD rule).
    let offRawDamage = offResult.damage;
    if (offResult.hit && offAbilMod > 0) {
      offRawDamage = Math.max(1, offRawDamage - offAbilMod);
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
      }
      const tag = _damageTag(applied, offResult.crit);
      logs.push(`${pLabel} [off] → ${tLabel}: hit (${rollStr(offResult, profBonus, offAbilMod, offAbilKey)} vs AC ${target.state.ac}), ${offRawDamage}${tag} ${offWeapon.damageType}`);
    } else {
      logs.push(`${pLabel} [off] → ${tLabel}: miss (${rollStr(offResult, profBonus, offAbilMod, offAbilKey)} vs AC ${target.state.ac})`);
    }
  }

  // ── Martial Arts bonus unarmed strike ────────────────────────────────────────
  // Triggers when monk attacks unarmored, no shield, with a monk weapon.
  const hasShieldEquipped = !!SHIELD_REGISTRY[player.offhandId];
  if (
    player.class === 'monk' &&
    !player.equippedArmorId &&
    !hasShieldEquipped &&
    MONK_WEAPON_IDS.has(player.equippedWeaponId) &&
    target.state.alive
  ) {
    const maWeapon  = { ...UNARMED, properties: [...(UNARMED.properties ?? []), 'finesse'] };
    const maAbilMod = dexMod > strMod ? dexMod : strMod;
    const maAbilKey = dexMod > strMod ? 'dex' : 'str';

    const maResult = resolveAttack({ attacker, target: enemyToTarget(target.state, targetResistances, targetDR), weapon: maWeapon });

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
      }
      const tag = _damageTag(applied, maResult.crit);
      logs.push(`${pLabel} [MA] → ${tLabel}: hit (${rollStr(maResult, profBonus, maAbilMod, maAbilKey)} vs AC ${target.state.ac}), ${maResult.damage}${tag} ${maWeapon.damageType}`);
    } else {
      logs.push(`${pLabel} [MA] → ${tLabel}: miss (${rollStr(maResult, profBonus, maAbilMod, maAbilKey)} vs AC ${target.state.ac})`);
    }
  }

  player.attackCooldownMs = ATTACK_COOLDOWN_MS;
  return { hit: result.hit, crit: result.crit, damage: result.damage, targetId: target.id, logs };
}

/**
 * Enemy attacks the nearest living player. Returns { log }.
 */
export function enemyAttack(state, enemyState, enemyDef, targetPlayer) {
  if (!enemyState.alive || !targetPlayer.alive) return { log: null };
  if (enemyState.attackCooldownMs > 0) return { log: null };

  const attacker = {
    attackBonus: enemyDef.attackBonus,
    damageDice:  enemyDef.damageDice,
    damageBonus: enemyDef.damageBonus,
    conditions:  [],
  };

  const result = resolveAttack({ attacker, target: playerToTarget(targetPlayer), weapon: null });

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
  }

  enemyState.attackCooldownMs = ATTACK_COOLDOWN_MS;

  const tLabel = enemyState.type || 'enemy';
  const pLabel = targetPlayer.class ? targetPlayer.class[0].toUpperCase() + targetPlayer.class.slice(1) : 'Player';
  const log = result.hit
    ? `${tLabel} → ${pLabel}: hit (d20:${result.rawD20}+${enemyDef.attackBonus}atk = ${result.roll} vs AC ${targetPlayer.ac}), ${result.damage} ${enemyDef.damageType}`
    : `${tLabel} → ${pLabel}: miss (d20:${result.rawD20}+${enemyDef.attackBonus}atk = ${result.roll} vs AC ${targetPlayer.ac})`;

  return { log };
}

/**
 * Use the Second Wind class feature. Returns HP healed, or null if unavailable.
 */
export function applySecondWind(state, sessionId) {
  const player = state.players.get(sessionId);
  if (!player || !player.alive || !player.secondWindAvailable) return null;
  const heal = rollDice(1, 10) + player.level;
  player.hp = Math.min(player.maxHp, player.hp + heal);
  player.secondWindAvailable = false;
  return heal;
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

function playerToAttacker(player) {
  const classDef = CLASS_REGISTRY[player.class] ?? DEFAULT_CLASS;
  return {
    abilityScores: classDef.baseAbilityScores,
    level: player.level,
    conditions: [...player.conditions],
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
