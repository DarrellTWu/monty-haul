// shared/tests/combat.test.js
// ─────────────────────────────────────────────────────────────────
// Tests for shared/logic/combat.js.
// Run with: node shared/tests/combat.test.js
//
// No test framework — uses node:assert and a plain pass/fail counter.
// All randomness is controlled via sequence RNG functions; Math.random is
// never called in these tests.

import assert from 'node:assert/strict';
import { resolveAttack, applyDamage, rollDice, getModifier, getProficiencyBonus } from '../logic/combat.js';

// ─── Deterministic RNG helpers ────────────────────────────────────────────────

/**
 * Returns an rng that yields each value in `vals` in order.
 * Throws if the test consumes more values than provided (catches under-specified tests).
 *
 * Each value represents a raw rng() return in [0, 1).
 * For rollDice(count, sides, rng): die result = Math.floor(rng() * sides) + 1
 *   → To get die result N on a dX: pass (N - 1) / X  (e.g. d20=10 → 9/20 = 0.45)
 */
function seq(...vals) {
  let i = 0;
  return () => {
    if (i >= vals.length) throw new Error(`seq RNG exhausted after ${vals.length} calls`);
    return vals[i++];
  };
}

// Convenience: rng value that produces die result N on a die with `sides` faces.
const die = (n, sides) => (n - 1) / sides;

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

// ─── Shared fixtures ──────────────────────────────────────────────────────────

/** Level 1 fighter, STR 16 (+3 mod), proficiency +2. */
const makePlayer = (overrides = {}) => ({
  id: 'p1',
  hp: 20,
  maxHp: 20,
  ac: 15,
  level: 1,
  abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
  conditions: [],
  weaponSlot: null,
  ...overrides,
});

/** Standard longsword: 1d8 slashing, no magic bonus. */
const longsword = {
  id: 'longsword',
  damageDice: { count: 1, sides: 8 },
  damageBonus: 0,
  damageType: 'slashing',
  enhancement: 0,
  attackAbility: 'str',
  properties: ['versatile'],
};

/** Low-AC target — anything above a raw d20=2 should hit a basic attacker. */
const makeTarget = (overrides = {}) => ({
  id: 't1',
  hp: 30,
  maxHp: 30,
  ac: 8,
  resistances: [],
  ...overrides,
});

// ─── Utility function tests ───────────────────────────────────────────────────

console.log('\nUtility functions');

test('getModifier: score 10 → 0', () => {
  assert.equal(getModifier(10), 0);
});

test('getModifier: score 16 → +3', () => {
  assert.equal(getModifier(16), 3);
});

test('getModifier: score 8 → -1', () => {
  assert.equal(getModifier(8), -1);
});

test('getModifier: score 1 → -5', () => {
  assert.equal(getModifier(1), -5);
});

test('getProficiencyBonus: level 1 → +2', () => {
  assert.equal(getProficiencyBonus(1), 2);
});

test('getProficiencyBonus: level 4 → +2', () => {
  assert.equal(getProficiencyBonus(4), 2);
});

test('getProficiencyBonus: level 5 → +3', () => {
  assert.equal(getProficiencyBonus(5), 3);
});

test('getProficiencyBonus: level 17 → +6', () => {
  assert.equal(getProficiencyBonus(17), 6);
});

test('rollDice: produces values in [1, sides]', () => {
  // Use a sequence that covers low, mid, and high rng values.
  const rng = seq(0.0, 0.49, 0.99);
  assert.equal(rollDice(1, 6, rng), 1);
  assert.equal(rollDice(1, 6, rng), 3);
  assert.equal(rollDice(1, 6, rng), 6);
});

test('rollDice: sums multiple dice', () => {
  // 2d6: first die = 3 (rng=2/6), second die = 5 (rng=4/6)
  const rng = seq(die(3, 6), die(5, 6));
  assert.equal(rollDice(2, 6, rng), 8);
});

// ─── resolveAttack tests ──────────────────────────────────────────────────────

