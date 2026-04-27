// server/tests/loot-flow.test.js
// Tests the loot flow helpers (tryTakeItem / tryTakeGold / tryDropItem) in
// shared/logic/loot-window.js. Imports the real functions and exercises them
// against PlayerState / ChestState / EnemyState schema instances.
//
// Run: node server/tests/loot-flow.test.js

import { GameState }   from '../state/GameState.js';
import { ChestState }  from '../state/ChestState.js';
import { EnemyState }  from '../state/EnemyState.js';
import { PlayerState } from '../state/PlayerState.js';
import { CHEST_LOOT_RANGE_PX } from '../../shared/data/constants.js';
import {
  tryTakeItem, tryTakeGold, tryDropItem,
} from '../../shared/logic/loot-window.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

const RANGE = CHEST_LOOT_RANGE_PX;

// ── Setup ─────────────────────────────────────────────────────────────────────
function setup() {
  const state = new GameState();

  const chest = new ChestState();
  chest.id = 'chest_0'; chest.x = 100; chest.y = 100;
  chest.items.push('shield');
  chest.items.push('healing_potion');
  chest.items.push('healing_potion');
  state.chests.set('chest_0', chest);

  const corpse = new EnemyState();
  corpse.id = 'goblin_0'; corpse.type = 'goblin';
  corpse.x = 130; corpse.y = 130; corpse.alive = false;
  corpse.lootGold = 7;
  corpse.lootItems.push('healing_potion');
  state.enemies.set('goblin_0', corpse);

  const playerA = new PlayerState();
  playerA.x = 100; playerA.y = 100; playerA.alive = true;
  // Hotbar slot 0 bound to the only healing potion that A will start with.
  playerA.inventory.push('healing_potion');
  for (let i = 0; i < 10; i++) playerA.hotbar.push(i === 0 ? 'healing_potion' : '');
  state.players.set('A', playerA);

  const playerB = new PlayerState();
  playerB.x = 100; playerB.y = 100; playerB.alive = true;
  for (let i = 0; i < 10; i++) playerB.hotbar.push('');
  state.players.set('B', playerB);

  return { state, chest, corpse, playerA, playerB };
}

// ── Lock gate: every flow function refuses without a held lock ───────────────
console.log('\nLock gate enforcement');
{
  const { state, chest, playerA } = setup();
  // A is in range but holds no lock yet.
  check('tryTakeItem refuses without lock',
    !tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE)
    && chest.items.length === 3 && playerA.inventory.length === 1);
  check('tryDropItem refuses without lock',
    !tryDropItem(state, 'A', 'chest', 'chest_0', 0, RANGE)
    && playerA.inventory.length === 1);
}
{
  const { state, corpse, playerA } = setup();
  check('tryTakeGold refuses without lock',
    !tryTakeGold(state, 'A', 'goblin_0', RANGE) && corpse.lootGold === 7 && playerA.gold === 0);
}

// ── tryTakeItem happy path + index validation ────────────────────────────────
console.log('\ntryTakeItem (chest)');
{
  const { state, chest, playerA } = setup();
  chest.lockedBy = 'A';
  check('moves chest item to inventory',
    tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE)
    && chest.items.length === 2
    && playerA.inventory.includes('shield'));
  check('chest.open stays false while items remain', chest.open === false);

  check('idx out-of-range refused (high)',  !tryTakeItem(state, 'A', 'chest', 'chest_0', 99, RANGE));
  check('idx out-of-range refused (negative)', !tryTakeItem(state, 'A', 'chest', 'chest_0', -1, RANGE));
  check('idx non-integer refused',           !tryTakeItem(state, 'A', 'chest', 'chest_0', 'foo', RANGE));

  // Drain the rest.
  tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE);
  tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE);
  check('chest.open flips true when items reach 0', chest.open === true && chest.items.length === 0);
}

// ── tryTakeItem from corpse hits lootItems, not items ────────────────────────
console.log('\ntryTakeItem (corpse)');
{
  const { state, corpse, playerA } = setup();
  corpse.lockedBy = 'A';
  check('corpse take_item pulls from lootItems',
    tryTakeItem(state, 'A', 'corpse', 'goblin_0', 0, RANGE)
    && corpse.lootItems.length === 0
    && playerA.inventory.includes('healing_potion'));
  check('corpse.looted false while gold remains', corpse.looted === false && corpse.lootGold === 7);
}

// ── tryTakeGold ──────────────────────────────────────────────────────────────
console.log('\ntryTakeGold');
{
  const { state, corpse, playerA } = setup();
  corpse.lockedBy = 'A';
  check('transfers full pile',
    tryTakeGold(state, 'A', 'goblin_0', RANGE) && corpse.lootGold === 0 && playerA.gold === 7);
  check('refuses when zero',  !tryTakeGold(state, 'A', 'goblin_0', RANGE));
  check('corpse.looted stays false while items remain', corpse.looted === false);

  tryTakeItem(state, 'A', 'corpse', 'goblin_0', 0, RANGE);
  check('corpse.looted flips true when both gold and items empty', corpse.looted === true);
}

