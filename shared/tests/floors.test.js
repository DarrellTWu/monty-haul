// shared/tests/floors.test.js
// Floor-data validator tests: the real FLOOR_REGISTRY must pass clean, and
// deliberately-broken fixtures must each produce a named error.
// Run with: node shared/tests/floors.test.js

import assert from 'node:assert/strict';

import { validateFloorData } from '../logic/validate-floors.js';
import { FLOOR_REGISTRY }    from '../data/floors/index.js';
import { ENEMY_REGISTRY }    from '../data/enemies/tier1.js';
import { isKnownItem }       from '../data/items/index.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

const refs = { enemyTypes: Object.keys(ENEMY_REGISTRY), isKnownItem };

/** Minimal valid floor for fixture mutation. */
const validFloor = () => ({
  width: 800,
  height: 600,
  playerSpawn: { x: 400, y: 300 },
  enemies: [{ id: 'g0', type: 'goblin', x: 100, y: 100 }],
  chests:  [{ id: 'c0', x: 200, y: 200, items: ['healing_potion'] }],
  traps:   [{ id: 't0', x: 300, y: 300 }],
  stairs:  [{ id: 's0', x: 500, y: 300, toFloor: 2, lockedUntilAllEnemiesDead: true }],
  walls:   [{ x: 0, y: 0, w: 800, h: 40 }],
  doors:   [{ id: 'd0', x: 380, y: 0, w: 80, h: 40 }],
  platforms: [{ id: 'p0', x: 100, y: 400, w: 200, h: 100, elevation: 1, steps: [{ id: 'st0', x: 200, y: 400 }] }],
});

const twoFloors = (mutate = () => {}) => {
  const reg = { 1: validFloor(), 2: validFloor() };
  reg[2].stairs = [];
  mutate(reg);
  return reg;
};

console.log('validate-floors.test.js');

test('shipping FLOOR_REGISTRY validates clean', () => {
  const errors = validateFloorData(FLOOR_REGISTRY, refs);
  assert.deepEqual(errors, [], `expected no errors, got:\n  ${errors.join('\n  ')}`);
});

test('valid fixture validates clean', () => {
  assert.deepEqual(validateFloorData(twoFloors(), refs), []);
});

test('unknown enemy type is a named error', () => {
  const errors = validateFloorData(twoFloors(r => { r[1].enemies[0].type = 'dragon'; }), refs);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown type "dragon"/);
});

test('unknown chest item is a named error', () => {
  const errors = validateFloorData(twoFloors(r => { r[1].chests[0].items.push('sword_of_typos'); }), refs);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown item "sword_of_typos"/);
});

test('stair to a missing floor is a named error', () => {
  const errors = validateFloorData(twoFloors(r => { r[2].stairs = [{ id: 's9', x: 1, y: 1, toFloor: 99 }]; }), refs);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /targets missing floor 99/);
});

test('permanentLock stair may target a missing floor', () => {
  const errors = validateFloorData(
    twoFloors(r => { r[2].stairs = [{ id: 's9', x: 1, y: 1, toFloor: 99, permanentLock: true }]; }),
    refs,
  );
  assert.deepEqual(errors, []);
});

test('malformed wall rect is a named error', () => {
  const errors = validateFloorData(twoFloors(r => { r[1].walls.push({ x: 10, y: 10, w: 0, h: 40 }); }), refs);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /walls\[1\] must be a rect/);
});

test('malformed door rect is a named error', () => {
  const errors = validateFloorData(twoFloors(r => { delete r[1].doors[0].h; }), refs);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /door "d0" must be a rect/);
});

test('duplicate entity id is a named error', () => {
  const errors = validateFloorData(twoFloors(r => { r[1].traps.push({ id: 'g0', x: 5, y: 5 }); }), refs);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate entity id "g0"/);
});

test('spawn outside bounds is a named error', () => {
  const errors = validateFloorData(twoFloors(r => { r[1].playerSpawn = { x: 5000, y: 300 }; }), refs);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /outside the floor bounds/);
});

test('missing required array is a named error', () => {
  const errors = validateFloorData(twoFloors(r => { delete r[1].enemies; }), refs);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /enemies must be an array/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