console.log('\nresolveAttack');

test('clear hit against low-AC target', () => {
  // Attacker: STR 16 (+3), proficiency +2 → attack bonus +5.
  // d20 = 10, total = 15. Target AC 8. Hit expected.
  // Damage: d8 = 5; total = 5 + 3 (str mod) = 8.
  const rng = seq(die(10, 20), die(5, 8));
  const result = resolveAttack({
    attacker: makePlayer(),
    target: makeTarget({ ac: 8 }),
    weapon: longsword,
    rng,
  });
  assert.equal(result.hit, true, 'should be a hit');
  assert.equal(result.crit, false, 'should not be a crit');
  assert.equal(result.roll, 15, 'roll = d20(10) + str(3) + prof(2)');
  assert.equal(result.damage, 8, 'damage = d8(5) + str(3)');
});

test('clear miss against high-AC target', () => {
  // d20 = 5, total = 5 + 5 = 10. Target AC 25. Miss expected.
  const rng = seq(die(5, 20));
  const result = resolveAttack({
    attacker: makePlayer(),
    target: makeTarget({ ac: 25 }),
    weapon: longsword,
    rng,
  });
  assert.equal(result.hit, false, 'should miss');
  assert.equal(result.damage, 0, 'no damage on miss');
  assert.equal(result.roll, 10, 'roll = d20(5) + str(3) + prof(2)');
});

