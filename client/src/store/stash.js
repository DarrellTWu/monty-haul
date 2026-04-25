// client/src/store/stash.js
// Persistent item store: two containers (stash + raider pack), backed by localStorage.
// This is the only file that changes when Supabase replaces localStorage.

const STASH_KEY       = 'mh_stash';
const RAIDER_PACK_KEY = 'mh_raider_pack';

const INITIAL_STASH = [
  { id: 'longsword',           qty: 1 },
  { id: 'shortsword',          qty: 1 },
  { id: 'dagger',              qty: 1 },
  { id: 'handaxe',             qty: 1 },
  { id: 'mace',                qty: 1 },
  { id: 'greataxe',            qty: 1 },
  { id: 'greatsword',          qty: 1 },
  { id: 'chain_mail',          qty: 1 },
  { id: 'half_plate',          qty: 1 },
  { id: 'shield',              qty: 1 },
  { id: 'healing_potion',      qty: 2 },
  { id: 'bless_potion',        qty: 2 },
  { id: 'longstrider_potion',  qty: 2 },
  { id: 'false_life_potion',   qty: 2 },
];

function _load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function _save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Silently ignore — localStorage unavailable (e.g. private browsing quota exceeded).
  }
}

// Seed on first ever load. Does not overwrite existing data.
if (!localStorage.getItem(STASH_KEY))       _save(STASH_KEY,       INITIAL_STASH.map(e => ({ ...e })));
if (!localStorage.getItem(RAIDER_PACK_KEY)) _save(RAIDER_PACK_KEY, []);

// ── Public API ────────────────────────────────────────────────────────────────

export function getStash()      { return _load(STASH_KEY,       []); }
export function getRaiderPack() { return _load(RAIDER_PACK_KEY, []); }

/** Move 1× of item from stash → raider pack. Returns false if item not in stash. */
export function stashToRaider(id) {
  const stash = getStash();
  const pack  = getRaiderPack();
  const src   = stash.find(e => e.id === id);
  if (!src || src.qty < 1) return false;

  src.qty -= 1;
  const dst = pack.find(e => e.id === id);
  if (dst) dst.qty += 1;
  else pack.push({ id, qty: 1 });

  _save(STASH_KEY,       stash.filter(e => e.qty > 0));
  _save(RAIDER_PACK_KEY, pack);
  return true;
}

/** Move 1× of item from raider pack → stash. Returns false if item not in pack. */
export function raiderToStash(id) {
  const stash = getStash();
  const pack  = getRaiderPack();
  const src   = pack.find(e => e.id === id);
  if (!src || src.qty < 1) return false;

  src.qty -= 1;
  const dst = stash.find(e => e.id === id);
  if (dst) dst.qty += 1;
  else stash.push({ id, qty: 1 });

  _save(STASH_KEY,       stash);
  _save(RAIDER_PACK_KEY, pack.filter(e => e.qty > 0));
  return true;
}

/** Flat id array for passing to the server on dungeon join. */
export function getRaiderPackFlat() {
  const ids = [];
  for (const { id, qty } of getRaiderPack()) {
    for (let i = 0; i < qty; i++) ids.push(id);
  }
  return ids;
}

/** Overwrite raider pack from a flat id array. Called post-run with surviving items. */
export function setRaiderPack(ids) {
  const map = {};
  for (const id of ids) map[id] = (map[id] ?? 0) + 1;
  _save(RAIDER_PACK_KEY, Object.entries(map).map(([id, qty]) => ({ id, qty })));
}
