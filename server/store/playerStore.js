import { randomUUID } from 'crypto';

// Mirrors the seeded stash in client/src/store/stash.js — given to brand-new players.
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

function _make(username) {
  return {
    playerId:   randomUUID(),
    username,
    stash:      INITIAL_STASH.map(e => ({ ...e })),
    gold:       0,
    raiderPack: [],
  };
}

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

// ── Public API ────────────────────────────────────────────────────────────────

export function getOrCreate(username) {
  const existing = _byUsername.get(username);
  if (existing) return _players.get(existing);
  const p = _make(username);
  _players.set(p.playerId, p);
  _byUsername.set(username, p.playerId);
  return p;
}

export function getPlayer(playerId) {
  return _players.get(playerId) ?? null;
}

// No-op in Phase 1. Phase 2 swaps this for a Supabase write.
export function savePlayer(_state) {}

// ── Hub mutations ─────────────────────────────────────────────────────────────

export function stashToRaider(playerId, itemId) {
  const p = getPlayer(playerId);
  if (!p) return { ok: false, error: 'Player not found' };
  if (!_remove(p.stash, itemId)) return { ok: false, error: 'Item not in stash' };
  p.stash = _clean(p.stash);
  _add(p.raiderPack, itemId);
  savePlayer(p);
  return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
}

export function raiderToStash(playerId, itemId) {
  const p = getPlayer(playerId);
  if (!p) return { ok: false, error: 'Player not found' };
  if (!_remove(p.raiderPack, itemId)) return { ok: false, error: 'Item not in raider pack' };
  p.raiderPack = _clean(p.raiderPack);
  _add(p.stash, itemId);
  savePlayer(p);
  return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
}

export function dumpToStash(playerId) {
  const p = getPlayer(playerId);
  if (!p) return { ok: false, error: 'Player not found' };
  for (const { id, qty } of p.raiderPack) _add(p.stash, id, qty);
  p.raiderPack = [];
  savePlayer(p);
  return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
}

export function buyItem(playerId, itemId, price) {
  const p = getPlayer(playerId);
  if (!p) return { ok: false, error: 'Player not found' };
  if (p.gold < price) return { ok: false, error: 'Insufficient gold' };
  p.gold -= price;
  _add(p.stash, itemId);
  savePlayer(p);
  return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
}

export function sellItem(playerId, itemId, price) {
  const p = getPlayer(playerId);
  if (!p) return { ok: false, error: 'Player not found' };
  if (!_remove(p.stash, itemId)) return { ok: false, error: 'Item not in stash' };
  p.stash = _clean(p.stash);
  p.gold += Math.max(0, Math.floor(Number(price) || 0));
  savePlayer(p);
  return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
}

export function craftRecipe(playerId, recipe) {
  const p = getPlayer(playerId);
  if (!p) return { ok: false, error: 'Player not found' };
  if (!recipe?.inputs || !recipe?.output) return { ok: false, error: 'Invalid recipe' };
  for (const { id, qty } of recipe.inputs) {
    const entry = p.stash.find(e => e.id === id);
    if (!entry || entry.qty < qty) return { ok: false, error: `Missing input: ${id}` };
  }
  for (const { id, qty } of recipe.inputs) _remove(p.stash, id, qty);
  p.stash = _clean(p.stash);
  _add(p.stash, recipe.output.id, recipe.output.qty);
  savePlayer(p);
  return { ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack };
}

// ── Dungeon commit hooks ───────────────────────────────────────────────────────

// Called by DungeonRoom on successful extraction.
// survivingItems: flat string[] of item IDs from player.inventory (server ArraySchema).
export function commitExtract(playerId, { survivingItems = [], goldEarned = 0 }) {
  const p = getPlayer(playerId);
  if (!p) return null;
  for (const id of survivingItems) _add(p.stash, id);
  p.gold += Math.floor(Number(goldEarned) || 0);
  p.raiderPack = [];
  savePlayer(p);
  return p;
}

// Called by DungeonRoom on player death or mid-run disconnect.
// Items brought in are lost; stash and hub gold are untouched.
export function commitDeath(playerId) {
  const p = getPlayer(playerId);
  if (!p) return null;
  p.raiderPack = [];
  savePlayer(p);
  return p;
}
