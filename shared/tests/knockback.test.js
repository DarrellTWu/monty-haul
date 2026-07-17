// shared/tests/knockback.test.js
// Tests for shared/logic/knockback.js — level scaling, push-distance math,
// and swept-push geometry (walls, thin perimeter bands, bounds, ledge drops).
// Run with: node shared/tests/knockback.test.js
//
// No test framework — node:assert + a pass/fail counter. All functions under
// test are deterministic (no RNG).

import assert from 'node:assert/strict';
import { levelScale, computeKnockbackPx, resolveKnockback } from '../logic/knockback.js';
import { platformPerimeterRects } from '../logic/geometry.js';
import {
  KNOCKBACK_BASE_PX, KNOCKBACK_BARBARIAN_PER_LEVEL_PX,
  UNDERLEVEL_SCALE_FLOOR, ENTITY_RADIUS_PX,
} from '../data/constants.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}
const approx = (a, b, eps = 0.01) =>
  assert.ok(Math.abs(a - b) < eps, `expected ~${b}, got ${a}`);

// ─── levelScale ───────────────────────────────────────────────────────────────

console.log('\nlevelScale');

test('equal levels → 1', () => {
  assert.equal(levelScale(3, 3), 1);
});

test('over-leveled caps at 1', () => {
  assert.equal(levelScale(5, 2), 1);
});

test('underleveled dissipates linearly', () => {
  assert.equal(levelScale(2, 4), 0.5);
});

test('floored at UNDERLEVEL_SCALE_FLOOR', () => {
  assert.equal(levelScale(1, 10), UNDERLEVEL_SCALE_FLOOR);
  assert.equal(levelScale(0, 3), UNDERLEVEL_SCALE_FLOOR);
});

test('opposing level 0/undefined treated as 1', () => {
  assert.equal(levelScale(2, 0), 1);
  assert.equal(levelScale(2, undefined), 1);
});

// ─── computeKnockbackPx ───────────────────────────────────────────────────────

console.log('\ncomputeKnockbackPx');

test('base push at even levels = KNOCKBACK_BASE_PX', () => {
  approx(computeKnockbackPx({ attackerLevel: 1, targetLevel: 1 }), KNOCKBACK_BASE_PX);
});

test('barbarian bonus adds at even levels (worked example: barb 3 vs lvl 1)', () => {
  const px = computeKnockbackPx({
    attackerLevel: 3, targetLevel: 1,
    bonusPx: 3 * KNOCKBACK_BARBARIAN_PER_LEVEL_PX, bonusClassLevel: 3,
  });
  approx(px, KNOCKBACK_BASE_PX + 3 * KNOCKBACK_BARBARIAN_PER_LEVEL_PX); // 56
});

test('underlevel dissipation (worked example: barb 1 vs lvl 3 ≈ a stumble)', () => {
  const px = computeKnockbackPx({
    attackerLevel: 1, targetLevel: 3,
    bonusPx: KNOCKBACK_BARBARIAN_PER_LEVEL_PX, bonusClassLevel: 1,
  });
  // Both base and bonus at the 0.4 floor: (20 + 12) × 0.4 = 12.8
  approx(px, (KNOCKBACK_BASE_PX + KNOCKBACK_BARBARIAN_PER_LEVEL_PX) * UNDERLEVEL_SCALE_FLOOR);
});

test('fighter resist reduces the push (fighter 3 + shield vs even attacker)', () => {
  const px = computeKnockbackPx({
    attackerLevel: 3, targetLevel: 3,
    resistFraction: 0.65, resistClassLevel: 3,
  });
  approx(px, KNOCKBACK_BASE_PX * (1 - 0.65)); // 7
});

test('resist dissipates when the fighter is underleveled vs the attacker', () => {
  const px = computeKnockbackPx({
    attackerLevel: 3, targetLevel: 1,
    resistFraction: 0.35, resistClassLevel: 1,
  });
  // Base 20 (attacker over-leveled → scale 1); resist 0.35 × scale(1,3)=0.4 → ×0.86
  approx(px, KNOCKBACK_BASE_PX * (1 - 0.35 * UNDERLEVEL_SCALE_FLOOR));
});

test('zero-resist and zero-bonus default cleanly', () => {
  approx(computeKnockbackPx({ attackerLevel: 2, targetLevel: 2 }), KNOCKBACK_BASE_PX);
});

// ─── resolveKnockback — open-ground pushes ────────────────────────────────────

console.log('\nresolveKnockback — open ground');

test('full push along the attacker→target line (east)', () => {
  const r = resolveKnockback({
    fromX: 100, fromY: 100,
    target: { x: 130, y: 100, elevation: 0 },
    distancePx: 40,
  });
  approx(r.x, 170);
  approx(r.y, 100);
  approx(r.actualPx, 40);
  assert.equal(r.wallSlam, false);
  assert.equal(r.droppedElevation, false);
});

