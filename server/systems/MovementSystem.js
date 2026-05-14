// server/systems/MovementSystem.js
// Applies velocity to player and enemy positions each tick, with
// wall/door/platform collision and step-based elevation transitions.
//
// Per entity, the tick order is:
//   1. Snapshot prev (x, y) BEFORE integration.
//   2. Integrate velocity → tentative (x, y).
//   3. Build the obstacle rect list based on this entity's (elevation, canClimb)
//      — see buildObstacleRects below for the rules.
//   4. resolveWallCollision → push circle out of overlapping obstacles.
//   5. tryAutoClimb on the segment (prev → resolved) — handles step crossings
//      and perimeter-based elevation transitions (climb up / walk off).
//   6. Clamp to room bounds.
//
// Player vx/vy: normalized direction from client input (-1..1).
//   Applied at BASE_SPEED_PX_PER_SEC.
// Enemy vx/vy: actual px/sec components set by AISystem.
//   Applied directly (AISystem already factored in the enemy's speed).

import {
  BASE_SPEED_PX_PER_SEC,
  LONGSTRIDER_SPEED_BONUS_PX,
} from '../../shared/data/constants.js';
import {
  resolveWallCollision, tryAutoClimb, platformPerimeterRects,
} from '../../shared/logic/geometry.js';
import { CLASS_REGISTRY } from '../../shared/data/classes/index.js';

/**
 * @param {import('../state/GameState.js').GameState} state
 * @param {number} dt - delta time in milliseconds
 * @param {{ minX: number, maxX: number, minY: number, maxY: number }} bounds
 * @param {{ walls?: Array, platforms?: Array }} [geometry]
 *   walls/platforms come from the static floor data (not synced).
 *   Locked doors are read from state.doors (synced).
 * @param {Map<string, object>} [enemyDefs]
 *   Map of enemyId → enemy def. Used to look up `canClimb` per enemy.
 */
export function update(state, dt, bounds, geometry = null, enemyDefs = null) {
  const dtSec = dt / 1000;
  const walls     = geometry?.walls ?? [];
  const platforms = geometry?.platforms ?? [];

  // Live-state doors: only locked doors are obstacles. Build once per tick;
  // the list is shared across all entities.
  const lockedDoors = [];
  if (state.doors) {
    for (const [, door] of state.doors) {
      if (door.locked) lockedDoors.push({ x: door.x, y: door.y, w: door.w, h: door.h });
    }
  }

  // Platform perimeter walls (with step gaps). Shared across all elev-0
  // non-climbers; built once per tick. Climbers and elev-1 entities don't
  // see these — the perimeter is transparent to them.
  const platformPerimeters = [];
  for (const p of platforms) {
    for (const r of platformPerimeterRects(p)) platformPerimeters.push(r);
  }

  // ── Players ────────────────────────────────────────────────────────────────
  for (const [, player] of state.players) {
    if (!player.alive) continue;

    if (player.attackCooldownMs > 0) {
      player.attackCooldownMs = Math.max(0, player.attackCooldownMs - dt);
    }

    const prevX = player.x;
    const prevY = player.y;

    if (player.vx !== 0 || player.vy !== 0) {
      const speed = BASE_SPEED_PX_PER_SEC +
        (player.conditions?.includes('longstrider') ? LONGSTRIDER_SPEED_BONUS_PX : 0);
      player.x = player.x + player.vx * speed * dtSec;
      player.y = player.y + player.vy * speed * dtSec;
    }

    const canClimb = CLASS_REGISTRY[player.class]?.canClimb ?? false;
    const rects = buildObstacleRects(walls, lockedDoors, platformPerimeters, player.elevation, canClimb);
    const resolved = resolveWallCollision({ x: player.x, y: player.y }, rects);
    player.x = resolved.x;
    player.y = resolved.y;

    const newElevation = tryAutoClimb({
      prevX, prevY, x: player.x, y: player.y,
      elevation: player.elevation, canClimb,
    }, platforms);
    if (newElevation !== player.elevation) player.elevation = newElevation;

    player.x = clamp(player.x, bounds.minX, bounds.maxX);
    player.y = clamp(player.y, bounds.minY, bounds.maxY);
  }

  // ── Enemies ────────────────────────────────────────────────────────────────
  // vx/vy here are actual px/sec (AISystem multiplies by enemy speed).
  for (const [id, enemy] of state.enemies) {
    if (!enemy.alive) continue;

    if (enemy.attackCooldownMs > 0) {
      enemy.attackCooldownMs = Math.max(0, enemy.attackCooldownMs - dt);
    }

    const prevX = enemy.x;
    const prevY = enemy.y;

    if (enemy.vx !== 0 || enemy.vy !== 0) {
      enemy.x = enemy.x + enemy.vx * dtSec;
      enemy.y = enemy.y + enemy.vy * dtSec;
    }

    const canClimb = enemyDefs?.get(id)?.canClimb ?? false;
    const rects = buildObstacleRects(walls, lockedDoors, platformPerimeters, enemy.elevation, canClimb);
    const resolved = resolveWallCollision({ x: enemy.x, y: enemy.y }, rects);
    enemy.x = resolved.x;
    enemy.y = resolved.y;

    const newElevation = tryAutoClimb({
      prevX, prevY, x: enemy.x, y: enemy.y,
      elevation: enemy.elevation, canClimb,
    }, platforms);
    if (newElevation !== enemy.elevation) enemy.elevation = newElevation;

    enemy.x = clamp(enemy.x, bounds.minX, bounds.maxX);
    enemy.y = clamp(enemy.y, bounds.minY, bounds.maxY);
  }
}

/**
 * Assemble the obstacle rect list for one entity this tick.
 *
 * Walls + locked doors are always obstacles. Platform perimeters (thin wall
 * bands with gaps at each step) are obstacles only for an elev-0 non-climber.
 * Climbers and elev-1 entities see the perimeter as transparent — they walk
 * freely, and `tryAutoClimb` updates their elevation when they actually cross.
 */
function buildObstacleRects(walls, lockedDoors, platformPerimeters, elevation, canClimb) {
  const rects = [];
  for (const w of walls) rects.push(w);
  for (const d of lockedDoors) rects.push(d);
  if (elevation === 0 && !canClimb) {
    for (const r of platformPerimeters) rects.push(r);
  }
  return rects;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
