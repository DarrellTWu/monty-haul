// server/tests/rename-smoke.js
// Validates renamePlayer (Phase 2 — Hub Settings).
//
// Covers: happy path, no-op rename, collision via UNIQUE, length/empty
// validation, boundary cases (20 chars exact), not-found, cache eviction in
// _byUsername, and persistence (re-login under new name returns same playerId).
//
// Run: node server/tests/rename-smoke.js
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here    = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '..', '.env');
process.loadEnvFile(envFile);

const { supabase }            = await import('../persistence/supabase.js');
const { loadPlayerByUsername } = await import('../persistence/playerLoad.js');
const playerStore              = await import('../store/playerStore.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

// 6-char base36 tag — keeps test usernames under the 20-char rename cap while
// staying unique enough across runs (36^6 ≈ 2B). If a stale row from an
// aborted prior run shares the tag, getOrCreate just reuses it; cleanup
// purges it at the end either way.
const TAG     = Math.random().toString(36).slice(2, 8);
const NAME_A  = `rt_a_${TAG}`;      // 11 chars
const NAME_B  = `rt_b_${TAG}`;      // 11 chars
const NAME_A2 = `rt_a2_${TAG}`;     // 12 chars
let playerIdA = null;
let playerIdB = null;
const extraIds = []; // collects playerIds for cleanup that the test creates indirectly

async function cleanup() {
  const ids = [playerIdA, playerIdB, ...extraIds].filter(Boolean);
  for (const id of ids) {
    await supabase.from('gear_stash').delete().eq('player_id', id);
    await supabase.from('meta_progression').delete().eq('player_id', id);
    await supabase.from('player_profiles').delete().eq('id', id);
  }
}

async function run() {
  console.log(`Test tag: ${TAG}\n`);

  // ── Setup: create two players ──────────────────────────────────────────────
  const a = await playerStore.getOrCreate(NAME_A);
  const b = await playerStore.getOrCreate(NAME_B);
  playerIdA = a.playerId;
  playerIdB = b.playerId;
  check('player A created',                a.username === NAME_A);
  check('player B created',                b.username === NAME_B);
  check('player A and B have different ids', playerIdA !== playerIdB);

  // ── Happy path ──────────────────────────────────────────────────────────────
  console.log('\nHappy path: rename A to fresh name');
  let r = await playerStore.renamePlayer(playerIdA, NAME_A2);
  check('returned ok=true',                r.ok === true);
  check('result.username is NAME_A2',      r.username === NAME_A2);
  let pA = await playerStore.getPlayer(playerIdA);
  check('cached username updated',         pA.username === NAME_A2);

  // ── Cache eviction: old name no longer routes to this player ───────────────
  console.log('\nCache eviction: _byUsername old entry removed');
  // Re-getOrCreate the OLD name. Since the old name is now free in DB and the
  // cache should have evicted the entry, this should CREATE a brand new player.
  const ghost = await playerStore.getOrCreate(NAME_A);
  extraIds.push(ghost.playerId);
  check('old name maps to a NEW playerId', ghost.playerId !== playerIdA);

  // ── Persistence: load-by-username(new) returns playerIdA ───────────────────
  console.log('\nPersistence: loadPlayerByUsername(new name)');
  const loaded = await loadPlayerByUsername(NAME_A2);
  check('returns the same player',         loaded?.playerId === playerIdA);
  check('username matches',                loaded?.username === NAME_A2);

  // ── No-op rename (current name) ────────────────────────────────────────────
  console.log('\nNo-op: rename A to its current name');
  r = await playerStore.renamePlayer(playerIdA, NAME_A2);
  check('returned ok=true',                r.ok === true);
  check('username unchanged',              r.username === NAME_A2);

  // ── Collision: rename A to B's current name ────────────────────────────────
  console.log('\nCollision: rename A to B\'s name');
  r = await playerStore.renamePlayer(playerIdA, NAME_B);
  check('returned ok=false',               r.ok === false);
  check('error is username_taken',         r.error === 'username_taken');
  pA = await playerStore.getPlayer(playerIdA);
  check('A.username unchanged after collision', pA.username === NAME_A2);

  // ── Invalid: empty string ──────────────────────────────────────────────────
  console.log('\nInvalid: empty string');
  r = await playerStore.renamePlayer(playerIdA, '');
  check('returned ok=false',               r.ok === false);
  check('error is invalid_username',       r.error === 'invalid_username');

  // ── Invalid: whitespace only (trim check) ──────────────────────────────────
  console.log('\nInvalid: whitespace only');
  r = await playerStore.renamePlayer(playerIdA, '   ');
  check('returned ok=false',               r.ok === false);
  check('error is invalid_username',       r.error === 'invalid_username');

  // ── Invalid: null / undefined ──────────────────────────────────────────────
  console.log('\nInvalid: null and undefined');
  r = await playerStore.renamePlayer(playerIdA, null);
  check('null → invalid_username',         r.ok === false && r.error === 'invalid_username');
  r = await playerStore.renamePlayer(playerIdA, undefined);
  check('undefined → invalid_username',    r.ok === false && r.error === 'invalid_username');

  // ── Invalid: 21 chars ──────────────────────────────────────────────────────
  console.log('\nInvalid: 21 chars');
  const twentyOne = 'a'.repeat(21);
  r = await playerStore.renamePlayer(playerIdA, twentyOne);
  check('returned ok=false',               r.ok === false);
  check('error is invalid_username',       r.error === 'invalid_username');

  // ── Boundary: 20 chars exact (should succeed) ──────────────────────────────
  console.log('\nBoundary: 20 chars exact');
  // Pad with 'x' so the result is always exactly 20 chars and unique per run.
  const twentyExact = (`bnd_${TAG}_${'x'.repeat(20)}`).slice(0, 20);
  check('test name is 20 chars',           twentyExact.length === 20);
  r = await playerStore.renamePlayer(playerIdA, twentyExact);
  check('returned ok=true at boundary',    r.ok === true);
  check('username is the 20-char value',   r.username === twentyExact);

  // ── Trim: leading/trailing whitespace stripped before validation ───────────
  console.log('\nTrim: surrounding whitespace stripped');
  const padded = `   trim_${TAG}   `;
  r = await playerStore.renamePlayer(playerIdA, padded);
  check('returned ok=true',                r.ok === true);
  check('stored value is trimmed',         r.username === padded.trim());

  // ── Not found: bogus playerId ──────────────────────────────────────────────
  console.log('\nNot found: bogus playerId');
  r = await playerStore.renamePlayer('00000000-0000-0000-0000-000000000000', 'whatever');
  check('returned ok=false',               r.ok === false);
  check('error is Player not found',       r.error === 'Player not found');

  // ── Final state check: A's name is the trimmed value above ─────────────────
  console.log('\nFinal state');
  pA = await playerStore.getPlayer(playerIdA);
  check('A.username is the trimmed value', pA.username === padded.trim());
  // B should be completely untouched throughout
  const pB = await playerStore.getPlayer(playerIdB);
  check('B.username unchanged throughout', pB.username === NAME_B);
}

try {
  await run();
} catch (err) {
  console.error('\nERROR:', err.message);
  if (err.details) console.error('  details:', err.details);
  fail++;
} finally {
  console.log('\nCleaning up...');
  await cleanup();
  console.log(`\nResults: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
