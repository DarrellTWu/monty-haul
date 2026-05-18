// shared/tests/class-progression.test.js
// Tests for shared/logic/class-progression.js.
// Run with: node shared/tests/class-progression.test.js

import {
  totalLevel, getClassLevel, getEligibleClassChoicesForLevelUp,
  getGrantedFeatures, getDerivedClassFeatures, applyClassLevel,
  computeHpGainForLevel, getMaxLevelForClass,
} from '../logic/class-progression.js';
import { CLASS_REGISTRY } from '../data/classes/index.js';
import { HP_MULTIPLIER, RAGE_USES } from '../data/constants.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n    ${e.message}`); failed++; }
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertTrue(v, msg) { if (!v) throw new Error(msg ?? 'expected truthy'); }

/** Minimal player stand-in. Uses Map / array for classLevels / levelUpHistory. */
function mkPlayer(overrides = {}) {
  return {
    classLevels:     new Map(),
    levelUpHistory:  [],
    level:           0,
    maxHp:           0,
    hp:              0,
    str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10,
    rageUsesRemaining:   0,
    secondWindAvailable: false,
    ...overrides,
  };
}

/** Seed a Fighter level 1 the way onJoin does: applyClassLevel then patch maxHp. */
function seedFighter(p) {
  applyClassLevel(p, 'fighter');
  // Join sets maxHp via getStartingHp; mirror that here.
  const conMod = Math.floor((p.con - 10) / 2);
  p.maxHp = Math.floor((CLASS_REGISTRY.fighter.hitDie + conMod) * HP_MULTIPLIER);
  p.hp    = p.maxHp;
}

console.log('class-progression.test.js');

test('totalLevel sums classLevels', () => {
  const p = mkPlayer();
  p.classLevels.set('fighter', 2);
  p.classLevels.set('monk', 1);
  assertEq(totalLevel(p), 3);
});

test('getClassLevel returns 0 for untaken class', () => {
  const p = mkPlayer();
  assertEq(getClassLevel(p, 'monk'), 0);
});

test('applyClassLevel seeds first-class state correctly', () => {
  const p = mkPlayer();
  const r = applyClassLevel(p, 'fighter');
  assertTrue(r.ok);
  assertEq(getClassLevel(p, 'fighter'), 1);
  assertEq(p.level, 1);
  assertEq(p.levelUpHistory.length, 1);
  assertEq(p.levelUpHistory[0], 'fighter');
  assertEq(p.secondWindAvailable, true);
  assertTrue(r.features.includes('second_wind'));
  assertEq(r.isFirstInClass, true);
});

test('applyClassLevel invariant: level === sum(classLevels)', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'barbarian');
  applyClassLevel(p, 'monk');
  let sum = 0;
  for (const v of p.classLevels.values()) sum += v;
  assertEq(p.level, sum);
  assertEq(p.levelUpHistory.length, p.level);
});

test('first Barbarian level (as multiclass) sets rageUsesRemaining = RAGE_USES', () => {
  const p = mkPlayer();
  seedFighter(p);
  assertEq(p.rageUsesRemaining, 0);
  const before = p.maxHp;
  const r = applyClassLevel(p, 'barbarian');
  assertEq(p.rageUsesRemaining, RAGE_USES);
  assertEq(r.isFirstInClass, true);
  assertTrue(p.maxHp > before, 'HP should bump on level 2+');
});

test('computeHpGainForLevel matches SRD-average formula', () => {
  const fighter = CLASS_REGISTRY.fighter;
  // hitDie 10, conMod 2 → floor((5 + 1 + 2) * HP_MULTIPLIER)
  assertEq(computeHpGainForLevel(fighter, 2), Math.floor((10 / 2 + 1 + 2) * HP_MULTIPLIER));
});

test('eligibility excludes already-taken classes', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  const elig = getEligibleClassChoicesForLevelUp(p);
  assertTrue(!elig.includes('fighter'));
  assertTrue(elig.includes('barbarian') && elig.includes('monk'));
});

test('getMaxLevelForClass returns gearless cap 3', () => {
  assertEq(getMaxLevelForClass(mkPlayer(), 'fighter'), 3);
});

test('getGrantedFeatures returns level-1 features of all taken classes', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'barbarian');
  const f = getGrantedFeatures(p);
  assertTrue(f.has('second_wind'));
  assertTrue(f.has('rage'));
});

test('getDerivedClassFeatures: fighter-only → dueling, no climb, no UD', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  const d = getDerivedClassFeatures(p);
  assertEq(d.fightingStyle, 'dueling');
  assertEq(d.canClimb, false);
  assertEq(d.unarmoredDefense, null);
});

test('getDerivedClassFeatures: fighter+monk → dueling + climb + UD wis', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'monk');
  const d = getDerivedClassFeatures(p);
  assertEq(d.fightingStyle, 'dueling');
  assertEq(d.canClimb, true);
  assertEq(d.unarmoredDefense, 'wis');
});

test('getDerivedClassFeatures: fighter+barbarian → dueling, no climb, no UD', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'barbarian');
  const d = getDerivedClassFeatures(p);
  assertEq(d.fightingStyle, 'dueling');
  assertEq(d.canClimb, false);
  assertEq(d.unarmoredDefense, null);
});

test('applyClassLevel returns error for unknown class', () => {
  const p = mkPlayer();
  const r = applyClassLevel(p, 'wizard');
  assertEq(r.ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
