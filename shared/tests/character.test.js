// shared/tests/character.test.js
// ─────────────────────────────────────────────────────────────────
// Tests for shared/logic/character.js (validateAbilityScores).
// Run with: node shared/tests/character.test.js

import { validateAbilityScores } from '../logic/character.js';
import { POINT_BUY_BUDGET, SCORE_MIN, SCORE_MAX } from '../data/constants.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n    ${e.message}`); failed++; }
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// All-8s is the canonical zero-cost baseline.
const baseline = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };

console.log('validateAbilityScores — happy path');
test('all 8s is valid (0 cost)', () => {
  assertEq(validateAbilityScores(baseline).ok, true);
});
test('canonical fighter loadout (15/14/13/12/10/8) is valid', () => {
  // Standard 27-pt build that totals exactly the budget.
  assertEq(validateAbilityScores({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }).ok, true);
});

console.log('\nvalidateAbilityScores — rejects bad shapes');
test('null → error', () => {
  const r = validateAbilityScores(null);
  assertEq(r.ok, false);
});
test('non-object → error', () => {
  assertEq(validateAbilityScores('hello').ok, false);
  assertEq(validateAbilityScores(42).ok, false);
});
test('missing key → error', () => {
  const { str, ...rest } = baseline;
  assertEq(validateAbilityScores(rest).ok, false);
});
test('non-integer score → error', () => {
  assertEq(validateAbilityScores({ ...baseline, str: 10.5 }).ok, false);
  assertEq(validateAbilityScores({ ...baseline, str: '10' }).ok, false);
});

console.log('\nvalidateAbilityScores — range');
test(`score below SCORE_MIN (${SCORE_MIN}) → error`, () => {
  assertEq(validateAbilityScores({ ...baseline, str: SCORE_MIN - 1 }).ok, false);
});
test(`score above SCORE_MAX (${SCORE_MAX}) → error`, () => {
  assertEq(validateAbilityScores({ ...baseline, str: SCORE_MAX + 1 }).ok, false);
});

console.log('\nvalidateAbilityScores — budget');
test('over-budget all-15s → error', () => {
  const r = validateAbilityScores({ str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 });
  assertEq(r.ok, false);
});
test(`error string mentions budget ${POINT_BUY_BUDGET}`, () => {
  const r = validateAbilityScores({ str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 });
  if (!r.error?.includes(String(POINT_BUY_BUDGET))) {
    throw new Error(`error string should mention budget: ${r.error}`);
  }
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
process.exit(failed === 0 ? 0 : 1);
