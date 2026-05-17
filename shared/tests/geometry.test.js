// shared/tests/geometry.test.js
// ─────────────────────────────────────────────────────────────────
// Tests for shared/logic/geometry.js.
// Run with: node shared/tests/geometry.test.js
//
// No test framework — uses node:assert and a plain pass/fail counter.

import assert from 'node:assert/strict';
import {
  resolveWallCollision,
  isLineBlocked,
  tryAutoClimb,
  segmentIntersectsCircle,
  segmentPerimeterCrossing,
  pointInRect,
  platformPerimeterRects,
  circleOverlapsAny,
} from '../logic/geometry.js';
import {
  ENTITY_RADIUS_PX, STEP_HALF_WIDTH_PX, PLATFORM_WALL_THICK_PX,
} from '../data/constants.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${e.message}`);
    failed++;
  }
}

function group(label, body) {
  console.log(`\n${label}`);
  body();
}

// Helper: a sample wall rect we can re-use.
const wall = (x, y, w, h) => ({ x, y, w, h });

// Helper: assert two numbers are close (floating point).
function near(actual, expected, eps = 0.0001, msg = '') {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `${msg} expected ≈ ${expected}, got ${actual}`,
  );
}

// ─── resolveWallCollision ────────────────────────────────────────────────────

group('resolveWallCollision', () => {
  test('no overlap → position unchanged', () => {
    const out = resolveWallCollision({ x: 100, y: 100 }, [wall(200, 200, 50, 50)]);
    assert.equal(out.x, 100);
    assert.equal(out.y, 100);
  });

  test('head-on penetration from left → pushed left', () => {
    // Wall spans x=200..250. Circle center at x=210 (10 inside left edge),
    // radius 16. Closest point is (200, y), dx=+10, dist=10, push=6 → x=216.
    // Wait — circle center inside the rect uses the MTV branch.
    // x=210, leftPen=10, rightPen=40, topPen=10, bottomPen=10. leftPen ties
    // with topPen and bottomPen at 10. Math.min returns 10 (first match).
    // We need an unambiguous case: put y outside the y-axis penetration ties.
    // Easier: place center clearly inside but with one minimum penetration.
    const out = resolveWallCollision({ x: 205, y: 225 }, [wall(200, 200, 50, 50)]);
    // x=205, y=225 inside rect. leftPen=5, rightPen=45, topPen=25, bottomPen=25.
    // minPen = leftPen=5 → push to x = 200 - 16 = 184.
    near(out.x, 184);
    near(out.y, 225);
  });

  test('head-on penetration from right → pushed right', () => {
    // x=245, y=225 inside rect 200..250 × 200..250.
    // leftPen=45, rightPen=5, topPen=25, bottomPen=25. minPen=rightPen=5.
    // push to x = 250 + 16 = 266.
    const out = resolveWallCollision({ x: 245, y: 225 }, [wall(200, 200, 50, 50)]);
    near(out.x, 266);
    near(out.y, 225);
  });

  test('approaching from outside (closest-point branch) → pushed radially', () => {
    // Wall corner at (200,200). Circle just past the corner, dist < radius.
    // Center at (195, 195): dx=-5, dy=-5 from corner, dist≈7.07, push=16-7.07≈8.93.
    // Pushed along (-5,-5)/7.07 = (-0.707,-0.707), so new pos ≈ (195-6.31, 195-6.31) = (188.69, 188.69).
    const out = resolveWallCollision({ x: 195, y: 195 }, [wall(200, 200, 50, 50)]);
    near(out.x, 195 + (-5 / Math.sqrt(50)) * (ENTITY_RADIUS_PX - Math.sqrt(50)));
    near(out.y, 195 + (-5 / Math.sqrt(50)) * (ENTITY_RADIUS_PX - Math.sqrt(50)));
  });

  test('exactly on edge (grazing) → no push (distSq === radius²)', () => {
    // Circle radius 16. Closest point exactly 16 away from center → distSq === radius².
    // Center at (216, 225), wall x=200..250 → closest x=216, but wait we need
    // the center OUTSIDE the wall, with closest point 16 away.
    // Put wall at x=200..250, center at (184, 225): closest point (200, 225),
    // dx=-16, dy=0, distSq=256 === radius². Not overlapping; no push.
    const out = resolveWallCollision({ x: 184, y: 225 }, [wall(200, 200, 50, 50)]);
    near(out.x, 184);
    near(out.y, 225);
  });

  test('multiple rects → resolved sequentially', () => {
    // Two walls that would each push the entity slightly. Resolution is
    // sequential, so we just sanity-check that both apply.
    const rects = [wall(200, 200, 50, 50), wall(100, 200, 50, 50)];
    const out = resolveWallCollision({ x: 175, y: 225 }, rects); // between the two walls
    // Center is outside both walls (gap from x=150 to x=200). distSq = 25² = 625, radius²=256.
    // No overlap → unchanged.
    near(out.x, 175);
    near(out.y, 225);
  });

  test('custom radius respected', () => {
    // Same head-on case but with radius=32 → push to x = 200 - 32 = 168.
    const out = resolveWallCollision({ x: 205, y: 225 }, [wall(200, 200, 50, 50)], 32);
    near(out.x, 168);
    near(out.y, 225);
  });
});

