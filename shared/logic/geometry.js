// shared/logic/geometry.js
// Pure collision and elevation helpers for the dungeon geometry system.
//
// No framework deps; all coordinates are pixels. Entities are circles
// (radius ENTITY_RADIUS_PX) colliding against axis-aligned rectangles
// (walls, locked doors, and — conditionally — platform perimeters).
//
// Imported by server/systems/MovementSystem.js (collision + auto-climb)
// and by shared/tests/geometry.test.js.

import {
  ENTITY_RADIUS_PX,
  STEP_HALF_WIDTH_PX,
  PLATFORM_WALL_THICK_PX,
} from '../data/constants.js';

// ─── Wall / door collision ───────────────────────────────────────────────────

/**
 * Push a circle out of any overlapping AABB rects using minimum-translation
 * vector. If the circle's center is inside a rect, push along the shorter-
 * penetration axis. Otherwise compute the closest-point-on-rect and push
 * radially outward.
 *
 * The rect list is whatever obstacles the caller wants to enforce this tick.
 * MovementSystem builds it from walls + locked doors + (conditionally) the
 * platform rect — the latter only when the entity should treat the platform
 * perimeter as a wall (elev-0 non-climber).
 *
 * @param {{x:number,y:number}} pos
 * @param {Array<{x:number,y:number,w:number,h:number}>} rects
 * @param {number} [radius=ENTITY_RADIUS_PX]
 * @returns {{x:number,y:number}}
 */
export function resolveWallCollision(pos, rects, radius = ENTITY_RADIUS_PX) {
  let { x, y } = pos;
  for (const r of rects) {
    const rx2 = r.x + r.w;
    const ry2 = r.y + r.h;
    const cx = clamp(x, r.x, rx2);
    const cy = clamp(y, r.y, ry2);
    const dx = x - cx;
    const dy = y - cy;
    const distSq = dx * dx + dy * dy;
    if (distSq >= radius * radius) continue;

    if (distSq === 0) {
      // Center is inside the rect — push out along the smaller-penetration axis.
      const leftPen   = x - r.x;
      const rightPen  = rx2 - x;
      const topPen    = y - r.y;
      const bottomPen = ry2 - y;
      const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
      if (minPen === leftPen)        x = r.x - radius;
      else if (minPen === rightPen)  x = rx2 + radius;
      else if (minPen === topPen)    y = r.y - radius;
      else                           y = ry2 + radius;
    } else {
      const dist = Math.sqrt(distSq);
      const push = radius - dist;
      x += (dx / dist) * push;
      y += (dy / dist) * push;
    }
  }
  return { x, y };
}

/**
 * Does the circle at `pos` (radius `r`) overlap any of the given AABB rects?
 * Same closest-point math as resolveWallCollision but returns a boolean
 * without computing the push-out vector — used by AI wall-sliding to
 * pre-screen tentative positions cheaply.
 *
 * @returns {boolean}
 */
export function circleOverlapsAny(pos, radius, rects) {
  for (const r of rects) {
    const cx = Math.max(r.x, Math.min(pos.x, r.x + r.w));
    const cy = Math.max(r.y, Math.min(pos.y, r.y + r.h));
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    if (dx * dx + dy * dy < radius * radius) return true;
  }
  return false;
}

// ─── Line of sight (stub) ────────────────────────────────────────────────────

/**
 * Returns true if the line segment between two points is blocked by an
 * opaque obstacle (walls + locked doors). Platforms never block LoS.
 *
 * Stub for this sprint — always returns false. LoS/ranged combat system
 * fills the body when it lands. Defined now because the wall/door data
 * shape it will read is being established this sprint.
 *
 * @returns {boolean}
 */
// TODO(deferred): line-of-sight / ranged combat — see docs/agent-context/geometry-elevation.md §Known V1 Limitations.
export function isLineBlocked(_x1, _y1, _x2, _y2, _walls, _doors) {
  return false;
}

// ─── Platform perimeter walls (with step gaps) ───────────────────────────────

/**
 * Generate the thin wall segments that make up a platform's perimeter, with
 * gaps at each step location. These rects are the *obstacles* for an
 * elevation-0 non-climber — they block the entity except at step gaps.
 *
 * Each edge of the platform is split into segments around the step positions
 * declared on that edge. Step position is read from `platform.steps[]`; a
 * step is "on" an edge when its coordinate matches that edge (e.g., a step
 * with `y === platform.y` is on the north edge). Gap width is
 * `2 × STEP_HALF_WIDTH_PX` centered on the step.
 *
 * The wall band is centered on each edge with thickness `PLATFORM_WALL_THICK_PX`.
 *
 * @param {{x:number,y:number,w:number,h:number,steps?:Array<{x:number,y:number}>}} platform
 * @returns {Array<{x:number,y:number,w:number,h:number}>}
 */
