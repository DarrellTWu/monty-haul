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
  DASH_SPEED_MULTIPLIER,
  PX_PER_FOOT,
  CLIMB_FATIGUE_SPEED_MULT,
  CLIMB_FATIGUE_MS_PER_FLOOR_DEFICIT,
  CLIMB_FATIGUE_MAX_MS,
} from '../../shared/data/constants.js';
import {
  resolveWallCollision, tryAutoClimb, platformPerimeterRects, isLineBlocked,
  separateCircles,
} from '../../shared/logic/geometry.js';
import { getDerivedClassFeatures, getClimbLevel } from '../../shared/logic/class-progression.js';
import { SHIELD_REGISTRY } from '../../shared/data/items/shields.js';

/**
 * @param {import('../state/GameState.js').GameState} state
 * @param {number} dt - delta time in milliseconds
 * @param {{ minX: number, maxX: number, minY: number, maxY: number }} bounds
 * @param {{ walls?: Array, platforms?: Array }} [geometry]
 *   walls/platforms come from the static floor data (not synced).
 *   Locked doors are read from state.doors (synced).
 * @param {Map<string, object>} [enemyDefs]
 *   Map of enemyId → enemy def. Used to look up `canClimb` per enemy.
 * @returns {Array<{ sessionId: string, type: 'climb_fatigue', durationMs: number }>}
 *   Movement events for the room to convert into conditions + log lines.
 */