test('natural 1 auto-miss despite high attack bonus against very low AC', () => {
  // Player STR 20 (+5), proficiency +2, target AC 2.
  // Without auto-miss: 1 + 5 + 2 = 8 ≥ 2 → would hit.
  // Natural 1 must override: result must be a miss.
  const highStrPlayer = makePlayer({ abilityScores: { str: 20, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  const rng = seq(die(1, 20)); // d20 = 1
  const result = resolveAttack({
    attacker: highStrPlayer,
    target: makeTarget({ ac: 2 }),
    weapon: longsword,
    rng,
  });
  assert.equal(result.hit, false, 'natural 1 must be an auto-miss');
  assert.equal(result.crit, false);
  assert.equal(result.damage, 0);
  // roll returns the raw d20 on a nat-1 (function exits before computing total).
  assert.equal(result.roll, 1);
});

test('natural 20 auto-hit against very high AC with crit damage', () => {
  // Target AC 30 — unhittable without a natural 20.
  // Attacker: STR 10 (+0), proficiency +2 → attack bonus +2.
  // Crit: total damage (dice + bonuses) × CRIT_MULTIPLIER.
  // d8 = 6, flat bonus = 0. Total = (6 + 0) × 2 = 12.
  const neutralPlayer = makePlayer({ abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  const rng = seq(die(20, 20), die(6, 8));
  const result = resolveAttack({
    attacker: neutralPlayer,
    target: makeTarget({ ac: 30 }),
    weapon: longsword,
    rng,
  });
  assert.equal(result.hit, true, 'natural 20 must be an auto-hit');
  assert.equal(result.crit, true, 'natural 20 must be flagged as crit');
  assert.equal(result.roll, 22, 'roll = d20(20) + str(0) + prof(2)');
  assert.equal(result.damage, 12, 'crit damage = (d8(6) + str(0)) × 2');
});

test('weapon enhancement applies to both attack roll and damage', () => {
  // +2 longsword: attack bonus = str(3) + prof(2) + enhancement(2) = +7.
  // d20 = 8, total = 15. Target AC 14. Hit.
  // Damage: d8 = 4 + str(3) + enhancement(2) = 9.
  const magicSword = { ...longsword, enhancement: 2 };
  const rng = seq(die(8, 20), die(4, 8));
  const result = resolveAttack({
    attacker: makePlayer(),
    target: makeTarget({ ac: 14 }),
    weapon: magicSword,
    rng,
  });
  assert.equal(result.hit, true);
  assert.equal(result.roll, 15, 'roll = d20(8) + str(3) + prof(2) + enh(2)');
  assert.equal(result.damage, 9, 'damage = d8(4) + str(3) + enh(2)');
});

test('Bless condition adds +1d4 to attack roll and can turn a miss into a hit', () => {
  // Attacker: STR 10 (+0), proficiency +2, conditions: ['bless'].
  // d20 = 10, attack bonus = +2. Without Bless: total = 12 < target AC 14 → miss.
  // Bless d4 = 3 → total = 12 + 3 = 15 ≥ 14 → hit.
  // Damage: d8 = 4 + str(0) = 4.
  const neutralPlayer = makePlayer({ abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  const rng = seq(
    die(10, 20), // d20 = 10
    die(3, 4),   // Bless d4 = 3
    die(4, 8),   // damage d8 = 4
  );
  const result = resolveAttack({
    attacker: neutralPlayer,
    target: makeTarget({ ac: 14 }),
    weapon: longsword,
    conditions: ['bless'],
    rng,
  });
  assert.equal(result.hit, true, 'Bless should push a near-miss into a hit');
  assert.equal(result.roll, 15, 'roll = d20(10) + prof(2) + bless(3)');
  assert.equal(result.damage, 4, 'damage = d8(4) + str(0)');
});

test('Bless on attacker.conditions (not explicit param) is respected', () => {
  // Same scenario as above but bless comes from attacker.conditions, not the param.
  const neutralPlayer = makePlayer({
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    conditions: ['bless'],
  });
  const rng = seq(die(10, 20), die(3, 4), die(4, 8));
  const result = resolveAttack({
    attacker: neutralPlayer,
    target: makeTarget({ ac: 14 }),
    weapon: longsword,
    // conditions not passed — should fall back to attacker.conditions
    rng,
  });
  assert.equal(result.hit, true);
  assert.equal(result.roll, 15);
});

// ─── applyDamage tests ────────────────────────────────────────────────────────

console.log('\napplyDamage');

test('standard damage reduces HP correctly', () => {
  const target = makeTarget({ hp: 30, resistances: [] });
  const result = applyDamage({ target, damage: 8, damageType: 'slashing' });
  assert.equal(result.newHP, 22);
  assert.equal(result.overkill, 0);
});

test('damage resistance halves damage (floor)', () => {
  const target = makeTarget({ hp: 20, resistances: ['slashing'] });
  const result = applyDamage({ target, damage: 7, damageType: 'slashing' });
  // floor(7 / 2) = 3
  assert.equal(result.newHP, 17, 'halved damage should floor to 3');
  assert.equal(result.overkill, 0);
});

test('damage resistance does not apply to non-matching damage type', () => {
  const target = makeTarget({ hp: 20, resistances: ['fire'] });
  const result = applyDamage({ target, damage: 6, damageType: 'slashing' });
  assert.equal(result.newHP, 14, 'full damage applies when type does not match resistance');
});

test('minimum 1 damage: resistance halving a 1-damage hit does not result in 0', () => {
  // 1 damage halved by resistance = floor(0.5) = 0 → clamp to min 1.
  const target = makeTarget({ hp: 20, resistances: ['piercing'] });
  const result = applyDamage({ target, damage: 1, damageType: 'piercing' });
  assert.equal(result.newHP, 19, 'minimum 1 damage should still deal 1 HP');
});

test('overkill is calculated correctly when damage exceeds remaining HP', () => {
  const target = makeTarget({ hp: 5, resistances: [] });
  const result = applyDamage({ target, damage: 12, damageType: 'bludgeoning' });
  assert.equal(result.newHP, 0, 'HP should not go below 0');
  assert.equal(result.overkill, 7, 'overkill = damage(12) - hp(5)');
});

test('exact-HP damage: newHP = 0, overkill = 0', () => {
  const target = makeTarget({ hp: 10, resistances: [] });
  const result = applyDamage({ target, damage: 10, damageType: 'slashing' });
  assert.equal(result.newHP, 0);
  assert.equal(result.overkill, 0);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);

if (failed > 0) {
  process.exit(1);
}