export function platformPerimeterRects(platform) {
  const t  = PLATFORM_WALL_THICK_PX;
  const ht = t / 2;
  const g  = STEP_HALF_WIDTH_PX;
  const px = platform.x;
  const py = platform.y;
  const pw = platform.w;
  const ph = platform.h;
  const steps = platform.steps ?? [];

  // Group step coords by edge.
  const northGaps = steps.filter(s => s.y === py)      .map(s => s.x).sort((a, b) => a - b);
  const southGaps = steps.filter(s => s.y === py + ph) .map(s => s.x).sort((a, b) => a - b);
  const westGaps  = steps.filter(s => s.x === px)      .map(s => s.y).sort((a, b) => a - b);
  const eastGaps  = steps.filter(s => s.x === px + pw) .map(s => s.y).sort((a, b) => a - b);

  const rects = [];
  for (const seg of splitEdgeWithGaps(px, px + pw, northGaps, g)) {
    rects.push({ x: seg.start, y: py - ht, w: seg.end - seg.start, h: t });
  }
  for (const seg of splitEdgeWithGaps(px, px + pw, southGaps, g)) {
    rects.push({ x: seg.start, y: py + ph - ht, w: seg.end - seg.start, h: t });
  }
  for (const seg of splitEdgeWithGaps(py, py + ph, westGaps, g)) {
    rects.push({ x: px - ht,      y: seg.start, w: t, h: seg.end - seg.start });
  }
  for (const seg of splitEdgeWithGaps(py, py + ph, eastGaps, g)) {
    rects.push({ x: px + pw - ht, y: seg.start, w: t, h: seg.end - seg.start });
  }
  return rects;
}

/**
 * Split a 1D edge [start..end] into wall segments, removing a gap of
 * 2*gapHalfWidth around each gapCenter. Overlapping gaps merge naturally
 * via the cursor advance. Returns an array of {start, end} ranges.
 */
function splitEdgeWithGaps(start, end, gapCenters, gapHalfWidth) {
  if (gapCenters.length === 0) return [{ start, end }];
  const segments = [];
  let cursor = start;
  for (const c of gapCenters) {
    const gapStart = c - gapHalfWidth;
    const gapEnd   = c + gapHalfWidth;
    if (gapStart > cursor) segments.push({ start: cursor, end: gapStart });
    if (gapEnd > cursor) cursor = gapEnd;
  }
  if (cursor < end) segments.push({ start: cursor, end });
  return segments;
}

// ─── Auto-climb (perimeter-driven elevation transitions) ─────────────────────

/**
 * Apply perimeter-based elevation transitions for one entity's movement
 * segment. With the perimeter-walls-with-gaps model, the wall list itself
 * gates *who* can cross — anyone who actually crosses the perimeter has
 * earned the elevation change. So this function is simple:
 *
 *   - segment crosses perimeter inward,  entity is elev 0  → elev 1
 *   - segment crosses perimeter outward, entity is elev 1  → elev 0
 *   - everything else: no change
 *
 * Position is NOT modified — traversal stays continuous along the original
 * segment. The caller updates the entity's elevation field from the return
 * value.
 *
 * Note: `canClimb` no longer influences this function. The obstacle-rect
 * builder is responsible for letting climbers through the perimeter; once
 * they're across, this function elevates them just like a non-climber that
 * passed through a step gap.
 *
 * @param {{
 *   prevX:number, prevY:number, x:number, y:number, elevation:number,
 * }} entity
 * @param {Array<{x:number,y:number,w:number,h:number}>} platforms
 * @returns {number} new elevation
 */
export function tryAutoClimb(entity, platforms) {
  let { elevation } = entity;
  const { prevX, prevY, x, y } = entity;
  for (const platform of platforms) {
    const crossing = segmentPerimeterCrossing(prevX, prevY, x, y, platform);
    if (crossing === 'inward'  && elevation === 0) elevation = 1;
    else if (crossing === 'outward' && elevation === 1) elevation = 0;
  }
  return elevation;
}

// ─── Geometric primitives ────────────────────────────────────────────────────

/**
 * Segment-vs-circle intersection. True iff any point of the segment from
 * (x1,y1) to (x2,y2) lies on or inside the circle of radius `r` at (cx,cy).
 *
 * Implementation: parameterize segment as P + t*D, solve |P + t*D - C|² = r²,
 * accept any solution where t ∈ [0, 1] (or the segment fully spans the circle,
 * i.e. roots straddle [0,1]).
 *
 * @returns {boolean}
 */
export function segmentIntersectsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  if (a === 0) return c <= 0; // degenerate segment (a point) — inside iff c <= 0
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const sd = Math.sqrt(disc);
  const t1 = (-b - sd) / (2 * a);
  const t2 = (-b + sd) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return true;
  if (t2 >= 0 && t2 <= 1) return true;
  if (t1 < 0 && t2 > 1)   return true; // segment fully spans the circle
  return false;
}

/**
 * Classify a segment's relationship to a rect's perimeter.
 *
 * @returns {'inward'|'outward'|null}
 *   'inward'  — start outside, end inside
 *   'outward' — start inside,  end outside
 *   null      — both inside, both outside, or no crossing intent
 */
export function segmentPerimeterCrossing(x1, y1, x2, y2, rect) {
  const inA = pointInRect(x1, y1, rect);
  const inB = pointInRect(x2, y2, rect);
  if (inA === inB) return null;
  return inA ? 'outward' : 'inward';
}

/**
 * Inclusive point-in-rect test. Points on the perimeter count as "inside".
 *
 * @returns {boolean}
 */
export function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// ─── Internal ────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