// ─── circleOverlapsAny ───────────────────────────────────────────────────────

group('circleOverlapsAny', () => {
  test('no rects → false', () => {
    assert.equal(circleOverlapsAny({ x: 100, y: 100 }, 16, []), false);
  });

  test('circle fully outside rect → false', () => {
    assert.equal(circleOverlapsAny({ x: 0, y: 0 }, 16, [wall(200, 200, 50, 50)]), false);
  });

  test('circle center inside rect → true', () => {
    assert.equal(circleOverlapsAny({ x: 220, y: 220 }, 16, [wall(200, 200, 50, 50)]), true);
  });

  test('circle clipping rect corner → true', () => {
    assert.equal(circleOverlapsAny({ x: 190, y: 190 }, 16, [wall(200, 200, 50, 50)]), true);
  });

  test('circle exactly tangent to rect (distSq == r²) → false', () => {
    assert.equal(circleOverlapsAny({ x: 184, y: 225 }, 16, [wall(200, 200, 50, 50)]), false);
  });

  test('overlaps any of multiple rects → true', () => {
    const rects = [wall(0, 0, 10, 10), wall(200, 200, 50, 50)];
    assert.equal(circleOverlapsAny({ x: 220, y: 220 }, 16, rects), true);
  });
});

// ─── segmentIntersectsCircle ─────────────────────────────────────────────────

group('segmentIntersectsCircle', () => {
  test('segment passes through circle center → true', () => {
    assert.equal(segmentIntersectsCircle(0, 100, 200, 100, 100, 100, 24), true);
  });

  test('segment endpoint inside circle → true', () => {
    assert.equal(segmentIntersectsCircle(95, 100, 200, 100, 100, 100, 24), true);
  });

  test('segment endpoint on circle boundary → true', () => {
    assert.equal(segmentIntersectsCircle(76, 100, 200, 100, 100, 100, 24), true);
  });

  test('segment far from circle → false', () => {
    assert.equal(segmentIntersectsCircle(0, 0, 200, 0, 100, 200, 24), false);
  });

  test('segment fully spans circle (both endpoints outside) → true', () => {
    // Segment from (0,100) to (300,100); circle at (150,100) r=24. Both
    // endpoints outside; segment passes straight through.
    assert.equal(segmentIntersectsCircle(0, 100, 300, 100, 150, 100, 24), true);
  });

  test('parallel segment that misses the circle → false', () => {
    assert.equal(segmentIntersectsCircle(0, 50, 300, 50, 150, 100, 24), false);
  });

  test('degenerate segment (point) inside circle → true', () => {
    assert.equal(segmentIntersectsCircle(100, 100, 100, 100, 100, 100, 24), true);
  });

  test('degenerate segment (point) outside circle → false', () => {
    assert.equal(segmentIntersectsCircle(200, 200, 200, 200, 100, 100, 24), false);
  });

  test('high-speed traversal (long segment) crosses small circle → true', () => {
    // Worst case: entity moves 20 px in one tick, half-width 24.
    // prev (90, 100), now (110, 100); circle at (100, 100) r=24. Passes through.
    assert.equal(segmentIntersectsCircle(90, 100, 110, 100, 100, 100, STEP_HALF_WIDTH_PX), true);
  });
});

// ─── segmentPerimeterCrossing ────────────────────────────────────────────────

group('segmentPerimeterCrossing', () => {
  const rect = { x: 100, y: 100, w: 200, h: 200 };

  test('both endpoints inside → null', () => {
    assert.equal(segmentPerimeterCrossing(150, 150, 200, 200, rect), null);
  });

  test('both endpoints outside (and not crossing) → null', () => {
    assert.equal(segmentPerimeterCrossing(0, 0, 50, 50, rect), null);
  });

  test('outside → inside → "inward"', () => {
    assert.equal(segmentPerimeterCrossing(50, 150, 150, 150, rect), 'inward');
  });

  test('inside → outside → "outward"', () => {
    assert.equal(segmentPerimeterCrossing(150, 150, 350, 150, rect), 'outward');
  });
});

