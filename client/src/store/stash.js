// client/src/store/stash.js
// Server-backed item store. In-memory cache populated from the /hub API.
// Sync reads return from cache. Async mutations call the server and update cache.
// This is the only file that changes when the backing store changes (was localStorage).

import { HubAPI } from '../network/HubAPI.js';

const PLAYER_ID_KEY = 'mh_player_id';

let _playerId = localStorage.getItem(PLAYER_ID_KEY) ?? null;
let _username = null;
let _cache    = { stash: [], gold: 0, raiderPack: [] };

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Called by HubScene after login or state load.
 * Populates the cache and persists the playerId for the next session.
 */
export function initFromServer(playerId, { username, stash, gold, raiderPack }) {
  _playerId = playerId;
  _username = username ?? null;
  localStorage.setItem(PLAYER_ID_KEY, playerId);
  _cache = { stash: stash ?? [], gold: gold ?? 0, raiderPack: raiderPack ?? [] };
}

export function getPlayerId() { return _playerId; }
export function getUsername() { return _username; }

/**
 * Clear the client session. The server has no per-session state to tear down —
 * the playerId in localStorage is the only token. After this returns, HubScene
 * can route to the login screen via getPlayerId() === null.
 */
export function logout() {
  _playerId = null;
  _username = null;
  _cache    = { stash: [], gold: 0, raiderPack: [] };
  localStorage.removeItem(PLAYER_ID_KEY);
}

// ── Sync reads (from cache) ───────────────────────────────────────────────────

export function getStash()      { return _cache.stash; }
export function getRaiderPack() { return _cache.raiderPack; }
export function getHubGold()    { return _cache.gold; }

/** Flat id array for passing to the server on dungeon join. */
export function getRaiderPackFlat() {
  const ids = [];
  for (const { id, qty } of _cache.raiderPack) {
    for (let i = 0; i < qty; i++) ids.push(id);
  }
  return ids;
}

// ── Async mutations ───────────────────────────────────────────────────────────

function _apply(result) {
  if (result.ok) {
    if (result.stash      !== undefined) _cache.stash      = result.stash;
    if (result.gold       !== undefined) _cache.gold       = result.gold;
    if (result.raiderPack !== undefined) _cache.raiderPack = result.raiderPack;
  }
  return result.ok;
}

/** Move 1× of item from stash → raider pack. Returns Promise<bool>. */
export async function stashToRaider(id) {
  return _apply(await HubAPI.addToRaider(_playerId, id));
}

/** Move 1× of item from raider pack → stash. Returns Promise<bool>. */
export async function raiderToStash(id) {
  return _apply(await HubAPI.removeFromRaider(_playerId, id));
}

/** Move all raider pack items → stash. Returns Promise<bool>. */
export async function dumpRaiderPackToStash() {
  return _apply(await HubAPI.dumpToStash(_playerId));
}

/** Spend gold to add 1× item to stash. Server resolves price. Returns Promise<bool>. */
export async function buyItem(id) {
  return _apply(await HubAPI.buy(_playerId, id));
}

/** Remove 1× item from stash, gain canonical sell value in gold. Returns Promise<bool>. */
export async function sellItem(id) {
  return _apply(await HubAPI.sell(_playerId, id));
}

/** Consume recipe inputs and add output to stash. Server resolves recipe by id. Returns Promise<bool>. */
export async function craftRecipe(recipeId) {
  return _apply(await HubAPI.craft(_playerId, recipeId));
}

/**
 * Rename the player. Returns the full server result so the UI can distinguish
 * `username_taken` from `invalid_username` from a network failure (the bool
 * pattern used elsewhere wouldn't carry that information).
 */
export async function renameUser(newUsername) {
  const result = await HubAPI.rename(_playerId, newUsername);
  if (result.ok && result.username) _username = result.username;
  return result;
}

// ── DungeonScene compatibility stubs (replaced in Checkpoint 4) ───────────────
// Server commits stash + gold on extract/death. Until then, these keep the
// local cache updated so the hub displays correctly when the player returns.

export function setRaiderPack(ids) {
  const map = {};
  for (const id of ids) map[id] = (map[id] ?? 0) + 1;
  _cache.raiderPack = Object.entries(map).map(([id, qty]) => ({ id, qty }));
}

export function addHubGold(n) {
  _cache.gold += Math.floor(Number(n) || 0);
}

export function setHubGold(n) {
  _cache.gold = Math.max(0, Math.floor(Number(n) || 0));
}