// ── Lock isolation: B can't touch A's locked container ───────────────────────
console.log('\nLock ownership');
{
  const { state, chest, playerA, playerB } = setup();
  chest.lockedBy = 'A';
  check('B refused tryTakeItem on A\'s lock',
    !tryTakeItem(state, 'B', 'chest', 'chest_0', 0, RANGE)
    && chest.items.length === 3 && playerB.inventory.length === 0);
  check('B refused tryDropItem on A\'s lock',
    !tryDropItem(state, 'B', 'chest', 'chest_0', 0, RANGE));
  check('A still functions on own lock',
    tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE) && playerA.inventory.includes('shield'));
}

// ── tryDropItem happy path + flag flip ───────────────────────────────────────
console.log('\ntryDropItem');
{
  const { state, chest, playerA } = setup();
  chest.lockedBy = 'A';
  // Empty the chest, then drop something into it.
  tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE);
  tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE);
  tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE);
  check('chest is empty + open after draining', chest.items.length === 0 && chest.open === true);

  const idx = playerA.inventory.indexOf('shield');
  check('moves bag item into chest',
    tryDropItem(state, 'A', 'chest', 'chest_0', idx, RANGE)
    && chest.items.includes('shield')
    && !playerA.inventory.includes('shield'));
  check('chest.open flips back to false on drop', chest.open === false);
}

// ── tryDropItem index validation ─────────────────────────────────────────────
console.log('\ntryDropItem index validation');
{
  const { state, chest, playerA } = setup();
  chest.lockedBy = 'A';
  const before = playerA.inventory.length;
  check('idx out-of-range refused', !tryDropItem(state, 'A', 'chest', 'chest_0', 99, RANGE));
  check('idx negative refused',     !tryDropItem(state, 'A', 'chest', 'chest_0', -1, RANGE));
  check('NaN refused',              !tryDropItem(state, 'A', 'chest', 'chest_0', 'foo', RANGE));
  check('inventory unchanged on bad index',  playerA.inventory.length === before);
}

// ── Hotbar cleanup: dropping last copy clears bindings ───────────────────────
console.log('\nHotbar cleanup on drop');
{
  const { state, chest, playerA } = setup();
  chest.lockedBy = 'A';
  // A starts with 1 healing_potion in inventory bound to hotbar slot 0.
  check('hotbar[0] starts bound to healing_potion', playerA.hotbar[0] === 'healing_potion');
  const idx = playerA.inventory.indexOf('healing_potion');
  tryDropItem(state, 'A', 'chest', 'chest_0', idx, RANGE);
  check('hotbar binding cleared when last copy dropped',
    playerA.hotbar[0] === '' && !playerA.inventory.includes('healing_potion'));
}
{
  const { state, chest, playerA } = setup();
  chest.lockedBy = 'A';
  // Give A a second healing potion so dropping one leaves a copy behind.
  playerA.inventory.push('healing_potion');
  check('A has 2 healing_potions before drop',
    playerA.inventory.filter(i => i === 'healing_potion').length === 2);
  const idx = playerA.inventory.indexOf('healing_potion');
  tryDropItem(state, 'A', 'chest', 'chest_0', idx, RANGE);
  check('hotbar binding kept when player still has a copy',
    playerA.hotbar[0] === 'healing_potion' && playerA.inventory.includes('healing_potion'));
}

// ── Range / alive / source-existence gates inherited from access check ───────
console.log('\nGate inheritance from checkLootAccess');
{
  const { state, chest, playerA } = setup();
  chest.lockedBy = 'A';
  playerA.x = 9999; playerA.y = 9999;
  check('out-of-range refuses tryTakeItem', !tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE));
}
{
  const { state, chest, playerA } = setup();
  chest.lockedBy = 'A';
  playerA.alive = false;
  check('dead player refuses tryTakeItem', !tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE));
}
{
  const { state } = setup();
  state.chests.delete('chest_0');
  check('missing source refuses tryTakeItem', !tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE));
}
{
  const { state } = setup();
  // A living enemy can't be looted even if "locked" (open_container would have rejected it).
  const live = new EnemyState();
  live.id = 'goblin_live'; live.x = 100; live.y = 100; live.alive = true; live.lockedBy = 'A';
  state.enemies.set('goblin_live', live);
  check('living corpse target refuses tryTakeGold',
    !tryTakeGold(state, 'A', 'goblin_live', RANGE));
}

// ── Round-trip: take then put back ───────────────────────────────────────────
console.log('\nRound-trip take + drop');
{
  const { state, chest, playerA } = setup();
  chest.lockedBy = 'A';
  tryTakeItem(state, 'A', 'chest', 'chest_0', 0, RANGE); // shield → bag
  const idx = playerA.inventory.indexOf('shield');
  tryDropItem(state, 'A', 'chest', 'chest_0', idx, RANGE);
  check('shield returned to chest after take+drop', chest.items.includes('shield'));
  check('item count conserved', chest.items.length === 3 && playerA.inventory.length === 1);
}

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} tests.`);
process.exit(fail === 0 ? 0 : 1);