// ─── pointInRect ─────────────────────────────────────────────────────────────

group('pointInRect', () => {
  const rect = { x: 100, y: 100, w: 200, h: 200 };

  test('interior point → true', () => {
    assert.equal(pointInRect(200, 200, rect), true);
  });

  test('exact corner (top-left) → true (inclusive)', () => {
    assert.equal(pointInRect(100, 100, rect), true);
  });

  test('exact corner (bottom-right) → true (inclusive)', () => {
    assert.equal(pointInRect(300, 300, rect), true);
  });

  test('outside left → false', () => {
    assert.equal(pointInRect(99, 200, rect), false);
  });

  test('outside top → false', () => {
    assert.equal(pointInRect(200, 99, rect), false);
  });
});

// ─── tryAutoClimb (perimeter-driven, post-bugfix) ────────────────────────────
//
// The collision wall list (built by MovementSystem) is what *gates* who can
// cross the perimeter — non-climbers get blocked except at step gaps, climbers
// pass through freely. tryAutoClimb itself just translates a perimeter
// crossing into an elevation change. So most tests here use elevation +
// pre/current positions; canClimb is no longer a parameter.

group('tryAutoClimb', () => {
  // Floor 1 layout: platform rect 680–980 × 480–720.
  const platform = { x: 680, y: 480, w: 300, h: 240 };

  test('zero-length segment (entity stationary) → no change', () => {
    const elev = tryAutoClimb({
      prevX: 800, prevY: 600, x: 800, y: 600, elevation: 1,
    }, [platform]);
    assert.equal(elev, 1);
  });

  test('segment crossing perimeter inward at elev 0 → elev 1', () => {
    // Entity made it past the perimeter (either via step gap or as climber)
    // — tryAutoClimb just elevates them.
    const elev = tryAutoClimb({
      prevX: 800, prevY: 470, x: 800, y: 495, elevation: 0,
    }, [platform]);
    assert.equal(elev, 1);
  });

  test('segment crossing perimeter outward at elev 1 → elev 0', () => {
    const elev = tryAutoClimb({
      prevX: 800, prevY: 495, x: 800, y: 470, elevation: 1,
    }, [platform]);
    assert.equal(elev, 0);
  });

  test('segment entirely outside platform → no change', () => {
    const elev = tryAutoClimb({
      prevX: 200, prevY: 200, x: 250, y: 250, elevation: 0,
    }, [platform]);
    assert.equal(elev, 0);
  });

  test('segment entirely inside platform → no change (already up there)', () => {
    const elev = tryAutoClimb({
      prevX: 800, prevY: 600, x: 820, y: 600, elevation: 1,
    }, [platform]);
    assert.equal(elev, 1);
  });

  test('inward crossing but already elev 1 → no change (defensive)', () => {
    // Shouldn't happen in practice, but guard against double-elevation.
    const elev = tryAutoClimb({
      prevX: 800, prevY: 470, x: 800, y: 495, elevation: 1,
    }, [platform]);
    assert.equal(elev, 1);
  });

  test('outward crossing but already elev 0 → no change (defensive)', () => {
    const elev = tryAutoClimb({
      prevX: 800, prevY: 495, x: 800, y: 470, elevation: 0,
    }, [platform]);
    assert.equal(elev, 0);
  });

  test('empty platforms array → no change', () => {
    const elev = tryAutoClimb({
      prevX: 100, prevY: 100, x: 200, y: 200, elevation: 0,
    }, []);
    assert.equal(elev, 0);
  });

  test('high-speed traversal still detects crossing', () => {
    // Entity moves 30 px in one tick, straight through the north edge.
    const elev = tryAutoClimb({
      prevX: 800, prevY: 460, x: 800, y: 490, elevation: 0,
    }, [platform]);
    assert.equal(elev, 1);
  });
});

// ─── platformPerimeterRects ──────────────────────────────────────────────────

