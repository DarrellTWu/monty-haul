// shared/tests/equipment.test.js
// Tests for shared/logic/equipment.js (equipItem / unequipItem / recomputeStats).
// Run with: node shared/tests/equipment.test.js

import { equipItem, unequipItem, recomputeStats } from '../logic/equipment.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n    ${e.message}`); failed++; }
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertContains(arr, v) {
  if (!Array.from(arr).includes(v)) throw new Error(`expected array to contain ${v}, got [${Array.from(arr).join(',')}]`);
}
function assertNotContains(arr, v) {
  if (Array.from(arr).includes(v)) throw new Error(`expected array to NOT contain ${v}, got [${Array.from(arr).join(',')}]`);
}

// Minimal PlayerState stand-in. Real Colyseus PlayerState uses ArraySchema, but
// for these pure-logic tests a plain array satisfies the indexOf/push/splice API.
function mkPlayer(overrides = {}) {
  return {
    class: 'fighter',
    str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 8,
    equippedWeaponId: '',
    equippedArmorId:  '',
    offhandId:        '',
    inventory: [],
    ac: 10,
    ...overrides,
  };
}

console.log('equipItem — weapon slot');
test('equips a one-handed weapon from inventory', () => {
  const p = mkPlayer({ inventory: ['longsword'] });
  const r = equipItem(p, { itemId: 'longsword' });
  assertEq(r.ok, true);
  assertEq(p.equippedWeaponId, 'longsword');
  assertNotContains(p.inventory, 'longsword');
});
test('swap weapon: old weapon returns to bag', () => {
  const p = mkPlayer({ equippedWeaponId: 'longsword', inventory: ['dagger'] });
  equipItem(p, { itemId: 'dagger' });
  assertEq(p.equippedWeaponId, 'dagger');
  assertContains(p.inventory, 'longsword');
});
test('equipping two-handed auto-unequips offhand', () => {
  const p = mkPlayer({ offhandId: 'shield', inventory: ['greataxe'] });
  equipItem(p, { itemId: 'greataxe' });
  assertEq(p.equippedWeaponId, 'greataxe');
  assertEq(p.offhandId, '');
  assertContains(p.inventory, 'shield');
});
test('item not in inventory → ok=false', () => {
  const p = mkPlayer();
  const r = equipItem(p, { itemId: 'longsword' });
  assertEq(r.ok, false);
});

console.log('\nequipItem — offhand slot');
test('shield to offhand', () => {
  const p = mkPlayer({ inventory: ['shield'] });
  equipItem(p, { itemId: 'shield' });
  assertEq(p.offhandId, 'shield');
});
test('two-handed weapon refused in offhand', () => {
  const p = mkPlayer({ inventory: ['greataxe'] });
  const r = equipItem(p, { itemId: 'greataxe', slot: 'offhand' });
  assertEq(r.ok, false);
  assertEq(p.offhandId, '');
  assertContains(p.inventory, 'greataxe');
});
test('equipping offhand while main-hand is two-handed auto-unequips main', () => {
  const p = mkPlayer({ equippedWeaponId: 'greataxe', inventory: ['shield'] });
  equipItem(p, { itemId: 'shield' });
  assertEq(p.equippedWeaponId, '');
  assertEq(p.offhandId, 'shield');
  assertContains(p.inventory, 'greataxe');
});

console.log('\nequipItem — armor slot');
test('equip armor recomputes AC', () => {
  const p = mkPlayer({ inventory: ['chain_mail'] });
  equipItem(p, { itemId: 'chain_mail' });
  assertEq(p.equippedArmorId, 'chain_mail');
  // chain_mail baseAC=16, heavy → DEX ignored, no shield → AC=16
  assertEq(p.ac, 16);
});
test('shield + armor stack +2', () => {
  const p = mkPlayer({ inventory: ['chain_mail', 'shield'] });
  equipItem(p, { itemId: 'chain_mail' });
  equipItem(p, { itemId: 'shield' });
  assertEq(p.ac, 18);
});

console.log('\nunequipItem');
test('unequip weapon returns to bag, no AC change', () => {
  const p = mkPlayer({ equippedWeaponId: 'longsword', ac: 12 });
  const r = unequipItem(p, { slot: 'weapon' });
  assertEq(r.ok, true);
  assertEq(p.equippedWeaponId, '');
  assertContains(p.inventory, 'longsword');
  assertEq(p.ac, 12);
});
test('unequip shield recomputes AC down', () => {
  const p = mkPlayer({ equippedArmorId: 'chain_mail', offhandId: 'shield' });
  recomputeStats(p);          // AC=18 with shield
  assertEq(p.ac, 18);
  unequipItem(p, { slot: 'offhand' });
  assertEq(p.ac, 16);          // shield removed
});
test('unequip empty slot → ok=false', () => {
  const p = mkPlayer();
  const r = unequipItem(p, { slot: 'armor' });
  assertEq(r.ok, false);
});

console.log('\nrecomputeStats');
test('unarmored fighter: AC = 10 + DEX', () => {
  const p = mkPlayer({ dex: 14 });
  recomputeStats(p);
  assertEq(p.ac, 12);
});
test('monk unarmored defense uses WIS', () => {
  const p = mkPlayer({ class: 'monk', dex: 14, wis: 16 });
  recomputeStats(p);
  // 10 + dexMod(+2) + wisMod(+3) = 15
  assertEq(p.ac, 15);
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
process.exit(failed === 0 ? 0 : 1);
