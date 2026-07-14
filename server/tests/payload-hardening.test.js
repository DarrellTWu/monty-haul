// server/tests/payload-hardening.test.js
// Message payloads are attacker-controlled. This suite instantiates the real
// DungeonRoom, registers its handlers via onCreate, and fires hostile payloads
// (null, primitives, wrong-typed fields, non-finite numbers) at every
// registered message type:
//   - no handler may throw (the onUncaughtException backstop spy must stay
//     empty — validation, not the try/catch wrapper, absorbs bad shapes);
//   - player state must stay finite (no NaN velocity/position poisoning);
//   - use_hotbar must respect the pendingLevelUp action lock.
//
// DungeonRoom transitively imports the Supabase singleton, which requires env
// vars at import time — fake ones are set before the dynamic import (nothing
// in this suite touches persistence).
//
// Run: node server/tests/payload-hardening.test.js

process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'offline-test-key';

const { DungeonRoom }  = await import('../rooms/DungeonRoom.js');
const { PlayerState }  = await import('../state/PlayerState.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

// ── Boot a standalone room ────────────────────────────────────────────────────
const room = new DungeonRoom();
room.broadcast = () => {};              // no transport in this harness
const caught = [];
// Override BEFORE onCreate: onMessage binds this.onUncaughtException at
// registration time, so the spy becomes the wrapper's error sink.
room.onUncaughtException = (err, methodName) => { caught.push({ err, methodName }); };
await room.onCreate({});

function addPlayer(sessionId) {
  const p = new PlayerState();
  p.x = 100; p.y = 100; p.alive = true;
  p.class = 'fighter';
  p.classLevels.set('fighter', 1);
  p.hp = 10; p.maxHp = 20; p.ac = 10;
  p.str = 14; p.dex = 12; p.con = 14; p.int = 10; p.wis = 10; p.cha = 10;
  for (let i = 0; i < 10; i++) p.hotbar.push('');
  room.state.players.set(sessionId, p);
  return p;
}
const player = addPlayer('A');
const client = { sessionId: 'A', send: () => {} };

// ── 1. Every handler survives hostile payload shapes ─────────────────────────
console.log('\nHostile payloads against every registered message type');
{
  const hostile = [
    null, undefined, 42, 'garbage', true, [],
    { }, { unexpected: 'field' },
    { dx: 'x', dy: 0 }, { dx: {}, dy: [] }, { dx: Infinity, dy: -Infinity },
    { slot: 'NaN' }, { slot: -1 }, { slot: 99 }, { slot: {} },
    { itemId: null, slot: null }, { targetId: {} }, { classId: {} },
    { sourceKind: 7, sourceId: null, itemIndex: 'x', inventoryIndex: NaN },
    { stairId: [] },
  ];
  const types = Object.keys(room.onMessageHandlers);
  check('handlers registered (sanity)', types.length >= 10);
  for (const type of types) {
    for (const payload of hostile) {
      room.onMessageHandlers[type](client, payload);
    }
  }
  check(`no handler threw into onUncaughtException (${types.length} types × ${hostile.length} payloads)`,
    caught.length === 0);
  if (caught.length > 0) console.log('   first:', caught[0].methodName, caught[0].err);
}

// ── 2. State stays finite after the barrage ──────────────────────────────────
console.log('\nState integrity after hostile input');
{
  check('player.vx finite', Number.isFinite(player.vx));
  check('player.vy finite', Number.isFinite(player.vy));
  check('player.x finite',  Number.isFinite(player.x));
  check('player.y finite',  Number.isFinite(player.y));
}

// ── 3. move: non-finite input zeroes velocity; valid input still works ───────
console.log('\nmove validation');
{
  room.onMessageHandlers['move'](client, { dx: 1, dy: 0 });
  check('valid move sets unit velocity', player.vx === 1 && player.vy === 0);
  room.onMessageHandlers['move'](client, { dx: 'x', dy: 0 });
  check('non-numeric dx zeroes velocity (no NaN)', player.vx === 0 && player.vy === 0);
  room.onMessageHandlers['move'](client, { dx: 3, dy: 4 });
  check('normalization intact after rejection', Math.abs(player.vx - 0.6) < 1e-9 && Math.abs(player.vy - 0.8) < 1e-9);
  room.onMessageHandlers['stop'](client);
}

// ── 4. use_hotbar honors the pendingLevelUp action lock ──────────────────────
console.log('\npendingLevelUp gates use_hotbar');
{
  player.inventory.push('healing_potion');
  player.hotbar[0] = 'healing_potion';
  player.hp = 5;

  player.pendingLevelUp = true;
  room.onMessageHandlers['use_hotbar'](client, { slot: 0 });
  check('consumable NOT used while pendingLevelUp', player.hp === 5 && player.inventory.includes('healing_potion'));

  player.pendingLevelUp = false;
  room.onMessageHandlers['use_hotbar'](client, { slot: 0 });
  check('consumable used once the lock clears', player.hp > 5 && !player.inventory.includes('healing_potion'));
}

// ── 5. assign_hotbar rejects invalid slots, accepts valid ────────────────────
console.log('\nassign_hotbar slot validation');
{
  const before = [...player.hotbar];
  room.onMessageHandlers['assign_hotbar'](client, { itemId: 'healing_potion', slot: 99 });
  room.onMessageHandlers['assign_hotbar'](client, { itemId: 'healing_potion', slot: 'x' });
  check('out-of-range / NaN slot is a no-op', [...player.hotbar].join(',') === before.join(','));
  room.onMessageHandlers['assign_hotbar'](client, { itemId: 'healing_potion', slot: 3 });
  check('valid slot assignment still works', player.hotbar[3] === 'healing_potion');
}

check('backstop stayed silent for the whole suite', caught.length === 0);

clearInterval(room._simulationInterval);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
