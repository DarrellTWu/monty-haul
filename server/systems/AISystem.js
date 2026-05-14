// server/systems/AISystem.js
// Enemy AI: detect nearby players, pursue, attack in melee.
// State machine per enemy: 'idle' → 'aggro' (one-way for now).
// Enemy vx/vy are set to actual px/sec vectors; MovementSystem applies them.
//
// V1 navigation:
//   - Wall sliding (full → x-only → y-only → stop) lets enemies hug walls
//     and locked doors instead of jamming straight into them. Handles
//     corridors and 90° turns. Concave corners + diagonal walls still trap.
//   - Elevation-aware pursuit: non-climbers chasing an elevated target
//     retarget to the nearest step on the platform; once they themselves
//     climb (their movement segment crosses a step gap inward), the next
//     tick re-acquires the player as the target. Climbers pursue directly.

import { COMBAT_DETECTION_RADIUS, ENTITY_RADIUS_PX } from '../../shared/data/constants.js';
import {
  circleOverlapsAny,
  platformPerimeterRects,
  pointInRect,
} from '../../shared/logic/geometry.js';
import { enemyAttack } from './CombatSystem.js';

/**
 * @param {import('../state/GameState.js').GameState} state
 * @param {number} dt - delta time in ms
 * @param {Map<string, object>} enemyDefs - map of enemyId → static enemy def
 * @param {number} melee - center-to-center melee range in px
 * @param {{ walls?: Array, platforms?: Array, rooms?: Array }} [geometry]
 * @returns {string[]} combat log messages generated this tick
 */
export function update(state, dt, enemyDefs, melee, geometry = null) {
  const logs = [];
  const walls     = geometry?.walls     ?? [];
  const platforms = geometry?.platforms ?? [];
  const rooms     = geometry?.rooms     ?? [];

  // Live-state doors: only locked doors are obstacles.
  const lockedDoors = [];
  if (state.doors) {
    for (const [, door] of state.doors) {
      if (door.locked) lockedDoors.push({ x: door.x, y: door.y, w: door.w, h: door.h });
    }
  }

  // Platform perimeter wall segments (with step gaps). Shared across all
  // elev-0 non-climbers — non-climbers see them as obstacles; climbers and
  // elev-1 entities do not.
  const platformPerimeters = [];
  for (const p of platforms) {
    for (const r of platformPerimeterRects(p)) platformPerimeters.push(r);
  }

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

    if (dist <= detectionRadius) {
      enemy.aiState = 'aggro';
    }

    if (enemy.aiState !== 'aggro') {
      enemy.vx = 0;
      enemy.vy = 0;
      continue;
    }

    if (dist <= melee) {
      enemy.vx = 0;
      enemy.vy = 0;
      const result = enemyAttack(state, enemy, def, nearest.player);
      if (result?.log) logs.push(result.log);
      continue;
    }

    // ── Pursuit ─────────────────────────────────────────────────────────────
    const canClimb = def.canClimb ?? false;
    const target   = selectTargetPosition(enemy, nearest.player, platforms, rooms, state.doors, canClimb);
    const tdx = target.x - enemy.x;
    const tdy = target.y - enemy.y;
    const tdLen = Math.sqrt(tdx * tdx + tdy * tdy);
    if (tdLen === 0) {
      enemy.vx = 0;
      enemy.vy = 0;
      continue;
    }
    const dvx = (tdx / tdLen) * def.speed;
    const dvy = (tdy / tdLen) * def.speed;

    // Obstacle list for this enemy's slide check — same rule as MovementSystem
    // builds. Mirrors elev/canClimb gating exactly so the AI doesn't pick a
    // velocity that MovementSystem will then have to push back.
    const obstacles = [];
    for (const w of walls)        obstacles.push(w);
    for (const d of lockedDoors)  obstacles.push(d);
    if (enemy.elevation === 0 && !canClimb) {
      for (const r of platformPerimeters) obstacles.push(r);
    }

    applySlidingVelocity(enemy, dvx, dvy, dt, obstacles);
  }

  return logs;
}

// ─── Targeting ────────────────────────────────────────────────────────────────

