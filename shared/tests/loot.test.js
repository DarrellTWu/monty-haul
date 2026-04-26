// shared/tests/loot.test.js
// ─────────────────────────────────────────────────────────────────
// Tests for shared/logic/loot.js.
// Run with: node shared/tests/loot.test.js
//
// No test framework — uses node:assert and a plain pass/fail counter.
// All randomness is controlled via deterministic rng functions.

import assert from 'node:assert/strict';
import { rollLoot }            from '../logic/loot.js';
import { GOBLIN_LOOT, SKELETON_LOOT, DOG_LOOT } from '../data/loot/tier1.js';
import { CONSUMABLE_REGISTRY } from '../data/items/consumables.js';

// ─── Deterministic RNG helpers ────────────────────────────────────────────────

/**
 * Returns an rng that yields each value in `vals` in order.
 * Throws if the test consumes more values than provided.
 */
function seq(...vals) {
  let i = 0;
  return () => {
    if (i >= vals.length) throw new Error(`seq RNG exhausted after ${vals.length} calls`);
    return vals[i++];
  };
}

// rng value that produces die result N on a die with `sides` faces.
const die = (n, sides) => (n - 1) / sides;

/**
 * Simple LCG for statistical-rate tests. Same seed produces the same stream,
 * so tests are reproducible without depending on Math.random's quality.
 */
function lcg(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// ─── Test harness ─────────────────────────────────────────────────────────────

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

// ─── Structural tests ─────────────────────────────────────────────────────────

console.log('\nrollLoot — structure');

test('null table → empty result', () => {
  assert.deepEqual(rollLoot(null, () => 0.5), { gold: 0, items: [] });
});

test('undefined table → empty result', () => {
  assert.deepEqual(rollLoot(undefined, () => 0.5), { gold: 0, items: [] });
});

test('table with null gold and empty drops → empty result', () => {
  assert.deepEqual(rollLoot({ gold: null, drops: [] }, () => 0), { gold: 0, items: [] });
});

test('table with no drops field → no items rolled', () => {
  // Only gold rolls should consume rng. seq has 1 value; if drops were iterated, seq would throw.
  const result = rollLoot({ gold: { dice: { count: 1, sides: 4 }, bonus: 0 } }, seq(die(2, 4)));
  assert.equal(result.gold, 2);
  assert.deepEqual(result.items, []);
});

// ─── Gold rolls ───────────────────────────────────────────────────────────────

console.log('\nrollLoot — gold');

test('rolls dice and adds bonus', () => {
  // 2d6: 4 + 5 = 9
  const result = rollLoot(
    { gold: { dice: { count: 2, sides: 6 }, bonus: 0 }, drops: [] },
    seq(die(4, 6), die(5, 6)),
  );
  assert.equal(result.gold, 9);
});

test('bonus is added on top of dice', () => {
  // 1d4=3 + bonus 5 = 8
  const result = rollLoot(
    { gold: { dice: { count: 1, sides: 4 }, bonus: 5 }, drops: [] },
    seq(die(3, 4)),
  );
  assert.equal(result.gold, 8);
});

test('omitted bonus defaults to 0', () => {
  const result = rollLoot(
    { gold: { dice: { count: 1, sides: 4 } }, drops: [] },
    seq(die(3, 4)),
  );
  assert.equal(result.gold, 3);
});

test('null gold → 0 with no rng consumption', () => {
  // seq with no values: if gold rolls were attempted, seq would throw.
  const result = rollLoot({ gold: null, drops: [] }, seq());
  assert.equal(result.gold, 0);
});

// ─── Drop chance rolls ────────────────────────────────────────────────────────

console.log('\nrollLoot — drop chance');

test('rng below chance → drop succeeds', () => {
  const result = rollLoot(
    { gold: null, drops: [{ itemId: 'foo', chance: 0.5, qty: 1 }] },
    seq(0.1),
  );
  assert.deepEqual(result.items, ['foo']);
});

test('rng equal to chance → drop fails (strict <)', () => {
  const result = rollLoot(
    { gold: null, drops: [{ itemId: 'foo', chance: 0.5, qty: 1 }] },
    seq(0.5),
  );
  assert.deepEqual(result.items, []);
});

test('rng above chance → drop fails', () => {
  const result = rollLoot(
    { gold: null, drops: [{ itemId: 'foo', chance: 0.5, qty: 1 }] },
    seq(0.9),
  );
  assert.deepEqual(result.items, []);
});

test('chance 0 never drops', () => {
  const result = rollLoot(
    { gold: null, drops: [{ itemId: 'foo', chance: 0, qty: 1 }] },
    seq(0.0),
  );
  assert.deepEqual(result.items, []);
});

test('chance 1 always drops', () => {
  const result = rollLoot(
    { gold: null, drops: [{ itemId: 'foo', chance: 1, qty: 1 }] },
    seq(0.999),
  );
  assert.deepEqual(result.items, ['foo']);
});

test('qty > 1 produces multiple copies of the resolved id', () => {
  const result = rollLoot(
    { gold: null, drops: [{ itemId: 'foo', chance: 1, qty: 3 }] },
    seq(0.0),
  );
  assert.deepEqual(result.items, ['foo', 'foo', 'foo']);
});

test('qty omitted defaults to 1', () => {
  const result = rollLoot(
    { gold: null, drops: [{ itemId: 'foo', chance: 1 }] },
    seq(0.0),
  );
  assert.deepEqual(result.items, ['foo']);
});

test('multiple drop entries roll independently in order', () => {
  // chance rolls: 0.1 succeed, 0.9 fail, 0.1 succeed
  const result = rollLoot(
    {
      gold: null,
      drops: [
        { itemId: 'a', chance: 0.5, qty: 1 },
        { itemId: 'b', chance: 0.5, qty: 1 },
        { itemId: 'c', chance: 0.5, qty: 1 },
      ],
    },
    seq(0.1, 0.9, 0.1),
  );
  assert.deepEqual(result.items, ['a', 'c']);
});

// ─── Pool references ──────────────────────────────────────────────────────────

console.log('\nrollLoot — pool references');

// Mirror of POOLS.potion_any in shared/logic/loot.js. Must stay in sync —
// the explicit "no extraction_scroll" test below pins the exclusion intent.
const POTION_IDS = Object.values(CONSUMABLE_REGISTRY)
  .filter(c => c.type !== 'extract')
  .map(c => c.id);

test('@potion_any picks first pool entry on rng=0', () => {
  const result = rollLoot(
    { gold: null, drops: [{ itemId: '@potion_any', chance: 1, qty: 1 }] },
    seq(0.0, 0.0), // chance roll, then pool pick
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0], POTION_IDS[0]);
});

