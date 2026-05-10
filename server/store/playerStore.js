// Server-side player state cache + Supabase write-through.
//
// Reads: cache hit fast-path; on miss, load from Supabase via playerLoad.
// Writes: every mutation modifies the cache, then awaits syncStashAndMeta to
// persist. The cache is authoritative in-process; Supabase wins on cache miss
// (e.g. server restart).
//
// All exports are async. Callers must await.
import { loadPlayer, loadPlayerByUsername } from '../persistence/playerLoad.js';
import { createProfile, syncStashAndMeta }  from '../persistence/playerSync.js';
import { insertRunHistory }                 from '../persistence/runCommit.js';
import { appendDeadLetter }                 from '../persistence/deadLetter.js';
import { BUYABLE_PRICES }                   from '../../shared/data/shop.js';
import { sellPrice }                        from '../../shared/data/values.js';
import { RECIPE_REGISTRY }                  from '../../shared/data/crafting/recipes.js';

// Mirrors the seeded stash given to brand-new players on first login.
const INITIAL_STASH = [
  { id: 'longsword',          qty: 1 },
  { id: 'shortsword',         qty: 1 },
  { id: 'dagger',             qty: 1 },
  { id: 'handaxe',            qty: 1 },
  { id: 'mace',               qty: 1 },
  { id: 'greataxe',           qty: 1 },
  { id: 'greatsword',         qty: 1 },
  { id: 'chain_mail',         qty: 1 },
  { id: 'half_plate',         qty: 1 },
  { id: 'shield',             qty: 1 },
  { id: 'healing_potion',     qty: 2 },
  { id: 'bless_potion',       qty: 2 },
  { id: 'longstrider_potion', qty: 2 },
  { id: 'false_life_potion',  qty: 2 },
  { id: 'extraction_scroll',  qty: 1 },
];

const _players    = new Map(); // playerId  → state
const _byUsername = new Map(); // username  → playerId

function _add(arr, id, qty = 1) {
  const entry = arr.find(e => e.id === id);
  if (entry) entry.qty += qty;
  else arr.push({ id, qty });
}

function _remove(arr, id, qty = 1) {
  const entry = arr.find(e => e.id === id);
  if (!entry || entry.qty < qty) return false;
  entry.qty -= qty;
  return true;
}

function _clean(arr) {
  return arr.filter(e => e.qty > 0);
}

// Flat string[] → [{id, qty}], used for run_history.items_extracted.
function _aggregateItems(ids) {
  const acc = [];
  for (const id of ids) _add(acc, id);
  return acc;
}

function _cache(p) {
  _players.set(p.playerId, p);
  if (p.username) _byUsername.set(p.username, p.playerId);
  return p;
}

// ── Per-player mutation lock ──────────────────────────────────────────────────
// Serializes concurrent mutations for the same playerId. Without this, two
// mutations interleave at `await` boundaries and `syncStashAndMeta` can
// produce duplicate rows in `gear_stash` (see persistence-plan audit issue #1).
// Other players' mutations run in parallel — the lock is per-player, not global.
//
// Cleanup: the entry for a player is removed from `_locks` when its tail
// settles AND no newer tail has replaced it, so the Map doesn't grow forever
// for inactive players.
//
// Do NOT nest `_withLock` calls for the same playerId — they would deadlock.
// `savePlayer` is intentionally NOT locked here; the mutation that calls it
// already holds the lock.
const _locks = new Map(); // playerId → tail Promise