group('platformPerimeterRects', () => {
  // Floor-1 platform: 300×240, step on each edge at x=800 (N/S) or y=600 (E/W).
  // Note: steps are NOT at the literal midpoint of N/S edges (edge midpoint is
  // x=830, but step is at x=800) — perimeter rects must read step locations
  // from platform.steps[], not assume midpoints.
  const platform = {
    x: 680, y: 480, w: 300, h: 240,
    steps: [
      { id: 'step_n', x: 800, y: 480 },
      { id: 'step_s', x: 800, y: 720 },
      { id: 'step_e', x: 980, y: 600 },
      { id: 'step_w', x: 680, y: 600 },
    ],
  };
  const rects = platformPerimeterRects(platform);

  test('returns exactly 8 rects (4 edges × 2 segments)', () => {
    assert.equal(rects.length, 8);
  });

  test('each rect has the configured wall thickness', () => {
    for (const r of rects) {
      // Horizontal bands have h=thick; vertical bands have w=thick.
      const matches = r.h === PLATFORM_WALL_THICK_PX || r.w === PLATFORM_WALL_THICK_PX;
      assert.ok(matches, `rect ${JSON.stringify(r)} has neither w nor h == ${PLATFORM_WALL_THICK_PX}`);
    }
  });

  test('step midpoint on each edge is NOT covered by any wall rect', () => {
    // Step midpoints (where the gap is).
    const midpoints = [
      { x: 800, y: 480 },   // north
      { x: 800, y: 720 },   // south
      { x: 980, y: 600 },   // east
      { x: 680, y: 600 },   // west
    ];
    for (const m of midpoints) {
      for (const r of rects) {
        const inside = m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h;
        assert.ok(!inside, `step midpoint ${JSON.stringify(m)} is inside rect ${JSON.stringify(r)} — gap missing`);
      }
    }
  });

  test('a point off-axis from any step IS covered by a wall rect (perimeter blocks)', () => {
    // x=750 on the north edge — well outside the 48 px step gap at x=800
    // (gap spans x=776..824). y=480 sits in the centered wall band y=479..481.
    const probe = { x: 750, y: 480 };
    let inAnyRect = false;
    for (const r of rects) {
      if (probe.x >= r.x && probe.x <= r.x + r.w && probe.y >= r.y && probe.y <= r.y + r.h) {
        inAnyRect = true;
        break;
      }
    }
    assert.ok(inAnyRect, 'point off-axis from step should be covered by the perimeter wall band');
  });

  test('step gap width equals 2 × STEP_HALF_WIDTH_PX (48 px) on the north edge', () => {
    // Find the two rects on the north edge (y centered on platform.y = 480).
    const northRects = rects.filter(r =>
      r.h === PLATFORM_WALL_THICK_PX && r.y < 481 && r.y > 478,
    );
    assert.equal(northRects.length, 2);
    const sorted = northRects.slice().sort((a, b) => a.x - b.x);
    const leftEnd  = sorted[0].x + sorted[0].w;
    const rightStart = sorted[1].x;
    assert.equal(rightStart - leftEnd, 2 * STEP_HALF_WIDTH_PX);
  });

  test('platform with no steps array → 4 full-edge wall rects (no gaps)', () => {
    const noSteps = platformPerimeterRects({ x: 0, y: 0, w: 100, h: 100 });
    assert.equal(noSteps.length, 4);
  });
});

// ─── isLineBlocked ───────────────────────────────────────────────────────────

group('isLineBlocked', () => {
  const losWall = { x: 100, y: 100, w: 50, h: 50 };

  test('clear segment through empty space → false', () => {
    assert.equal(isLineBlocked(0, 0, 1000, 1000, []), false);
  });

  test('segment crosses a wall rect → true', () => {
    assert.equal(isLineBlocked(0, 0, 200, 200, [losWall]), true);
  });

  test('segment that misses the wall → false', () => {
    assert.equal(isLineBlocked(0, 0, 90, 90, [losWall]), false);
  });

  test('horizontal segment crosses wall → true', () => {
    assert.equal(isLineBlocked(50, 125, 200, 125, [losWall]), true);
  });

  test('vertical segment crosses wall → true', () => {
    assert.equal(isLineBlocked(125, 50, 125, 200, [losWall]), true);
  });

  test('endpoint inside the wall → true', () => {
    assert.equal(isLineBlocked(0, 0, 125, 125, [losWall]), true);
  });

  test('segment passes above the wall → false', () => {
    assert.equal(isLineBlocked(0, 50, 200, 50, [losWall]), false);
  });

  test('caller-filtered obstacles: empty list = no blocking', () => {
    // Demonstrates that the helper trusts its input list. If the caller passes
    // only walls + LOCKED doors, unlocked doors are excluded and don't block.
    assert.equal(isLineBlocked(0, 0, 1000, 1000, []), false);
  });

  test('multiple obstacles: first miss, second hit → true', () => {
    const miss = { x: 1000, y: 1000, w: 10, h: 10 };
    assert.equal(isLineBlocked(0, 0, 200, 200, [miss, losWall]), true);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