test('@potion_any picks last pool entry on rng→1', () => {
  const result = rollLoot(
    { gold: null, drops: [{ itemId: '@potion_any', chance: 1, qty: 1 }] },
    seq(0.0, 0.999),
  );
  assert.equal(result.items[0], POTION_IDS[POTION_IDS.length - 1]);
});

test('@potion_any never returns extraction_scroll (run-control item, not loot)', () => {
  // Many trials with random rngs; extraction_scroll must never appear.
  const rng = lcg(99);
  for (let i = 0; i < 5000; i++) {
    const result = rollLoot(
      { gold: null, drops: [{ itemId: '@potion_any', chance: 1, qty: 1 }] },
      rng,
    );
    assert.notEqual(result.items[0], 'extraction_scroll');
  }
});

test('failed chance does NOT consume pool rng', () => {
  // chance=1, fail (rng=1 >= chance=1). Pool pick should NOT be attempted.
  // seq has only 1 value — if pool resolution ran, seq would throw.
  const result = rollLoot(
    { gold: null, drops: [{ itemId: '@potion_any', chance: 1, qty: 1 }] },
    seq(1.0),
  );
  assert.deepEqual(result.items, []);
});

test('unknown @pool resolves to nothing, drop silently skipped', () => {
  // chance success consumes 1 rng; unknown pool returns null without consuming rng.
  const result = rollLoot(
    { gold: null, drops: [{ itemId: '@nonexistent', chance: 1, qty: 1 }] },
    seq(0.0),
  );
  assert.deepEqual(result.items, []);
});

test('literal id (no @ prefix) does NOT consume pool rng', () => {
  // Only chance check should consume rng; resolveItemId returns the literal directly.
  const result = rollLoot(
    { gold: null, drops: [{ itemId: 'foo', chance: 1, qty: 1 }] },
    seq(0.0),
  );
  assert.deepEqual(result.items, ['foo']);
});

// ─── Tier 1 table integration ─────────────────────────────────────────────────

console.log('\nTier 1 tables');