export function update(state, dt, bounds, geometry = null, enemyDefs = null) {
  const events = [];
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

  // Platform perimeter walls (with step gaps), grouped per platform with its
  // elevation: the perimeter of platform P blocks an entity below P's level
  // (unless it climbs); entities at/above P's level see it as transparent.
  // Built once per tick. `allPerimeterRects` is the flat list used for
  // climb-fatigue segment checks.
  const perimeterGroups = [];
  const allPerimeterRects = [];
  for (const p of platforms) {
    const rects = platformPerimeterRects(p);
    perimeterGroups.push({ elevation: p.elevation ?? 1, rects });
    for (const r of rects) allPerimeterRects.push(r);
  }

  // ── Players ────────────────────────────────────────────────────────────────
  for (const [sessionId, player] of state.players) {
    if (!player.alive) continue;

    if (player.attackCooldownMs > 0) {
      player.attackCooldownMs = Math.max(0, player.attackCooldownMs - dt);
    }
    // Ability cooldowns tick alongside the attack timer.
    if (player.cunningActionCooldownMs > 0) {
      player.cunningActionCooldownMs = Math.max(0, player.cunningActionCooldownMs - dt);
    }

    const prevX = player.x;
    const prevY = player.y;

    const derived = getDerivedClassFeatures(player);

    if (player.vx !== 0 || player.vy !== 0) {
      let speed = BASE_SPEED_PX_PER_SEC +
        (player.conditions?.includes('longstrider') ? LONGSTRIDER_SPEED_BONUS_PX : 0);
      // Monk Unarmored Movement: flat bonus while wearing no armor and no shield.
      if (derived.unarmoredMovementFt > 0 && !player.equippedArmorId && !SHIELD_REGISTRY[player.offhandId]) {
        speed += derived.unarmoredMovementFt * PX_PER_FOOT;
      }
      // Dash (Step of the Wind): multiplier applies after flat bonuses.
      if (player.conditions?.includes('dash')) speed *= DASH_SPEED_MULTIPLIER;
      // Climb fatigue: an underleveled climber who just scaled a wall is slowed.
      if (player.conditions?.includes('climb_fatigue')) speed *= CLIMB_FATIGUE_SPEED_MULT;
      player.x = player.x + player.vx * speed * dtSec;
      player.y = player.y + player.vy * speed * dtSec;
    }

    const canClimb = derived.canClimb;
    const rects = buildObstacleRects(walls, lockedDoors, perimeterGroups, player.elevation, canClimb);
    const resolved = resolveWallCollision({ x: player.x, y: player.y }, rects);
    player.x = resolved.x;
    player.y = resolved.y;

    const newElevation = tryAutoClimb({
      prevX, prevY, x: player.x, y: player.y,
      elevation: player.elevation, canClimb,
    }, platforms);
    if (newElevation !== player.elevation) {
      // Climb fatigue (docs/design/dynamic-combat.md §Monk climb fatigue):
      // climbing UP over a perimeter WALL (the segment intersects a perimeter
      // rect — step-gap crossings don't) on a floor deeper than the player's
      // climb level emits a fatigue event; the room applies the condition.
      // Applies to any upward transition (0→1, 1→2).
      if (newElevation > player.elevation
          && isLineBlocked(prevX, prevY, player.x, player.y, allPerimeterRects)) {
        const deficit = (state.floor ?? 1) - getClimbLevel(player);
        if (deficit > 0) {
          events.push({
            sessionId,
            type: 'climb_fatigue',
            durationMs: Math.min(CLIMB_FATIGUE_MAX_MS, deficit * CLIMB_FATIGUE_MS_PER_FLOOR_DEFICIT),
          });
        }
      }
      player.elevation = newElevation;
    }

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
    const rects = buildObstacleRects(walls, lockedDoors, perimeterGroups, enemy.elevation, canClimb);
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

  // ── Entity separation (body blocking) ───────────────────────────────────────
  // Living entities at the same elevation can't overlap: characters can't be
  // walked through, so positioning holds. Symmetric pairwise push-apart, one
  // pass per tick (deep knockback pile-ups relax over a few ticks), then wall
  // re-resolution + bounds clamp for anything displaced, so separation never
  // shoves an entity through geometry. Corpses don't block (looting walks over
  // them). Cross-elevation pairs never collide — the platform height separates
  // them; a nudge across a perimeter edge re-derives elevation via
  // tryAutoClimb (silent — no climb-fatigue from being jostled).
  const bodies = [];
  for (const [, player] of state.players) {
    if (!player.alive) continue;
    bodies.push({ e: player, canClimb: getDerivedClassFeatures(player).canClimb });
  }
  for (const [id, enemy] of state.enemies) {
    if (!enemy.alive) continue;
    bodies.push({ e: enemy, canClimb: enemyDefs?.get(id)?.canClimb ?? false });
  }
  const preSep = bodies.map(b => ({ x: b.e.x, y: b.e.y }));
  const displaced = new Set();
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i].e;
      const B = bodies[j].e;
      if (A.elevation !== B.elevation) continue;
      const sep = separateCircles(A, B);
      if (!sep) continue;
      A.x = sep.ax; A.y = sep.ay;
      B.x = sep.bx; B.y = sep.by;
      displaced.add(i);
      displaced.add(j);
    }
  }
  for (const i of displaced) {
    const { e, canClimb } = bodies[i];
    const rects = buildObstacleRects(walls, lockedDoors, perimeterGroups, e.elevation, canClimb);
    const resolved = resolveWallCollision({ x: e.x, y: e.y }, rects);
    e.x = clamp(resolved.x, bounds.minX, bounds.maxX);
    e.y = clamp(resolved.y, bounds.minY, bounds.maxY);
    const newElevation = tryAutoClimb({
      prevX: preSep[i].x, prevY: preSep[i].y, x: e.x, y: e.y,
      elevation: e.elevation, canClimb,
    }, platforms);
    if (newElevation !== e.elevation) e.elevation = newElevation;
  }

  return events;
}

/**
 * Assemble the obstacle rect list for one entity this tick.
 *
 * Walls + locked doors are always obstacles. Platform perimeters (thin wall
 * bands with gaps at each step) block a non-climber whose elevation is below
 * that platform's level. Climbers and entities at/above the platform's level
 * see the perimeter as transparent — they walk freely, and `tryAutoClimb`
 * updates their elevation when they actually cross.
 */
function buildObstacleRects(walls, lockedDoors, perimeterGroups, elevation, canClimb) {
  const rects = [];
  for (const w of walls) rects.push(w);
  for (const d of lockedDoors) rects.push(d);
  if (!canClimb) {
    for (const group of perimeterGroups) {
      if (elevation >= group.elevation) continue;
      for (const r of group.rects) rects.push(r);
    }
  }
  return rects;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
