// server/tests/container-lock.test.js
// Tests the container-lock primitives in shared/logic/loot-window.js against
// real ChestState / EnemyState / PlayerState schema instances. We don't spin
// up a Colyseus Server here — the helpers are pure, so we can call them
// directly with state objects whose Map-like fields satisfy the duck shape.
//
// Run: node server/tests/container-lock.test.js

import { GameState }   from '../state/GameState.js';
import { ChestState }  from '../state/ChestState.js';
import { EnemyState }  from '../state/EnemyState.js';
import { PlayerState } from '../state/PlayerState.js';
import { CHEST_LOOT_RANGE_PX } from '../../shared/data/constants.js';
import {
  tryOpenContainer, tryCloseContainer,
  releaseLocksHeldBy, tickContainerLocks,
} from '../../shared/logic/loot-window.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

const RANGE = CHEST_LOOT_RANGE_PX;

// ── Setup ─────────────────────────────────────────────────────────────────────
const state = new GameState();

const chest = new ChestState();
chest.id = 'chest_0'; chest.x = 100; chest.y = 100;
state.chests.set('chest_0', chest);

// Corpse + chest both placed within range of (100,100) so player A is in range
// of both. Living enemy is intentionally far.
const corpse = new EnemyState();
corpse.id = 'goblin_0'; corpse.type = 'goblin';
corpse.x = 130; corpse.y = 130; corpse.alive = false;
state.enemies.set('goblin_0', corpse);

const livingEnemy = new EnemyState();
livingEnemy.id = 'goblin_alive'; livingEnemy.type = 'goblin';
livingEnemy.x = 300; livingEnemy.y = 300; livingEnemy.alive = true;
state.enemies.set('goblin_alive', livingEnemy);

const playerA = new PlayerState();
playerA.x = 100; playerA.y = 100; playerA.alive = true;
state.players.set('A', playerA);

const playerB = new PlayerState();
playerB.x = 100; playerB.y = 100; playerB.alive = true;
state.players.set('B', playerB);

// ── Schema field defaults ─────────────────────────────────────────────────────
console.log('\nSchema defaults');
check('ChestState.lockedBy defaults to ""', chest.lockedBy === '');
check('EnemyState.lockedBy defaults to ""', corpse.lockedBy === '');

// ── Open / close happy path ───────────────────────────────────────────────────
console.log('\ntryOpenContainer / tryCloseContainer');
{
  const r = tryOpenContainer(state, 'A', 'chest', 'chest_0', RANGE);
  check('A claims chest lock', r.ok && chest.lockedBy === 'A');
}
{
  const r = tryOpenContainer(state, 'B', 'chest', 'chest_0', RANGE);
  check('B is denied while A holds lock', !r.ok && r.reason === 'denied' && r.holder === 'A');
}
check('A re-opening is idempotent (still holds lock)',
  tryOpenContainer(state, 'A', 'chest', 'chest_0', RANGE).ok && chest.lockedBy === 'A');
check('B cannot close A\'s lock', !tryCloseContainer(state, 'B', 'chest', 'chest_0') && chest.lockedBy === 'A');
check('A closes own lock',           tryCloseContainer(state, 'A', 'chest', 'chest_0') && chest.lockedBy === '');
check('B can now claim',
  tryOpenContainer(state, 'B', 'chest', 'chest_0', RANGE).ok && chest.lockedBy === 'B');
tryCloseContainer(state, 'B', 'chest', 'chest_0');

// ── Validation ─────────────────────────────────────────────────────────────
console.log('\nValidation');
{
  playerA.x = 1000; playerA.y = 1000;
  const r = tryOpenContainer(state, 'A', 'chest', 'chest_0', RANGE);
  check('out-of-range open denied', !r.ok && r.reason === 'range' && chest.lockedBy === '');
  playerA.x = 100; playerA.y = 100;
}
{
  playerA.x = 300; playerA.y = 300; // within range of livingEnemy
  const r = tryOpenContainer(state, 'A', 'corpse', 'goblin_alive', RANGE);
  check('living enemy cannot be looted', !r.ok && r.reason === 'alive' && livingEnemy.lockedBy === '');
  playerA.x = 100; playerA.y = 100;
}
{
  const r = tryOpenContainer(state, 'A', 'chest', 'no_such_chest', RANGE);
  check('missing source denied', !r.ok && r.reason === 'no-source');
}
{
  playerA.alive = false;
  const r = tryOpenContainer(state, 'A', 'chest', 'chest_0', RANGE);
  check('dead player denied', !r.ok && r.reason === 'dead');
  playerA.alive = true;
}

// ── Tick-time auto-release ───────────────────────────────────────────────────
console.log('\ntickContainerLocks (auto-release)');

// A locks, then walks out of range → tick releases
tryOpenContainer(state, 'A', 'chest', 'chest_0', RANGE);
check('A holds chest lock pre-tick', chest.lockedBy === 'A');
playerA.x = 9999; playerA.y = 9999;
tickContainerLocks(state, RANGE);
check('out-of-range locker auto-released by tick', chest.lockedBy === '');
playerA.x = 100; playerA.y = 100;

// A locks, then dies → tick releases
tryOpenContainer(state, 'A', 'corpse', 'goblin_0', RANGE);
check('A locks corpse', corpse.lockedBy === 'A');
playerA.alive = false;
tickContainerLocks(state, RANGE);
check('dead locker auto-released by tick', corpse.lockedBy === '');
playerA.alive = true;

// A locks, then disconnects → players map drops them → tick releases
tryOpenContainer(state, 'A', 'chest', 'chest_0', RANGE);
state.players.delete('A');
tickContainerLocks(state, RANGE);
check('disconnected locker auto-released by tick', chest.lockedBy === '');
state.players.set('A', playerA);

// ── onLeave-style explicit release ────────────────────────────────────────────
console.log('\nreleaseLocksHeldBy (onLeave path)');
tryOpenContainer(state, 'A', 'chest',  'chest_0',  RANGE);
tryOpenContainer(state, 'A', 'corpse', 'goblin_0', RANGE);
check('A holds two locks', chest.lockedBy === 'A' && corpse.lockedBy === 'A');
releaseLocksHeldBy(state, 'A');
check('releaseLocksHeldBy clears all of A\'s locks', chest.lockedBy === '' && corpse.lockedBy === '');

// ── Idempotence guards ────────────────────────────────────────────────────────
console.log('\nIdempotence');
releaseLocksHeldBy(state, 'A'); // no-op
check('releaseLocksHeldBy on empty locks is a no-op', chest.lockedBy === '' && corpse.lockedBy === '');
tickContainerLocks(state, RANGE); // no-op
check('tickContainerLocks with no held locks is a no-op',
  chest.lockedBy === '' && corpse.lockedBy === '');

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} tests.`);
process.exit(fail === 0 ? 0 : 1);
