// shared/tests/class-progression.test.js
// Tests for shared/logic/class-progression.js.
// Run with: node shared/tests/class-progression.test.js

import {
  totalLevel, getClassLevel, getEligibleClassChoicesForLevelUp,
  getGrantedFeatures, getDerivedClassFeatures, applyClassLevel,
  computeHpGainForLevel, getMaxLevelForClass,
  getKiMax, getRageUsesMax, getSneakAttackDice, trySubclassUnlock, DEFAULT_CRIT_RANGE,
  getKnockbackProfile, getClimbLevel,
} from '../logic/class-progression.js';
import { CLASS_REGISTRY } from '../data/classes/index.js';
import { ITEM_REGISTRY } from '../data/items/index.js';
import {
  HP_MULTIPLIER, RAGE_USES,
  KNOCKBACK_BARBARIAN_PER_LEVEL_PX, KNOCKBACK_RESIST_PER_FIGHTER_LEVEL,
  KNOCKBACK_RESIST_SHIELD_BONUS, KNOCKBACK_RESIST_CAP,
} from '../data/constants.js';

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

test('eligibility includes taken classes below the cap (same-class re-leveling)', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  const elig = getEligibleClassChoicesForLevelUp(p);
  assertTrue(elig.includes('fighter'), 'fighter 1 can continue to 2');
  assertTrue(elig.includes('barbarian') && elig.includes('monk'));
});

test('eligibility excludes a class at the gearless cap (3)', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'fighter');
  const elig = getEligibleClassChoicesForLevelUp(p);
  assertTrue(!elig.includes('fighter'), 'fighter 3 is capped');
  assertTrue(elig.includes('barbarian') && elig.includes('monk'));
});

test('fighter 2 grants action_surge and seeds actionSurgeAvailable', () => {
  const p = mkPlayer();
  seedFighter(p);
  const r = applyClassLevel(p, 'fighter');
  assertTrue(r.ok);
  assertTrue(r.features.includes('action_surge'));
  assertEq(p.actionSurgeAvailable, true);
  assertEq(getClassLevel(p, 'fighter'), 2);
});

test('monk 2 grants ki abilities and seeds ki pool = monk level', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'monk');
  assertEq(getKiMax(p), 0, 'no ki below monk 2');
  const r = applyClassLevel(p, 'monk');
  assertTrue(r.features.includes('flurry_of_blows'));
  assertTrue(r.features.includes('patient_defense'));
  assertTrue(r.features.includes('step_of_wind'));
  assertEq(p.kiMax, 2);
  assertEq(p.kiPoints, 2);
  applyClassLevel(p, 'monk');
  assertEq(p.kiMax, 3, 'ki scales with monk level');
});

test('barbarian 2 grants reckless_attack; barbarian 3 raises rage pool to 3', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'barbarian');
  assertEq(getRageUsesMax(p), RAGE_USES);
  const r2 = applyClassLevel(p, 'barbarian');
  assertTrue(r2.features.includes('reckless_attack'));
  applyClassLevel(p, 'barbarian');
  assertEq(getRageUsesMax(p), 3);
  assertEq(p.rageUsesRemaining, 3, 'level 3 grant refills the pool');
});

test('derived: dangerSense at barbarian 2, not at 1', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'barbarian');
  assertEq(getDerivedClassFeatures(p).dangerSense, false);
  applyClassLevel(p, 'barbarian');
  assertEq(getDerivedClassFeatures(p).dangerSense, true);
});

test('derived: unarmoredMovementFt at monk 2', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'monk');
  assertEq(getDerivedClassFeatures(p).unarmoredMovementFt, 0);
  applyClassLevel(p, 'monk');
  assertEq(getDerivedClassFeatures(p).unarmoredMovementFt, 10);
});

test('derived: barbarian unarmored defense is CON', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'barbarian');
  assertEq(getDerivedClassFeatures(p).unarmoredDefense, 'con');
});

test('trySubclassUnlock: champion via sigil at fighter 3', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'fighter');
  assertEq(trySubclassUnlock(p, 'fighter', ['champion_sigil'], ITEM_REGISTRY), null, 'below level 3');
  applyClassLevel(p, 'fighter');
  assertEq(trySubclassUnlock(p, 'fighter', [], ITEM_REGISTRY), null, 'no emblem carried');
  const r = trySubclassUnlock(p, 'fighter', ['healing_potion', 'champion_sigil'], ITEM_REGISTRY);
  assertTrue(r !== null);
  assertEq(r.subclassId, 'champion');
  assertEq(p.subclasses.get('fighter'), 'champion');
  assertEq(trySubclassUnlock(p, 'fighter', ['champion_sigil'], ITEM_REGISTRY), null, 'already unlocked');
});

test("trySubclassUnlock: wrong class's emblem does not unlock", () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'fighter');
  assertEq(trySubclassUnlock(p, 'fighter', ['berserker_totem'], ITEM_REGISTRY), null);
});

test('derived: champion subclass sets critRange 19; default is 20', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  assertEq(getDerivedClassFeatures(p).critRange, DEFAULT_CRIT_RANGE);
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'fighter');
  trySubclassUnlock(p, 'fighter', ['champion_sigil'], ITEM_REGISTRY);
  assertEq(getDerivedClassFeatures(p).critRange, 19);
});

