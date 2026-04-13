// server/systems/CombatSystem.js
// Multiplayer wrapper around shared/logic/combat.js.

import { resolveAttack, applyDamage, rollDice } from '../../shared/logic/combat.js';
import { ATTACK_COOLDOWN_MS, MELEE_HIT_RANGE_PX } from '../../shared/data/constants.js';
import { LONGSWORD, SHORTSWORD, HANDAXE, GREATAXE, DAGGER, UNARMED } from '../../shared/data/weapons/melee.js';
import { SHIELD_REGISTRY } from '../../shared/data/items/shields.js';
import { FIGHTER } from '../../shared/data/classes/fighter.js';

const WEAPON_REGISTRY = {
  longsword:  LONGSWORD,
  shortsword: SHORTSWORD,
  handaxe:    HANDAXE,
  greataxe:   GREATAXE,
  dagger:     DAGGER,
  unarmed:    UNARMED,
};

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
function applyDueling(weapon, player) {
  if (FIGHTER.fightingStyle !== 'dueling') return weapon;
  if (weapon.properties?.includes('two-handed')) return weapon;
  if (weapon.id === 'unarmed') return weapon;
  // Offhand must be empty or a shield — not another weapon.
  const offhandIsWeapon = player.offhandId && !SHIELD_REGISTRY[player.offhandId];
  if (offhandIsWeapon) return weapon;
  return { ...weapon, damageBonus: (weapon.damageBonus ?? 0) + 2 };
}

/**
 * Attempt a player attack against the nearest living enemy in melee range.
 * Returns { hit, crit, damage, targetId, log }.
 */
export function playerAttack(state, sessionId) {
  const player = state.players.get(sessionId);
  if (!player || !player.alive) return { hit: false, crit: false, damage: 0, targetId: null, log: null };
  if (player.attackCooldownMs > 0) return { hit: false, crit: false, damage: 0, targetId: null, log: null };

  const target = nearestLivingEnemy(state, player);
  if (!target) return { hit: false, crit: false, damage: 0, targetId: null, log: null };

  const baseWeapon  = getWeapon(player.equippedWeaponId);
  const weapon      = applyDueling(getEffectiveWeapon(baseWeapon, player), player);
  const attacker    = playerToAttacker(player);

  const result = resolveAttack({ attacker, target: enemyToTarget(target.state), weapon });

  if (result.hit) {
    const applied = applyDamage({
      target: enemyToTarget(target.state),
      damage: result.damage,
      damageType: weapon.damageType,
    });
    target.state.hp = applied.newHP;
    if (target.state.hp <= 0) {
      target.state.hp = 0;
      target.state.alive = false;
      target.state.vx = 0;
      target.state.vy = 0;
    }
  }

  player.attackCooldownMs = ATTACK_COOLDOWN_MS;

  const tLabel = target.state.type || 'enemy';
  const log = result.hit
    ? `Fighter → ${tLabel}: hit ${result.roll} vs AC ${target.state.ac}, ${result.damage}${result.crit ? ' (CRIT!)' : ''} ${weapon.damageType}`
    : `Fighter → ${tLabel}: miss (${result.roll} vs AC ${target.state.ac})`;

  return { ...result, targetId: target.id, log };
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
    targetPlayer.hp = applied.newHP;
    if (targetPlayer.hp <= 0) {
      targetPlayer.hp = 0;
      targetPlayer.alive = false;
      targetPlayer.vx = 0;
      targetPlayer.vy = 0;
    }
  }

  enemyState.attackCooldownMs = ATTACK_COOLDOWN_MS;

  const tLabel = enemyState.type || 'enemy';
  const log = result.hit
    ? `${tLabel} → Fighter: hit ${result.roll} vs AC ${targetPlayer.ac}, ${result.damage} ${enemyDef.damageType}`
    : `${tLabel} → Fighter: miss (${result.roll} vs AC ${targetPlayer.ac})`;

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
  return {
    // TODO: derive from player.abilityScores once schema carries it.
    abilityScores: { str: 16, dex: 14, con: 16, int: 10, wis: 10, cha: 10 },
    level: player.level,
    conditions: [...player.conditions],
  };
}

function playerToTarget(player) {
  return { ac: player.ac, hp: player.hp, resistances: [] };
}

function enemyToTarget(enemy) {
  return { ac: enemy.ac, hp: enemy.hp, resistances: [] };
}

function dist2d(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
