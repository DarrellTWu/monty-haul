// server/systems/AISystem.js
// Goblin AI: detect nearby players, pursue, attack in melee.
// State machine per enemy: 'idle' → 'aggro' (one-way for now).
// Enemy vx/vy are set to actual px/sec vectors; MovementSystem applies them.

import { COMBAT_DETECTION_RADIUS } from '../../shared/data/constants.js';
import { enemyAttack } from './CombatSystem.js';

/**
 * @param {import('../state/GameState.js').GameState} state
 * @param {number} dt - delta time in ms
 * @param {Map<string, object>} enemyDefs - map of enemyId → static enemy def
 * @param {number} melee - center-to-center melee range in px
 */
export function update(state, dt, enemyDefs, melee) {
  for (const [id, enemy] of state.enemies) {
    if (!enemy.alive) continue;

    const def = enemyDefs.get(id);
    if (!def) continue;

    const nearest = nearestLivingPlayer(state, enemy);
    if (!nearest) {
      enemy.vx = 0;
      enemy.vy = 0;
      continue;
    }

    const dist = nearest.dist;
    const detectionRadius = def.detectionRadius ?? COMBAT_DETECTION_RADIUS;

    // Transition to aggro once player enters detection radius (never resets).
    if (dist <= detectionRadius) {
      enemy.aiState = 'aggro';
    }

    if (enemy.aiState !== 'aggro') {
      enemy.vx = 0;
      enemy.vy = 0;
      continue;
    }

    if (dist <= melee) {
      // In melee range: stop moving and attack if cooldown is ready.
      enemy.vx = 0;
      enemy.vy = 0;
      enemyAttack(state, enemy, def, nearest.player);
    } else {
      // Move toward nearest player at enemy's speed (px/sec).
      const dx = nearest.player.x - enemy.x;
      const dy = nearest.player.y - enemy.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      enemy.vx = (dx / len) * def.speed;
      enemy.vy = (dy / len) * def.speed;
    }
  }
}

function nearestLivingPlayer(state, enemy) {
  let nearest = null;
  let nearestDist = Infinity;

  for (const [, player] of state.players) {
    if (!player.alive) continue;
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = { player, dist };
    }
  }

  return nearest;
}
