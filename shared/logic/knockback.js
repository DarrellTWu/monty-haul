// shared/logic/knockback.js
// Pure knockback math + geometry for the dynamic-combat pillar
// (docs/design/dynamic-combat.md §Pillar 1). No side effects, no RNG,
// no framework deps — CombatSystem applies the returned positions.
//
// Three responsibilities:
//   1. levelScale        — the underlevel-dissipation multiplier
//   2. computeKnockbackPx — push distance from attacker/target levels +
//                           class bonus/resist profiles
//   3. resolveKnockback  — swept push against obstacle rects + bounds,
//                           elevation transitions, wall-slam classification

import {
  ENTITY_RADIUS_PX,
  KNOCKBACK_BASE_PX,
  KNOCKBACK_STEP_PX,
  UNDERLEVEL_SCALE_FLOOR,
  WALL_SLAM_MIN_INTENDED_PX,
  WALL_SLAM_BLOCKED_RATIO,
} from '../data/constants.js';
import { resolveWallCollision, tryAutoClimb } from './geometry.js';

/**
 * Underlevel dissipation: a class bonus keeps full value at/above the opposing
 * level and dissipates linearly below it, floored at UNDERLEVEL_SCALE_FLOOR —
 * "dissipated, not useless" (a splashed level always keeps ≥40% of its value).
 *
 * @param {number} ownLevel       levels backing the effect (class level or total level)
 * @param {number} opposingLevel  the level being pushed / pushed by
 * @returns {number} multiplier in [UNDERLEVEL_SCALE_FLOOR, 1]
 */
export function levelScale(ownLevel, opposingLevel) {
  const opposing = Math.max(1, opposingLevel ?? 1);
  const ratio = (ownLevel ?? 0) / opposing;
  return Math.max(UNDERLEVEL_SCALE_FLOOR, Math.min(1, ratio));
}

/**
 * Push distance for one melee hit.
 *
 *   px = BASE × levelScale(attacker total level, target level)
 *      + bonusPx × levelScale(bonus class level, target level)     [Barbarian]
 *   then reduced by resistFraction × levelScale(resist class level,
 *   attacker level)                                                 [Fighter]
 *
 * Callers build the bonus/resist inputs from getKnockbackProfile
 * (shared/logic/class-progression.js) for players; enemies contribute only
 * their def `level`.
 *
 * @param {{
 *   attackerLevel: number, targetLevel: number,
 *   bonusPx?: number, bonusClassLevel?: number,
 *   resistFraction?: number, resistClassLevel?: number,
 * }} params
 * @returns {number} push distance in px (≥ 0, unrounded)
 */
export function computeKnockbackPx({
  attackerLevel, targetLevel,
  bonusPx = 0, bonusClassLevel = 0,
  resistFraction = 0, resistClassLevel = 0,
}) {
  let px = KNOCKBACK_BASE_PX * levelScale(attackerLevel, targetLevel)
         + bonusPx * levelScale(bonusClassLevel, targetLevel);
  if (resistFraction > 0) {
    px *= 1 - resistFraction * levelScale(resistClassLevel, attackerLevel);
  }
  return Math.max(0, px);
}

/**
 * Sweep the target away from (fromX, fromY) by `distancePx`, colliding against
 * `obstacles` in KNOCKBACK_STEP_PX increments so thin walls (2 px platform
 * perimeter bands) can't be tunneled through. The sweep stops early when a
 * step's displacement collapses (pinned against a wall / bounds).
 *
 * Obstacle policy is the caller's: walls + locked doors always; platform
 * perimeter rects when the target is at elevation 0 (knockback never shoves
 * anyone UP a platform — climbing is voluntary). Elevated targets see no
 * perimeter, so a push across the platform edge drops them — elevation is
 * re-derived from the movement segment via tryAutoClimb.
 *
 * Wall slam: intended ≥ WALL_SLAM_MIN_INTENDED_PX and actual displacement ≤
 * intended × WALL_SLAM_BLOCKED_RATIO. Sliding along a wall keeps displacement
 * high and is not a slam; being driven into it is.
 *
 * @param {{
 *   fromX: number, fromY: number,
 *   target: { x: number, y: number, elevation: number },
 *   distancePx: number,
 *   obstacles?: Array<{x:number,y:number,w:number,h:number}>,
 *   platforms?: Array<{x:number,y:number,w:number,h:number,steps?:Array}>,
 *   bounds?: { minX:number, maxX:number, minY:number, maxY:number } | null,
 *   radius?: number,
 * }} params
 * @returns {{
 *   x: number, y: number, elevation: number,
 *   actualPx: number, wallSlam: boolean, droppedElevation: boolean,
 * }}
 */
export function resolveKnockback({
  fromX, fromY, target, distancePx,
  obstacles = [], platforms = [], bounds = null,
  radius = ENTITY_RADIUS_PX,
}) {
  const startX = target.x;
  const startY = target.y;
  const noPush = {
    x: startX, y: startY, elevation: target.elevation,
    actualPx: 0, wallSlam: false, droppedElevation: false,
  };
  if (!(distancePx > 0)) return noPush;

  let dirX = startX - fromX;
  let dirY = startY - fromY;
  const len = Math.hypot(dirX, dirY);
  if (len === 0) return noPush; // attacker exactly on top — no meaningful direction
  dirX /= len;
  dirY /= len;

  let cx = startX;
  let cy = startY;
  const steps   = Math.max(1, Math.ceil(distancePx / KNOCKBACK_STEP_PX));
  const stepLen = distancePx / steps;
  for (let i = 0; i < steps; i++) {
    let tx = cx + dirX * stepLen;
    let ty = cy + dirY * stepLen;
    if (bounds) {
      tx = Math.max(bounds.minX, Math.min(bounds.maxX, tx));
      ty = Math.max(bounds.minY, Math.min(bounds.maxY, ty));
    }
    const resolved = resolveWallCollision({ x: tx, y: ty }, obstacles, radius);
    const moved = Math.hypot(resolved.x - cx, resolved.y - cy);
    cx = resolved.x;
    cy = resolved.y;
    if (moved < stepLen * 0.5) break; // pinned — stop sweeping
  }

  const actualPx = Math.hypot(cx - startX, cy - startY);
  const elevation = tryAutoClimb(
    { prevX: startX, prevY: startY, x: cx, y: cy, elevation: target.elevation },
    platforms,
  );
  const wallSlam = distancePx >= WALL_SLAM_MIN_INTENDED_PX
    && actualPx <= distancePx * WALL_SLAM_BLOCKED_RATIO;

  return {
    x: cx, y: cy, elevation,
    actualPx, wallSlam,
    droppedElevation: elevation < target.elevation,
  };
}
