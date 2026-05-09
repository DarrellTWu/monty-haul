// server/tests/anti-cheat-smoke.js
// Validates server-authoritative pricing and recipes (Phase 3 audit issue #2).
//
// Pre-fix, /buy /sell /craft trusted client-supplied price and recipe
// payloads — a malicious client could buy free, mint gold, or craft anything.
// After the fix, the server resolves prices from BUYABLE_PRICES, sell credits
// from sellPrice(), and recipes from RECIPE_REGISTRY. Item / recipe IDs are
// the only client input.
//
// This test exercises playerStore directly (the route is a thin pass-through):
//   - Unknown item id on buy/sell → rejected, gold/stash unchanged
//   - Material id (sellable but not buyable) → rejected on buy
//   - Unknown recipe id on craft → rejected, stash unchanged
//   - Successful buy charges canonical price (not what we hoped for)
//   - Successful sell credits canonical sellPrice
//   - Successful craft consumes canonical inputs and produces canonical output
//
// Run: node server/tests/anti-cheat-smoke.js
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here    = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '..', '.env');
process.loadEnvFile(envFile);

const { supabase }                = await import('../persistence/supabase.js');
const { createProfile,
        syncStashAndMeta }        = await import('../persistence/playerSync.js');
const playerStore                 = await import('../store/playerStore.js');
const { BUYABLE_PRICES }          = await import('../../shared/data/shop.js');
const { sellPrice }               = await import('../../shared/data/values.js');
const { RECIPE_REGISTRY }         = await import('../../shared/data/crafting/recipes.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

const TEST_USERNAME = `cheattest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const STARTING_GOLD = 1000;
let testPlayerId    = null;

async function cleanup() {
  if (!testPlayerId) return;
  await supabase.from('gear_stash').delete().eq('player_id', testPlayerId);
  await supabase.from('meta_progression').delete().eq('player_id', testPlayerId);
  await supabase.from('player_profiles').delete().eq('id', testPlayerId);
}

async function run() {
  console.log(`Test username: ${TEST_USERNAME}\n`);

  // ── Setup: empty stash + 2 skeleton_bones (for craft test) + gold ──
  const created = await createProfile(TEST_USERNAME, [{ id: 'skeleton_bone', qty: 2 }]);
  testPlayerId = created.playerId;
  await syncStashAndMeta({
    playerId:   testPlayerId,
    stash:      [{ id: 'skeleton_bone', qty: 2 }],
    gold:       STARTING_GOLD,
    raiderPack: [],
  });

  // ── Buy: unknown item id ─────────────────────────────────────────────────────
  console.log('Buy: unknown item id');
  let r = await playerStore.buyItem(testPlayerId, 'nonexistent_item');
  check('rejected with ok=false',                  r.ok === false);
  let p = await playerStore.getPlayer(testPlayerId);
  check('gold unchanged after rejection',          p.gold === STARTING_GOLD);
  check('stash unchanged after rejection',         p.stash.find(e => e.id === 'nonexistent_item') === undefined);

  // ── Buy: material id (sellable but not buyable) ──────────────────────────────
  console.log('\nBuy: material id (wolf_pelt)');
  check('wolf_pelt has sell value but not buyable', sellPrice('wolf_pelt') > 0
                                                && BUYABLE_PRICES.wolf_pelt === undefined);
  r = await playerStore.buyItem(testPlayerId, 'wolf_pelt');
  check('rejected with ok=false',                  r.ok === false);
  p = await playerStore.getPlayer(testPlayerId);
  check('gold unchanged after rejection',          p.gold === STARTING_GOLD);
  check('wolf_pelt did not enter stash',           p.stash.find(e => e.id === 'wolf_pelt') === undefined);

  // ── Buy: legitimate purchase charges canonical price ─────────────────────────
  console.log('\nBuy: healing_potion (canonical 50 gp)');
  const goldBefore = p.gold;
  const canonical  = BUYABLE_PRICES.healing_potion;
  check('canonical price is 50',                   canonical === 50);
  r = await playerStore.buyItem(testPlayerId, 'healing_potion');
  check('returned ok=true',                        r.ok === true);
  p = await playerStore.getPlayer(testPlayerId);
  check(`gold decremented by ${canonical}`,        p.gold === goldBefore - canonical);
  check('healing_potion in stash qty 1',           p.stash.find(e => e.id === 'healing_potion')?.qty === 1);

  // ── Sell: unknown item id ────────────────────────────────────────────────────
  console.log('\nSell: unknown item id');
  const goldBeforeSell = p.gold;
  r = await playerStore.sellItem(testPlayerId, 'nonexistent_item');
  check('rejected with ok=false',                  r.ok === false);
  p = await playerStore.getPlayer(testPlayerId);
  check('gold unchanged after rejection',          p.gold === goldBeforeSell);

  // ── Sell: legitimate sale credits canonical sellPrice ────────────────────────
  console.log('\nSell: healing_potion (canonical 12 gp)');
  const expectedCredit = sellPrice('healing_potion');
  check('canonical credit is 12',                  expectedCredit === 12);
  r = await playerStore.sellItem(testPlayerId, 'healing_potion');
  check('returned ok=true',                        r.ok === true);
  p = await playerStore.getPlayer(testPlayerId);
  check(`gold incremented by ${expectedCredit}`,   p.gold === goldBeforeSell + expectedCredit);
  check('healing_potion removed from stash',       p.stash.find(e => e.id === 'healing_potion') === undefined);

  // ── Craft: unknown recipe id ────────────────────────────────────────────────
  console.log('\nCraft: unknown recipe id');
  r = await playerStore.craftRecipe(testPlayerId, 'nonexistent_recipe');
  check('rejected with ok=false',                  r.ok === false);
  p = await playerStore.getPlayer(testPlayerId);
  check('skeleton_bone stash unchanged',           p.stash.find(e => e.id === 'skeleton_bone')?.qty === 2);

  // ── Craft: bone_brew (2× skeleton_bone → 1× false_life_potion) ─────────────
  console.log('\nCraft: bone_brew (canonical recipe)');
  const recipe = RECIPE_REGISTRY.bone_brew;
  check('bone_brew exists',                        recipe !== undefined);
  r = await playerStore.craftRecipe(testPlayerId, 'bone_brew');
  check('returned ok=true',                        r.ok === true);
  p = await playerStore.getPlayer(testPlayerId);
  check('skeleton_bone consumed',                  p.stash.find(e => e.id === 'skeleton_bone') === undefined);
  check('false_life_potion produced',              p.stash.find(e => e.id === 'false_life_potion')?.qty === 1);

  // ── Craft: re-attempt with no inputs → rejected ────────────────────────────
  console.log('\nCraft: bone_brew with no inputs left');
  r = await playerStore.craftRecipe(testPlayerId, 'bone_brew');
  check('rejected with ok=false',                  r.ok === false);
  check('error mentions missing input',            /Missing input/.test(r.error || ''));
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