/**
 * Pick the (x, y) the AI should move toward this tick.
 *
 * Two routing layers, in order:
 *
 * 1. Walled-room routing. If the target is inside a walled room and the
 *    enemy is outside (or vice versa), retarget to the nearest *unlocked*
 *    door on that room. The pattern mirrors platform/step routing — wall
 *    sliding alone can't navigate around a wall to find a door, so the AI
 *    aims directly at the gap. Locked doors are skipped (read live from
 *    state.doors).
 *
 * 2. Elevation routing. Non-climbers chasing an elevated target re-aim at
 *    the nearest step on the platform containing that target.
 *
 * If neither applies, pursue the player directly.
 */
function selectTargetPosition(enemy, player, platforms, rooms, stateDoors, canClimb) {
  // ── Room routing ──────────────────────────────────────────────────────────
  const targetRoom = findRoomContaining(player, rooms);
  const enemyRoom  = findRoomContaining(enemy,  rooms);
  if (targetRoom !== enemyRoom) {
    // Pick whichever room creates the barrier — the target's if they're
    // inside, otherwise the enemy's. Either way, that room's doors are the
    // navigable gaps in the separating wall.
    const routeRoom = targetRoom ?? enemyRoom;
    const door = nearestUnlockedDoor(enemy, routeRoom, stateDoors);
    if (door) return door;
    // No reachable door — fall through; the AI will jam at the wall.
  }

  // ── Elevation routing ────────────────────────────────────────────────────
  if (enemy.elevation === player.elevation || canClimb) {
    return { x: player.x, y: player.y };
  }
  if (enemy.elevation === 0 && player.elevation === 1) {
    const platform = findPlatformContaining(player, platforms);
    if (!platform) return { x: player.x, y: player.y };
    const step = nearestStep(enemy, platform);
    return step ? { x: step.x, y: step.y } : { x: player.x, y: player.y };
  }
  // Enemy elev 1, target elev 0: walk off any edge (no step needed for descent).
  return { x: player.x, y: player.y };
}

function findPlatformContaining(point, platforms) {
  for (const p of platforms) {
    if (pointInRect(point.x, point.y, p)) return p;
  }
  return null;
}

function findRoomContaining(point, rooms) {
  for (const r of rooms) {
    if (pointInRect(point.x, point.y, r)) return r;
  }
  return null;
}

function nearestStep(enemy, platform) {
  let best = null;
  let bestD = Infinity;
  for (const step of platform.steps ?? []) {
    const dx = step.x - enemy.x;
    const dy = step.y - enemy.y;
    const d  = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = step; }
  }
  return best;
}

/**
 * Find the nearest unlocked door on the given room, by distance from
 * the enemy. Door center is (door.x + door.w/2, door.y + door.h/2).
 * Returns null if every door is missing or locked.
 */
function nearestUnlockedDoor(enemy, room, stateDoors) {
  let best = null;
  let bestD = Infinity;
  for (const doorId of room.doors ?? []) {
    const door = stateDoors?.get?.(doorId);
    if (!door || door.locked) continue;
    const cx = door.x + door.w / 2;
    const cy = door.y + door.h / 2;
    const dx = cx - enemy.x;
    const dy = cy - enemy.y;
    const d  = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = { x: cx, y: cy }; }
  }
  return best;
}

// ─── Wall sliding ────────────────────────────────────────────────────────────

/**
 * Try the full (vx, vy) move; if blocked, try x-only, then y-only, else stop.
 * Mutates enemy.vx/vy with the chosen vector.
 */
function applySlidingVelocity(enemy, vx, vy, dt, obstacles) {
  const dtSec = dt / 1000;
  const fullTarget = { x: enemy.x + vx * dtSec, y: enemy.y + vy * dtSec };
  if (!circleOverlapsAny(fullTarget, ENTITY_RADIUS_PX, obstacles)) {
    enemy.vx = vx;
    enemy.vy = vy;
    return;
  }
  if (vx !== 0) {
    const xOnly = { x: enemy.x + vx * dtSec, y: enemy.y };
    if (!circleOverlapsAny(xOnly, ENTITY_RADIUS_PX, obstacles)) {
      enemy.vx = vx;
      enemy.vy = 0;
      return;
    }
  }
  if (vy !== 0) {
    const yOnly = { x: enemy.x, y: enemy.y + vy * dtSec };
    if (!circleOverlapsAny(yOnly, ENTITY_RADIUS_PX, obstacles)) {
      enemy.vx = 0;
      enemy.vy = vy;
      return;
    }
  }
  enemy.vx = 0;
  enemy.vy = 0;
}

// ─── Targeting helpers ───────────────────────────────────────────────────────

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
