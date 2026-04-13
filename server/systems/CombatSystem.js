// server/systems/CombatSystem.js
// Multiplayer wrapper around shared/logic/combat.js.

import { resolveAttack, applyDamage } from '../../shared/logic/combat.js';
import { ATTACK_COOLDOWN_MS, MELEE_HIT_RANGE_PX } from '../../shared/data/constants.js';
import { LONGSWORD, SHORTSWORD, HANDAXE, GREATAXE, UNARMED } from '../../shared/data/weapons/melee.js';

// All weapons the server recognises. Add new weapons here as they're designed.
const WEAPON_REGISTRY = {
  longsword: LONGSWORD,
  shortsword: SHORTSWORD,
  handaxe: HANDAXE,
  greataxe: GREATAXE,
  unarmed: UNARMED,
};

function getWeapon(equippedWeaponId) {
  return WEAPON_REGISTRY[equippedWeaponId] ?? UNARMED;
}

/**
 * Attempt a player attack against the nearest living enemy in melee range.
 * Weapon is resolved from player.equippedWeaponId — no weapon param needed.
 *
 * @param {import('../state/GameState.js').GameState} state
 * @param {string} sessionId
 * @returns {{ hit: boolean, crit: boolean, damage: number, targetId: string | null }}
 */
export function playerAttack(state, sessionId) {
  const player = state.players.get(sessionId);
  if (!player || !player.alive) return { hit: false, crit: false, damage: 0, targetId: null };
  if (player.attackCooldownMs > 0) return { hit: false, crit: false, damage: 0, targetId: null };

  const target = nearestLivingEnemy(state, player);
  if (!target) return { hit: false, crit: false, damage: 0, targetId: null };

  const weapon = getWeapon(player.equippedWeaponId);
  const attacker = playerToAttacker(player);

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
  return { ...result, targetId: target.id };
}

/**
 * Enemy attacks the nearest living player. Called by AISystem each tick.
 *
 * @param {import('../state/GameState.js').GameState} state
 * @param {import('../state/EnemyState.js').EnemyState} enemyState
 * @param {object} enemyDef
 * @param {import('../state/PlayerState.js').PlayerState} targetPlayer
 */
export function enemyAttack(state, enemyState, enemyDef, targetPlayer) {
  if (!enemyState.alive || !targetPlayer.alive) return;
  if (enemyState.attackCooldownMs > 0) return;

  const attacker = {
    attackBonus: enemyDef.attackBonus,
    damageDice: enemyDef.damageDice,
    damageBonus: enemyDef.damageBonus,
    conditions: [],
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
    // TODO: derive from player.abilityScores once that field is in schema.
    abilityScores: { str: 16, dex: 14, con: 16, int: 10, wis: 10, cha: 10 },
    level: player.level,
    conditions: [],
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
