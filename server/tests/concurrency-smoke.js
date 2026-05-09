// server/tests/concurrency-smoke.js
// Validates the per-player mutation lock in playerStore.js.
// Fires N concurrent buyItem calls on a fresh test player and asserts:
//   - All N calls return ok
//   - DB stash has a single row for the bought item with qty == N
//   - gear_stash row count for the player == 1 (no duplicates from race)
//   - DB gold reflects N purchases at the given price
//
// Without the lock (audit issue #1), concurrent syncs interleave their
// DELETE+INSERT and produce duplicate rows in gear_stash. With the lock,
// mutations serialize per-player and the result is deterministic.
//
// Run: node server/tests/concurrency-smoke.js
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here    = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '..', '.env');
process.loadEnvFile(envFile);

const { supabase }                            = await import('../persistence/supabase.js');
const { createProfile, syncStashAndMeta }     = await import('../persistence/playerSync.js');
const { loadPlayer }                          = await import('../persistence/playerLoad.js');
const playerStore                             = await import('../store/playerStore.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

const TEST_USERNAME = `racetest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const N             = 20;       // concurrent buyItem calls
const ITEM          = 'healing_potion';
const PRICE         = 50;       // canonical price from VENDOR_CATALOG; server resolves
const STARTING_GOLD = 10000;
let testPlayerId    = null;

async function cleanup() {
  if (!testPlayerId) return;
  await supabase.from('gear_stash').delete().eq('player_id', testPlayerId);
  await supabase.from('meta_progression').delete().eq('player_id', testPlayerId);
  await supabase.from('player_profiles').delete().eq('id', testPlayerId);
}

async function gearStashRowCount(playerId) {
  const { count, error } = await supabase
    .from('gear_stash')
    .select('*', { count: 'exact', head: true })
    .eq('player_id', playerId);
  if (error) throw error;
  return count;
}

async function run() {
  console.log(`Test username: ${TEST_USERNAME}`);
  console.log(`Concurrent mutations: ${N}\n`);

  // ── Setup: empty stash, large gold pile ──────────────────────────────────────
  const created = await createProfile(TEST_USERNAME, []);
  testPlayerId = created.playerId;
  await syncStashAndMeta({
    playerId:   testPlayerId,
    stash:      [],
    gold:       STARTING_GOLD,
    raiderPack: [],
  });

  // Warm the playerStore cache so concurrent buys all see the same starting state.
  const warm = await playerStore.getPlayer(testPlayerId);
  check('warm cache: gold matches setup',          warm.gold === STARTING_GOLD);
  check('warm cache: stash empty',                 warm.stash.length === 0);

  // ── Fire N concurrent buyItems ───────────────────────────────────────────────
  console.log(`\nFiring ${N} concurrent buyItem calls...`);
  const results = await Promise.all(
    Array.from({ length: N }, () => playerStore.buyItem(testPlayerId, ITEM)),
  );

  const oks = results.filter(r => r.ok).length;
  check(`all ${N} buys returned ok`,               oks === N);

  // ── DB verification (bypass cache) ───────────────────────────────────────────
  const dbState = await loadPlayer(testPlayerId);
  const stashEntries = dbState.stash.filter(e => e.id === ITEM);

  check(`DB stash has exactly 1 entry for ${ITEM}`,    stashEntries.length === 1);
  check(`DB stash qty for ${ITEM} == ${N}`,            stashEntries[0]?.qty === N);
  check(`DB gold == ${STARTING_GOLD - N * PRICE}`,     dbState.gold === STARTING_GOLD - N * PRICE);

  // The smoking gun: count raw rows in gear_stash.
  // Without lock: > 1 (interleaved syncs INSERT multiple times).
  // With lock:    == 1 (single row, qty aggregates correctly).
  const rowCount = await gearStashRowCount(testPlayerId);
  check(`gear_stash row count == 1 (no duplicate rows)`, rowCount === 1);
  if (rowCount !== 1) console.log(`        actual row count: ${rowCount}`);
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