function _withLock(playerId, fn) {
  const prev = _locks.get(playerId) ?? Promise.resolve();
  const next = prev.catch(() => null).then(() => fn());
  const tail = next.catch(() => null);
  _locks.set(playerId, tail);
  tail.then(() => {
    if (_locks.get(playerId) === tail) _locks.delete(playerId);
  });
  return next;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getOrCreate(username) {
  const cachedId = _byUsername.get(username);
  if (cachedId) return _players.get(cachedId);

  const loaded = await loadPlayerByUsername(username);
  if (loaded) return _cache(loaded);

  const created = await createProfile(username, INITIAL_STASH);
  return _cache(created);
}

export async function getPlayer(playerId) {
  if (_players.has(playerId)) return _players.get(playerId);
  const loaded = await loadPlayer(playerId);
  if (!loaded) return null;
  return _cache(loaded);
}

export async function savePlayer(state) {
  return syncStashAndMeta(state);
}

// ── Hub mutations ─────────────────────────────────────────────────────────────

export async function stashToRaider(playerId, itemId) {
  return _withLock(playerId, async () => {
    const p = await getPlayer(playerId);
    if (!p) return { ok: false, error: 'Player not found' };
    if (!_remove(p.stash, itemId)) return { ok: false, error: 'Item not in stash' };
    p.stash = _clean(p.stash);
    _add(p.raiderPack, itemId);
    await savePlayer(p);
    return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
  });
}

export async function raiderToStash(playerId, itemId) {
  return _withLock(playerId, async () => {
    const p = await getPlayer(playerId);
    if (!p) return { ok: false, error: 'Player not found' };
    if (!_remove(p.raiderPack, itemId)) return { ok: false, error: 'Item not in raider pack' };
    p.raiderPack = _clean(p.raiderPack);
    _add(p.stash, itemId);
    await savePlayer(p);
    return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
  });
}

export async function dumpToStash(playerId) {
  return _withLock(playerId, async () => {
    const p = await getPlayer(playerId);
    if (!p) return { ok: false, error: 'Player not found' };
    for (const { id, qty } of p.raiderPack) _add(p.stash, id, qty);
    p.raiderPack = [];
    await savePlayer(p);
    return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
  });
}

// Buy: itemId must be in BUYABLE_PRICES (i.e. listed in a vendor catalog).
// Price is read from the registry — the client never supplies it.
export async function buyItem(playerId, itemId) {
  return _withLock(playerId, async () => {
    const p = await getPlayer(playerId);
    if (!p) return { ok: false, error: 'Player not found' };
    const price = BUYABLE_PRICES[itemId];
    if (price === undefined) return { ok: false, error: 'Item not for sale' };
    if (p.gold < price)      return { ok: false, error: 'Insufficient gold' };
    p.gold -= price;
    _add(p.stash, itemId);
    await savePlayer(p);
    return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
  });
}

// Sell: any item with a non-zero sellPrice. The client cannot influence the
// gold credited — sellPrice() is the only source.
export async function sellItem(playerId, itemId) {
  return _withLock(playerId, async () => {
    const p = await getPlayer(playerId);
    if (!p) return { ok: false, error: 'Player not found' };
    const credit = sellPrice(itemId);
    if (credit <= 0) return { ok: false, error: 'Item has no sell value' };
    if (!_remove(p.stash, itemId)) return { ok: false, error: 'Item not in stash' };
    p.stash = _clean(p.stash);
    p.gold += credit;
    await savePlayer(p);
    return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
  });
}

// Craft: client sends a recipe id; server resolves inputs/output from the
// registry. Recipes never come off the wire.
export async function craftRecipe(playerId, recipeId) {
  return _withLock(playerId, async () => {
    const p = await getPlayer(playerId);
    if (!p) return { ok: false, error: 'Player not found' };
    const recipe = RECIPE_REGISTRY[recipeId];
    if (!recipe) return { ok: false, error: 'Unknown recipe' };
    for (const { id, qty } of recipe.inputs) {
      const entry = p.stash.find(e => e.id === id);
      if (!entry || entry.qty < qty) return { ok: false, error: `Missing input: ${id}` };
    }
    for (const { id, qty } of recipe.inputs) _remove(p.stash, id, qty);
    p.stash = _clean(p.stash);
    _add(p.stash, recipe.output.id, recipe.output.qty);
    await savePlayer(p);
    return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
  });
}

// ── Dungeon commit hooks ───────────────────────────────────────────────────────

// Called by DungeonRoom on successful extraction.
// survivingItems: flat string[] of item IDs from player.inventory (server ArraySchema).
// classId / floorsReached / kills / runDurationS feed run_history; if classId is
// absent (callers from non-dungeon paths, e.g. tests) the row insert is skipped.
// A run_history insert failure is logged but never invalidates the stash mutation.
//
// Resilience (Phase 3 #6): if `savePlayer` throws after withRetry exhausts
// (i.e. sustained Supabase outage), the payload is appended to the dead-letter
// log before the error propagates so a server crash before the next mutation
// doesn't silently lose the run.
export async function commitExtract(playerId, {
  survivingItems = [],
  goldEarned     = 0,
  classId,
  floorsReached,
  kills          = 0,
  runDurationS,
} = {}) {
  return _withLock(playerId, async () => {
    const p = await getPlayer(playerId);
    if (!p) return null;
    const goldDelta = Math.floor(Number(goldEarned) || 0);
    for (const id of survivingItems) _add(p.stash, id);
    p.gold += goldDelta;
    p.raiderPack = [];
    try {
      await savePlayer(p);
    } catch (err) {
      await _safeAppendDeadLetter({
        kind:    'extract',
        playerId,
        payload: { survivingItems, goldEarned: goldDelta, classId, floorsReached, kills, runDurationS },
        error:   err?.message ?? String(err),
      });
      throw err;
    }

    if (classId) {
      try {
        await insertRunHistory({
          playerId,
          classId,
          floorsReached,
          extracted:       true,
          goldExtracted:   goldDelta,
          itemsExtracted:  _aggregateItems(survivingItems),
          kills,
          runDurationS,
        });
      } catch (err) {
        console.error('[playerStore.commitExtract] run_history insert failed:', err);
      }
    }
    return p;
  });
}

// Called by DungeonRoom on player death or mid-run disconnect.
// Items brought in are lost; stash and hub gold are untouched.
// classId / floorsReached / kills / runDurationS feed run_history; if classId is
// absent the row insert is skipped (keeps tests that don't supply metadata working).
//
// Resilience (Phase 3 #6): same dead-letter pattern as commitExtract.
export async function commitDeath(playerId, {
  classId,
  floorsReached,
  kills        = 0,
  runDurationS,
} = {}) {
  return _withLock(playerId, async () => {
    const p = await getPlayer(playerId);
    if (!p) return null;
    p.raiderPack = [];
    try {
      await savePlayer(p);
    } catch (err) {
      await _safeAppendDeadLetter({
        kind:    'death',
        playerId,
        payload: { classId, floorsReached, kills, runDurationS },
        error:   err?.message ?? String(err),
      });
      throw err;
    }

    if (classId) {
      try {
        await insertRunHistory({
          playerId,
          classId,
          floorsReached,
          extracted:       false,
          goldExtracted:   0,
          itemsExtracted:  [],
          kills,
          runDurationS,
        });
      } catch (err) {
        console.error('[playerStore.commitDeath] run_history insert failed:', err);
      }
    }
    return p;
  });
}

// If the dead-letter file itself can't be written (disk full, permissions),
// don't throw a second error on top of the first — log loudly and continue so
// the original Supabase error is what surfaces to the caller.
async function _safeAppendDeadLetter(record) {
  try {
    await appendDeadLetter(record);
  } catch (dlErr) {
    console.error('[playerStore] CRITICAL: dead-letter write failed:', dlErr,
                  '\n  original record:', JSON.stringify(record));
  }
}
