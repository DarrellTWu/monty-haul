// shared/tests/conditions.test.js
// ─────────────────────────────────────────────────────────────────
// Tests for shared/logic/conditions.js.
// Run with: node shared/tests/conditions.test.js
//
// No test framework — uses node:assert and a plain pass/fail counter.

import assert from 'node:assert/strict';
import {
  CONDITION_DEFS,
  applyCondition,
  tickConditions,
  clearPlayerConditions,
} from '../logic/conditions.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n    ${e.message}`); failed++; }
}

// PlayerState-shaped fake. `conditions` is a plain array; the real ArraySchema
// supports the same push/pop/includes/indexOf/splice surface this module uses.
function makePlayer(overrides = {}) {
  return {
    class: 'barbarian',
    conditions: [],
    blessRemainingMs: 0,
    longstriderRemainingMs: 0,
    falseLifeRemainingMs: 0,
    rageRemainingMs: 0,
    tempHp: 0,
    ...overrides,
  };
}

// ─── applyCondition ──────────────────────────────────────────────────────────
console.log('applyCondition');

test('adds condition + sets mirror + writes timer', () => {
  const p = makePlayer();
  const timers = new Map();
  const ok = applyCondition(p, 'bless', 60000, timers, 's1');
  assert.equal(ok, true);
  assert.deepEqual([...p.conditions], ['bless']);
  assert.equal(p.blessRemainingMs, 60000);
  assert.equal(timers.get('s1_bless'), 60000);
});

test('is idempotent: re-applying refreshes timer + mirror, no duplicate entry', () => {
  const p = makePlayer();
  const timers = new Map();
  applyCondition(p, 'bless', 60000, timers, 's1');
  applyCondition(p, 'bless', 30000, timers, 's1');
  assert.deepEqual([...p.conditions], ['bless']);
  assert.equal(p.blessRemainingMs, 30000);
  assert.equal(timers.get('s1_bless'), 30000);
});

test('sets correct mirror field for each known condition', () => {
  for (const id of Object.keys(CONDITION_DEFS)) {
    const p = makePlayer();
    const timers = new Map();
    applyCondition(p, id, 12345, timers, 's1');
    assert.equal(p[CONDITION_DEFS[id].mirrorField], 12345, `mirror for ${id}`);
  }
});

test('unknown condition id is a no-op (returns false)', () => {
  const p = makePlayer();
  const timers = new Map();
  const ok = applyCondition(p, 'paralyzed_by_owlbear', 5000, timers, 's1');
  assert.equal(ok, false);
  assert.deepEqual([...p.conditions], []);
  assert.equal(timers.size, 0);
});

// ─── tickConditions ──────────────────────────────────────────────────────────
console.log('\ntickConditions');

test('decrements timer + mirror by dt while > 0', () => {
  const p = makePlayer();
  const timers = new Map();
  applyCondition(p, 'bless', 1000, timers, 's1');
  const players = new Map([['s1', p]]);
  const logs = tickConditions(players, timers, 250);
  assert.deepEqual(logs, []);
  assert.equal(p.blessRemainingMs, 750);
  assert.equal(timers.get('s1_bless'), 750);
  assert.deepEqual([...p.conditions], ['bless']);
});

test('expiry removes condition, clears mirror, deletes timer entry', () => {
  const p = makePlayer();
  const timers = new Map();
  applyCondition(p, 'bless', 100, timers, 's1');
  const logs = tickConditions(new Map([['s1', p]]), timers, 100);
  assert.deepEqual(logs, []);
  assert.deepEqual([...p.conditions], []);
  assert.equal(p.blessRemainingMs, 0);
  assert.equal(timers.has('s1_bless'), false);
});

test('false_life expiry zeroes tempHp', () => {
  const p = makePlayer({ tempHp: 7 });
  const timers = new Map();
  applyCondition(p, 'false_life', 100, timers, 's1');
  tickConditions(new Map([['s1', p]]), timers, 200);
  assert.equal(p.tempHp, 0);
  assert.equal(p.falseLifeRemainingMs, 0);
});

test('rage expiry emits log; bless expiry does not', () => {
  const p = makePlayer({ class: 'barbarian' });
  const timers = new Map();
  applyCondition(p, 'rage', 100, timers, 's1');
  applyCondition(p, 'bless', 100, timers, 's1');
  const logs = tickConditions(new Map([['s1', p]]), timers, 200);
  assert.deepEqual(logs, [`Barbarian's Rage ends.`]);
});

test('handles multiple active conditions on one player independently', () => {
  const p = makePlayer();
  const timers = new Map();
  applyCondition(p, 'bless', 500, timers, 's1');
  applyCondition(p, 'longstrider', 1000, timers, 's1');
  tickConditions(new Map([['s1', p]]), timers, 500);
  // bless expired exactly at 0 → removed; longstrider still has 500 left.
  assert.deepEqual([...p.conditions], ['longstrider']);
  assert.equal(p.blessRemainingMs, 0);
  assert.equal(p.longstriderRemainingMs, 500);
});

