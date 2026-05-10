// server/tests/supabase-smoke.js
// Validates Supabase connection + read/write paths against the real dev project.
// Creates a temp player via createProfile, exercises syncStashAndMeta with
// several mutation patterns, asserts the loaders return the expected shape,
// then cleans up. ON CASCADE is not set, so we explicitly delete child rows
// before the profile.
//
// Run: node server/tests/supabase-smoke.js
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in server/.env.
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load env from server/.env relative to this file (works regardless of CWD).
const here    = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '..', '.env');
process.loadEnvFile(envFile);

const { supabase }                           = await import('../persistence/supabase.js');
const { loadPlayer, loadPlayerByUsername }   = await import('../persistence/playerLoad.js');
const { createProfile, syncStashAndMeta }    = await import('../persistence/playerSync.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

const TEST_USERNAME = `smoketest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const SEED_STASH = [
  { id: 'longsword',      qty: 1 },
  { id: 'healing_potion', qty: 3 },
];
let testPlayerId = null;

async function cleanup() {
  if (!testPlayerId) return;
  await supabase.from('gear_stash').delete().eq('player_id', testPlayerId);
  await supabase.from('meta_progression').delete().eq('player_id', testPlayerId);
  await supabase.from('player_profiles').delete().eq('id', testPlayerId);
}

function stashMap(state) {
  return Object.fromEntries((state?.stash ?? []).map(e => [e.id, e.qty]));
}

async function run() {
  console.log(`Test username: ${TEST_USERNAME}\n`);

  // ── Phase 1: createProfile ───────────────────────────────────────────────────
  console.log('Phase 1: createProfile');
  const created = await createProfile(TEST_USERNAME, SEED_STASH);
  testPlayerId = created.playerId;
  check('createProfile returns playerId',                 !!testPlayerId);
  check('  username matches',                             created.username === TEST_USERNAME);
  check('  gold = 0',                                     created.gold === 0);
  check('  raiderPack empty',                             created.raiderPack.length === 0);
  check('  stash has both seeded items',                  created.stash.length === 2);

  // ── Phase 2: loadPlayer reads what createProfile wrote ───────────────────────
  console.log('\nPhase 2: loaders return seeded state');
  const loadedById   = await loadPlayer(testPlayerId);
  const loadedByName = await loadPlayerByUsername(TEST_USERNAME);
  check('loadPlayer(id) non-null',                        !!loadedById);
  check('loadPlayerByUsername non-null',                  !!loadedByName);
  check('  shapes match',                                 JSON.stringify(loadedById) === JSON.stringify(loadedByName));
  const m1 = stashMap(loadedById);
  check('  longsword qty 1',                              m1.longsword === 1);
  check('  healing_potion qty 3',                         m1.healing_potion === 3);

  // ── Phase 3: syncStashAndMeta — add, modify, gold, raiderPack ────────────────
  console.log('\nPhase 3: sync mutations');
  const mutated = {
    playerId:   testPlayerId,
    stash:      [
      { id: 'longsword',      qty: 1 },
      { id: 'healing_potion', qty: 5 },         // qty increased
      { id: 'shortsword',     qty: 1 },         // new item
    ],
    gold:       100,
    raiderPack: [{ id: 'dagger', qty: 1 }, { id: 'mace', qty: 2 }],
  };
  await syncStashAndMeta(mutated);

  const reloaded = await loadPlayer(testPlayerId);
  const m2 = stashMap(reloaded);
  check('  stash now has 3 items',                        Object.keys(m2).length === 3);
  check('  longsword still qty 1',                        m2.longsword === 1);
  check('  healing_potion now qty 5',                     m2.healing_potion === 5);
  check('  shortsword qty 1 (new)',                       m2.shortsword === 1);
  check('  gold = 100',                                   reloaded.gold === 100);
  check('  raiderPack length = 2',                        reloaded.raiderPack.length === 2);
  check('  raiderPack contains dagger',                   reloaded.raiderPack.some(e => e.id === 'dagger' && e.qty === 1));
  check('  raiderPack contains mace x2',                  reloaded.raiderPack.some(e => e.id === 'mace' && e.qty === 2));

  // ── Phase 4: removal — drop an item, set qty to 0 on another ─────────────────
  console.log('\nPhase 4: sync handles removal');
  const removed = {
    playerId:   testPlayerId,
    stash:      [
      { id: 'longsword',      qty: 0 },         // qty 0 → should be deleted
      { id: 'healing_potion', qty: 5 },
      // shortsword omitted entirely → should be deleted
    ],
    gold:       100,
    raiderPack: [],
  };
  await syncStashAndMeta(removed);

  const r3 = await loadPlayer(testPlayerId);
  const m3 = stashMap(r3);
  check('  stash now has 1 item',                         Object.keys(m3).length === 1);
  check('  only healing_potion remains',                  m3.healing_potion === 5 && !m3.longsword && !m3.shortsword);
  check('  raiderPack empty',                             r3.raiderPack.length === 0);

  // ── Phase 5: empty stash entirely ────────────────────────────────────────────
  console.log('\nPhase 5: sync handles fully-empty stash');
  await syncStashAndMeta({
    playerId:   testPlayerId,
    stash:      [],
    gold:       0,
    raiderPack: [],
  });
  const r4 = await loadPlayer(testPlayerId);
  check('  stash is empty array',                         Array.isArray(r4.stash) && r4.stash.length === 0);
  check('  gold = 0',                                     r4.gold === 0);

  // ── Phase 6: convergence — UPSERT + DELETE-NOT-IN replaces full stash ───────
  // Phase 3 #5 changed sync from DELETE-all + INSERT-all to UPSERT-changed +
  // DELETE-NOT-IN. Verify a fully-different set of items lands cleanly:
  // existing items are removed, new items are added, no duplicate rows.
  console.log('\nPhase 6: convergence on full stash replacement');
  await syncStashAndMeta({
    playerId:   testPlayerId,
    stash:      [{ id: 'greatsword', qty: 1 }, { id: 'shield', qty: 1 }],
    gold:       50,
    raiderPack: [],
  });
  const r5 = await loadPlayer(testPlayerId);
  const m5 = stashMap(r5);
  check('  stash now has 2 items',                        Object.keys(m5).length === 2);
  check('  greatsword qty 1',                             m5.greatsword === 1);
  check('  shield qty 1',                                 m5.shield === 1);
  check('  no leftover from prior stash',                 !m5.healing_potion && !m5.longsword);

  // Now mutate again: keep one, modify one, add one, drop one.
  await syncStashAndMeta({
    playerId:   testPlayerId,
    stash:      [
      { id: 'greatsword',     qty: 2 },         // qty change
      { id: 'healing_potion', qty: 4 },         // re-added
      // shield dropped
    ],
    gold:       60,
    raiderPack: [],
  });
  const r6 = await loadPlayer(testPlayerId);
  const m6 = stashMap(r6);
  check('  stash now has 2 items (post-mutation)',        Object.keys(m6).length === 2);
  check('  greatsword qty bumped to 2',                   m6.greatsword === 2);
  check('  healing_potion re-added at qty 4',             m6.healing_potion === 4);
  check('  shield removed',                               !m6.shield);

  // Direct DB check: confirm gear_stash has exactly 2 rows for this player
  // (no duplicates from the convergence path).
  const { data: rawRows, error: rawErr } = await supabase
    .from('gear_stash')
    .select('item_id')
    .eq('player_id', testPlayerId);
  check('  raw query: 2 rows in gear_stash',              !rawErr && rawRows?.length === 2);

  // ── Phase 7: negative cases ──────────────────────────────────────────────────
  console.log('\nPhase 7: loaders return null for unknown ids');
  const missingById   = await loadPlayer('00000000-0000-0000-0000-000000000000');
  const missingByName = await loadPlayerByUsername('__no_such_user_42__');
  check('loadPlayer(unknown UUID) returns null',          missingById === null);
  check('loadPlayerByUsername(unknown) returns null',     missingByName === null);
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