test('diagonal direction is normalized', () => {
  const r = resolveKnockback({
    fromX: 100, fromY: 100,
    target: { x: 110, y: 110, elevation: 0 },
    distancePx: 30,
  });
  const d = Math.hypot(r.x - 110, r.y - 110);
  approx(d, 30, 0.1);
  assert.ok(r.x > 110 && r.y > 110, 'pushed away on both axes');
});

test('zero distance → no-op', () => {
  const r = resolveKnockback({
    fromX: 100, fromY: 100,
    target: { x: 130, y: 100, elevation: 0 },
    distancePx: 0,
  });
  assert.equal(r.x, 130);
  assert.equal(r.actualPx, 0);
  assert.equal(r.wallSlam, false);
});

test('attacker exactly on top of target → no-op (no direction)', () => {
  const r = resolveKnockback({
    fromX: 130, fromY: 100,
    target: { x: 130, y: 100, elevation: 0 },
    distancePx: 40,
  });
  assert.equal(r.actualPx, 0);
  assert.equal(r.wallSlam, false);
});

// ─── resolveKnockback — walls, slams, bounds ──────────────────────────────────

console.log('\nresolveKnockback — walls and slams');

test('pinned head-on against a wall → wall slam', () => {
  // Wall 10 px behind the target; a 40 px push collapses immediately.
  const wall = { x: 140, y: 0, w: 20, h: 200 };
  const r = resolveKnockback({
    fromX: 100, fromY: 100,
    target: { x: 130, y: 100, elevation: 0 },
    distancePx: 40,
    obstacles: [wall],
  });
  assert.ok(r.actualPx < 40 * 0.5, `actual ${r.actualPx} should be pinned`);
  assert.equal(r.wallSlam, true);
  assert.ok(r.x <= wall.x - ENTITY_RADIUS_PX + 0.01, 'never inside the wall');
});

test('thin perimeter band (2 px) is not tunneled by a long push', () => {
  const platform = { x: 200, y: 0, w: 100, h: 200, steps: [] };
  const perims = platformPerimeterRects(platform);
  const r = resolveKnockback({
    fromX: 120, fromY: 100,
    target: { x: 170, y: 100, elevation: 0 },
    distancePx: 60,
    obstacles: perims,
    platforms: [platform],
  });
  assert.ok(r.x < 200, `stopped before the platform edge (x=${r.x})`);
  assert.equal(r.wallSlam, true, 'pinned against the platform wall = slam');
  assert.equal(r.elevation, 0, 'never shoved UP the wall');
});

test('room for most of the push → no slam', () => {
  // Wall 100 px behind the target; a 40 px push completes untouched.
  const wall = { x: 260, y: 0, w: 20, h: 200 };
  const r = resolveKnockback({
    fromX: 100, fromY: 100,
    target: { x: 130, y: 100, elevation: 0 },
    distancePx: 40,
    obstacles: [wall],
  });
  approx(r.actualPx, 40);
  assert.equal(r.wallSlam, false);
});

test('tiny pushes never slam (below WALL_SLAM_MIN_INTENDED_PX)', () => {
  const wall = { x: 140, y: 0, w: 20, h: 200 };
  const r = resolveKnockback({
    fromX: 100, fromY: 100,
    target: { x: 130, y: 100, elevation: 0 },
    distancePx: 8, // < WALL_SLAM_MIN_INTENDED_PX (12)
    obstacles: [wall],
  });
  assert.equal(r.wallSlam, false);
});

test('pinned against room bounds → wall slam', () => {
  const r = resolveKnockback({
    fromX: 100, fromY: 100,
    target: { x: 130, y: 100, elevation: 0 },
    distancePx: 40,
    bounds: { minX: 0, maxX: 135, minY: 0, maxY: 200 },
  });
  assert.ok(r.x <= 135);
  assert.equal(r.wallSlam, true);
});

// ─── resolveKnockback — elevation ─────────────────────────────────────────────

console.log('\nresolveKnockback — elevation');

test('elevated target pushed across the platform edge drops to ground', () => {
  const platform = { x: 0, y: 0, w: 200, h: 200, steps: [] };
  const r = resolveKnockback({
    fromX: 120, fromY: 100,
    target: { x: 180, y: 100, elevation: 1 },
    distancePx: 40,
    obstacles: [], // elevated targets don't collide with the perimeter
    platforms: [platform],
  });
  assert.ok(r.x > 200, 'carried past the edge');
  assert.equal(r.elevation, 0);
  assert.equal(r.droppedElevation, true);
  assert.equal(r.wallSlam, false);
});

test('elevated target pushed within the platform keeps elevation', () => {
  const platform = { x: 0, y: 0, w: 400, h: 400, steps: [] };
  const r = resolveKnockback({
    fromX: 100, fromY: 200,
    target: { x: 140, y: 200, elevation: 1 },
    distancePx: 30,
    obstacles: [],
    platforms: [platform],
  });
  assert.equal(r.elevation, 1);
  assert.equal(r.droppedElevation, false);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
if (failed > 0) process.exit(1);
