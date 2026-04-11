// server/systems/MovementSystem.js
// Applies velocity to player and enemy positions each tick.
// Clamps all positions to room bounds.
//
// Player vx/vy: normalized direction from client input (-1..1).
//   Applied at BASE_SPEED_PX_PER_SEC.
// Enemy vx/vy: actual px/sec components set by AISystem.
//   Applied directly (AISystem already factored in the enemy's speed).

import { BASE_SPEED_PX_PER_SEC } from '../../shared/data/constants.js';

/**
 * @param {import('../state/GameState.js').GameState} state
 * @param {number} dt - delta time in milliseconds
 * @param {{ minX: number, maxX: number, minY: number, maxY: number }} bounds
 */
export function update(state, dt, bounds) {
  const dtSec = dt / 1000;

  // ── Players ────────────────────────────────────────────────────────────────
  for (const [, player] of state.players) {
    if (!player.alive) continue;

    if (player.attackCooldownMs > 0) {
      player.attackCooldownMs = Math.max(0, player.attackCooldownMs - dt);
    }

    if (player.vx !== 0 || player.vy !== 0) {
      player.x = clamp(
        player.x + player.vx * BASE_SPEED_PX_PER_SEC * dtSec,
        bounds.minX,
        bounds.maxX,
      );
      player.y = clamp(
        player.y + player.vy * BASE_SPEED_PX_PER_SEC * dtSec,
        bounds.minY,
        bounds.maxY,
      );
    }
  }

  // ── Enemies ────────────────────────────────────────────────────────────────
  // vx/vy here are actual px/sec (AISystem multiplies by enemy speed).
  for (const [, enemy] of state.enemies) {
    if (!enemy.alive) continue;

    if (enemy.attackCooldownMs > 0) {
      enemy.attackCooldownMs = Math.max(0, enemy.attackCooldownMs - dt);
    }

    if (enemy.vx !== 0 || enemy.vy !== 0) {
      enemy.x = clamp(enemy.x + enemy.vx * dtSec, bounds.minX, bounds.maxX);
      enemy.y = clamp(enemy.y + enemy.vy * dtSec, bounds.minY, bounds.maxY);
    }
  }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