test('two players: ticking one does not touch the other\'s timers', () => {
  const a = makePlayer();
  const b = makePlayer();
  const timers = new Map();
  applyCondition(a, 'bless', 1000, timers, 'sA');
  applyCondition(b, 'bless', 1000, timers, 'sB');
  tickConditions(new Map([['sA', a], ['sB', b]]), timers, 400);
  assert.equal(a.blessRemainingMs, 600);
  assert.equal(b.blessRemainingMs, 600);
  assert.equal(timers.get('sA_bless'), 600);
  assert.equal(timers.get('sB_bless'), 600);
});

test('false_life expires immediately when tempHp drained, even with timer remaining', () => {
  const p = makePlayer();
  const timers = new Map();
  applyCondition(p, 'false_life', 60000, timers, 's1');
  p.tempHp = 5;
  // Simulate damage absorbing all temp HP between ticks.
  p.tempHp = 0;
  tickConditions(new Map([['s1', p]]), timers, 16);
  assert.deepEqual([...p.conditions], []);
  assert.equal(p.falseLifeRemainingMs, 0);
  assert.equal(timers.has('s1_false_life'), false);
});

test('false_life with tempHp still > 0 continues ticking normally', () => {
  const p = makePlayer();
  const timers = new Map();
  applyCondition(p, 'false_life', 1000, timers, 's1');
  p.tempHp = 3;
  tickConditions(new Map([['s1', p]]), timers, 200);
  assert.deepEqual([...p.conditions], ['false_life']);
  assert.equal(p.falseLifeRemainingMs, 800);
  assert.equal(p.tempHp, 3);
});

test('refreshing false_life after exhaustion grants new temp HP + timer', () => {
  const p = makePlayer();
  const timers = new Map();
  applyCondition(p, 'false_life', 60000, timers, 's1');
  p.tempHp = 5;
  p.tempHp = 0; // drained
  tickConditions(new Map([['s1', p]]), timers, 16); // condition cleared
  assert.deepEqual([...p.conditions], []);
  // New potion: caller sets tempHp THEN applies the condition.
  p.tempHp = 7;
  applyCondition(p, 'false_life', 60000, timers, 's1');
  assert.deepEqual([...p.conditions], ['false_life']);
  assert.equal(p.tempHp, 7);
  assert.equal(p.falseLifeRemainingMs, 60000);
});

test('orphan condition with no timer entry expires immediately on next tick', () => {
  // Defensive: if conditions[] and timers ever desync (shouldn't happen via
  // applyCondition), the tick should clean up rather than loop forever.
  const p = makePlayer();
  p.conditions.push('bless');
  const timers = new Map(); // no entry for s1_bless
  tickConditions(new Map([['s1', p]]), timers, 16);
  assert.deepEqual([...p.conditions], []);
});

// ─── clearPlayerConditions ───────────────────────────────────────────────────
console.log('\nclearPlayerConditions');

test('wipes all active conditions + mirrors + timer entries for the session', () => {
  const p = makePlayer({ tempHp: 5 });
  const timers = new Map();
  applyCondition(p, 'bless', 1000, timers, 's1');
  applyCondition(p, 'rage', 1000, timers, 's1');
  applyCondition(p, 'false_life', 1000, timers, 's1');
  clearPlayerConditions(p, timers, 's1');
  assert.deepEqual([...p.conditions], []);
  assert.equal(p.blessRemainingMs, 0);
  assert.equal(p.rageRemainingMs, 0);
  assert.equal(p.falseLifeRemainingMs, 0);
  assert.equal(p.tempHp, 0, 'false_life onExpire ran');
  assert.equal(timers.has('s1_bless'), false);
  assert.equal(timers.has('s1_rage'), false);
  assert.equal(timers.has('s1_false_life'), false);
});

test('does NOT touch another session\'s timers', () => {
  const a = makePlayer();
  const b = makePlayer();
  const timers = new Map();
  applyCondition(a, 'bless', 1000, timers, 'sA');
  applyCondition(b, 'bless', 1000, timers, 'sB');
  clearPlayerConditions(a, timers, 'sA');
  assert.deepEqual([...a.conditions], []);
  assert.deepEqual([...b.conditions], ['bless']);
  assert.equal(b.blessRemainingMs, 1000);
  assert.equal(timers.get('sB_bless'), 1000);
});

test('does NOT emit logs (long rest is its own event)', () => {
  // clearPlayerConditions has no return value; verifying by signature/behavior
  // — onExpireLog is only called from tickConditions. Smoke test by clearing
  // rage and confirming no throw + no expectation of a log channel.
  const p = makePlayer({ class: 'barbarian' });
  const timers = new Map();
  applyCondition(p, 'rage', 1000, timers, 's1');
  const result = clearPlayerConditions(p, timers, 's1');
  assert.equal(result, undefined);
});

test('safe to call when player has no active conditions', () => {
  const p = makePlayer();
  const timers = new Map();
  clearPlayerConditions(p, timers, 's1'); // should not throw
  assert.deepEqual([...p.conditions], []);
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