test('GOBLIN_LOOT: 2d6 gold + 25% potion drop succeeds', () => {
  // gold 2d6 = 3+4=7; chance roll 0.1 < 0.25 → success; pool pick → first potion.
  const ids = Object.keys(CONSUMABLE_REGISTRY);
  const result = rollLoot(GOBLIN_LOOT, seq(die(3, 6), die(4, 6), 0.1, 0.0));
  assert.equal(result.gold, 7);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0], ids[0]);
  assert.ok(CONSUMABLE_REGISTRY[result.items[0]], 'item must be a registered consumable');
});

test('GOBLIN_LOOT: potion drop fails when rng >= 0.25', () => {
  const result = rollLoot(GOBLIN_LOOT, seq(die(1, 6), die(1, 6), 0.5));
  assert.equal(result.gold, 2);
  assert.deepEqual(result.items, []);
});

test('SKELETON_LOOT: 1d4 gold + bone drop succeeds at 75%', () => {
  // 1d4=2; chance 0.5 < 0.75 → success; literal id, no pool rng.
  const result = rollLoot(SKELETON_LOOT, seq(die(2, 4), 0.5));
  assert.equal(result.gold, 2);
  assert.deepEqual(result.items, ['skeleton_bone']);
});

test('SKELETON_LOOT: bone drop fails at rng=0.9', () => {
  const result = rollLoot(SKELETON_LOOT, seq(die(4, 4), 0.9));
  assert.equal(result.gold, 4);
  assert.deepEqual(result.items, []);
});

test('DOG_LOOT: no gold rolled, pelt drop succeeds at 75%', () => {
  const result = rollLoot(DOG_LOOT, seq(0.5));
  assert.equal(result.gold, 0);
  assert.deepEqual(result.items, ['wolf_pelt']);
});

test('DOG_LOOT: pelt drop fails at rng=0.9', () => {
  const result = rollLoot(DOG_LOOT, seq(0.9));
  assert.equal(result.gold, 0);
  assert.deepEqual(result.items, []);
});

// ─── Statistical sanity (deterministic LCG, large sample) ─────────────────────

console.log('\nStatistical sanity (10k trials, fixed LCG seed)');

test('GOBLIN potion drop rate ≈ 25% over 10k trials', () => {
  const rng = lcg(42);
  let drops = 0;
  for (let i = 0; i < 10000; i++) {
    if (rollLoot(GOBLIN_LOOT, rng).items.length > 0) drops++;
  }
  const rate = drops / 10000;
  assert.ok(rate > 0.22 && rate < 0.28, `expected ~25%, got ${(rate * 100).toFixed(2)}%`);
});

test('SKELETON bone drop rate ≈ 75% over 10k trials', () => {
  const rng = lcg(42);
  let drops = 0;
  for (let i = 0; i < 10000; i++) {
    if (rollLoot(SKELETON_LOOT, rng).items.length > 0) drops++;
  }
  const rate = drops / 10000;
  assert.ok(rate > 0.72 && rate < 0.78, `expected ~75%, got ${(rate * 100).toFixed(2)}%`);
});

test('GOBLIN gold averages ≈ 7 (2d6 expected value) over 10k trials', () => {
  const rng = lcg(42);
  let total = 0;
  for (let i = 0; i < 10000; i++) total += rollLoot(GOBLIN_LOOT, rng).gold;
  const avg = total / 10000;
  assert.ok(avg > 6.7 && avg < 7.3, `expected avg ~7, got ${avg.toFixed(3)}`);
});

test('determinism: same seed produces identical output', () => {
  const a = rollLoot(GOBLIN_LOOT, lcg(123));
  const b = rollLoot(GOBLIN_LOOT, lcg(123));
  assert.deepEqual(a, b);
});

test('@potion_any uniformly samples all pool entries', () => {
  // Over many trials, each pool member should appear with roughly equal frequency.
  const rng = lcg(7);
  const counts = {};
  for (let i = 0; i < 8000; i++) {
    const result = rollLoot(
      { gold: null, drops: [{ itemId: '@potion_any', chance: 1, qty: 1 }] },
      rng,
    );
    counts[result.items[0]] = (counts[result.items[0]] ?? 0) + 1;
  }
  const expected = 8000 / POTION_IDS.length;
  for (const id of POTION_IDS) {
    const got = counts[id] ?? 0;
    // ~2000 each for 4 potions. Allow ±15% spread.
    assert.ok(
      got > expected * 0.85 && got < expected * 1.15,
      `${id}: expected ~${expected}, got ${got}`,
    );
  }
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
if (failed > 0) process.exit(1);
