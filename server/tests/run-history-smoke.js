// server/tests/run-history-smoke.js
// Validates the run_history write path against the real dev Supabase project.
// Drives playerStore.commitExtract / commitDeath end-to-end:
//   - creates a temp profile (so FK to player_profiles is satisfied)
//   - calls commitExtract with run metadata, asserts the row landed correctly
//   - calls commitDeath with run metadata, asserts a second row landed correctly
//   - cleans up run_history + gear_stash + meta_progression + profile rows
//
// Run: node server/tests/run-history-smoke.js
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in server/.env.
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load env from server/.env relative to this file (works regardless of CWD).
const here    = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '..', '.env');
process.loadEnvFile(envFile);

const { supabase }                        = await import('../persistence/supabase.js');
const { createProfile }                   = await import('../persistence/playerSync.js');
const { commitExtract, commitDeath }      = await import('../store/playerStore.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

const TEST_USERNAME = `runhist_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let testPlayerId = null;

async function cleanup() {
  if (!testPlayerId) return;
  await supabase.from('run_history').delete().eq('player_id', testPlayerId);
  await supabase.from('gear_stash').delete().eq('player_id', testPlayerId);
  await supabase.from('meta_progression').delete().eq('player_id', testPlayerId);
  await supabase.from('player_profiles').delete().eq('id', testPlayerId);
}

async function fetchRows() {
  const { data, error } = await supabase
    .from('run_history')
    .select('class, floors_reached, extracted, gold_extracted, items_extracted, kills, run_duration_s')
    .eq('player_id', testPlayerId)
    .order('completed_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function findItem(items, id) {
  return (items ?? []).find(e => e.id === id);
}

async function run() {
  console.log(`Test username: ${TEST_USERNAME}\n`);

  // ── Phase 1: seed profile ───────────────────────────────────────────────────
  console.log('Phase 1: seed profile');
  const created = await createProfile(TEST_USERNAME, []);
  testPlayerId  = created.playerId;
  check('profile created', !!testPlayerId);

  // ── Phase 2: commitExtract writes a run_history row ─────────────────────────
  console.log('\nPhase 2: commitExtract');
  await commitExtract(testPlayerId, {
    survivingItems: ['longsword', 'healing_potion', 'healing_potion'],
    goldEarned:     15,
    classId:        'fighter',
    floorsReached:  2,
    kills:          0,
    runDurationS:   42,
  });

  let rows = await fetchRows();
  check('one row inserted',                 rows.length === 1);
  const r1 = rows[0] ?? {};
  check('  class = fighter',                r1.class === 'fighter');
  check('  floors_reached = 2',             r1.floors_reached === 2);
  check('  extracted = true',               r1.extracted === true);
  check('  gold_extracted = 15',            r1.gold_extracted === 15);
  check('  kills = 0',                      r1.kills === 0);
  check('  run_duration_s = 42',            r1.run_duration_s === 42);

  const longsword = findItem(r1.items_extracted, 'longsword');
  const potion    = findItem(r1.items_extracted, 'healing_potion');
  check('  items_extracted has longsword × 1', longsword?.qty === 1);
  check('  items_extracted has healing_potion × 2', potion?.qty === 2);
  check('  items_extracted length = 2',     (r1.items_extracted ?? []).length === 2);

  // ── Phase 3: commitDeath writes a second row ────────────────────────────────
  console.log('\nPhase 3: commitDeath');
  await commitDeath(testPlayerId, {
    classId:       'barbarian',
    floorsReached: 1,
    kills:         0,
    runDurationS:  10,
  });

  rows = await fetchRows();
  check('two rows after death',             rows.length === 2);
  const r2 = rows[1] ?? {};
  check('  class = barbarian',              r2.class === 'barbarian');
  check('  floors_reached = 1',             r2.floors_reached === 1);
  check('  extracted = false',              r2.extracted === false);
  check('  gold_extracted = 0',             r2.gold_extracted === 0);
  check('  items_extracted empty',          (r2.items_extracted ?? []).length === 0);
  check('  run_duration_s = 10',            r2.run_duration_s === 10);

  // ── Phase 4: legacy call (no metadata) does not insert ──────────────────────
  console.log('\nPhase 4: commitDeath without metadata is a no-op for run_history');
  await commitDeath(testPlayerId);
  rows = await fetchRows();
  check('still two rows (no metadata = no insert)', rows.length === 2);
}

try {
  await run();
} catch (err) {
  console.error('\nUNCAUGHT ERROR:', err);
  fail++;
} finally {
  await cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