test('derived: berserker frenzy and open hand technique flags', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'barbarian');
  applyClassLevel(p, 'barbarian');
  applyClassLevel(p, 'barbarian');
  trySubclassUnlock(p, 'barbarian', ['berserker_totem'], ITEM_REGISTRY);
  const d = getDerivedClassFeatures(p);
  assertEq(d.frenzy, true);
  assertEq(d.openHandTechnique, false);

  const m = mkPlayer();
  applyClassLevel(m, 'monk');
  applyClassLevel(m, 'monk');
  applyClassLevel(m, 'monk');
  trySubclassUnlock(m, 'monk', ['open_hand_manual'], ITEM_REGISTRY);
  assertEq(getDerivedClassFeatures(m).openHandTechnique, true);
});

test('getSneakAttackDice: 0 without rogue levels, ceil(level/2) with', () => {
  const p = mkPlayer();
  assertEq(getSneakAttackDice(p), 0);
  applyClassLevel(p, 'fighter');
  assertEq(getSneakAttackDice(p), 0, 'non-rogue class grants no sneak dice');
  applyClassLevel(p, 'rogue');
  assertEq(getSneakAttackDice(p), 1, 'rogue 1 → 1d6');
  applyClassLevel(p, 'rogue');
  assertEq(getSneakAttackDice(p), 1, 'rogue 2 → 1d6');
  applyClassLevel(p, 'rogue');
  assertEq(getSneakAttackDice(p), 2, 'rogue 3 → 2d6');
});

test('rogue 2 grants cunning_action feature', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'rogue');
  const r = applyClassLevel(p, 'rogue');
  assertTrue(r.ok);
  assertTrue(r.features.includes('cunning_action'));
  assertTrue(getGrantedFeatures(p).has('cunning_action'));
});

test('trySubclassUnlock: skirmisher via spurs at rogue 3; derived skirmish flag', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'rogue');
  applyClassLevel(p, 'rogue');
  assertEq(trySubclassUnlock(p, 'rogue', ['skirmisher_spurs'], ITEM_REGISTRY), null, 'below level 3');
  applyClassLevel(p, 'rogue');
  assertEq(getDerivedClassFeatures(p).skirmish, false, 'no subclass yet');
  const r = trySubclassUnlock(p, 'rogue', ['skirmisher_spurs'], ITEM_REGISTRY);
  assertTrue(r !== null);
  assertEq(r.subclassId, 'skirmisher');
  assertEq(p.subclasses.get('rogue'), 'skirmisher');
  assertEq(getDerivedClassFeatures(p).skirmish, true);
});

test('derived: rogue canClimb ORs across taken classes', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  assertEq(getDerivedClassFeatures(p).canClimb, false);
  applyClassLevel(p, 'rogue');
  assertEq(getDerivedClassFeatures(p).canClimb, true);
});

test('getKnockbackProfile: barbarian levels drive the push bonus', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'barbarian');
  applyClassLevel(p, 'barbarian');
  applyClassLevel(p, 'barbarian');
  const prof = getKnockbackProfile(p);
  assertEq(prof.bonusPx, 3 * KNOCKBACK_BARBARIAN_PER_LEVEL_PX, '3 × per-level px');
  assertEq(prof.bonusClassLevel, 3);
  assertEq(prof.resistFraction, 0, 'no fighter levels → no resist');
});

test('getKnockbackProfile: fighter levels + shield drive the resist (capped)', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'fighter');
  const bare = Math.min(KNOCKBACK_RESIST_CAP, 2 * KNOCKBACK_RESIST_PER_FIGHTER_LEVEL);
  const shielded = Math.min(KNOCKBACK_RESIST_CAP, 2 * KNOCKBACK_RESIST_PER_FIGHTER_LEVEL + KNOCKBACK_RESIST_SHIELD_BONUS);
  assertEq(getKnockbackProfile(p, false).resistFraction, bare);
  assertEq(getKnockbackProfile(p, true).resistFraction, shielded);
  assertEq(getKnockbackProfile(p, true).resistClassLevel, 2);
  // Fighter 3 + shield reaches the cap — the "next to immovable" target.
  applyClassLevel(p, 'fighter');
  assertEq(getKnockbackProfile(p, true).resistFraction, KNOCKBACK_RESIST_CAP);
});

test('getKnockbackProfile: shield alone grants nothing without fighter levels', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'monk');
  assertEq(getKnockbackProfile(p, true).resistFraction, 0);
});

test('getClimbLevel: max level across canClimb classes, 0 otherwise', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  assertEq(getClimbLevel(p), 0, 'fighter cannot climb');
  applyClassLevel(p, 'rogue');
  assertEq(getClimbLevel(p), 1);
  applyClassLevel(p, 'monk');
  applyClassLevel(p, 'monk');
  assertEq(getClimbLevel(p), 2, 'monk 2 beats rogue 1');
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

test('getDerivedClassFeatures: fighter+barbarian → dueling, no climb, UD con', () => {
  const p = mkPlayer();
  applyClassLevel(p, 'fighter');
  applyClassLevel(p, 'barbarian');
  const d = getDerivedClassFeatures(p);
  assertEq(d.fightingStyle, 'dueling');
  assertEq(d.canClimb, false);
  assertEq(d.unarmoredDefense, 'con');
});

test('applyClassLevel returns error for unknown class', () => {
  const p = mkPlayer();
  const r = applyClassLevel(p, 'wizard');
  assertEq(r.ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
