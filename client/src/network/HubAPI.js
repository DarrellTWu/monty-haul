// client/src/network/HubAPI.js
// Async fetch wrapper for the /hub HTTP routes on the Colyseus server.
// Derives the base URL from VITE_COLYSEUS_URL so only one env var is needed.
//
// Auth: every route except /login requires the Bearer session token issued at
// login. The token getter is injected by store/stash.js (setTokenProvider) to
// avoid an import cycle between the store and this module.

const _wsUrl = import.meta.env.VITE_COLYSEUS_URL || 'ws://localhost:2567';
const BASE   = _wsUrl.replace(/^ws/, 'http') + '/hub';

let _getToken = () => null;
export function setTokenProvider(fn) { _getToken = fn; }

function _authHeaders() {
  const token = _getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function _post(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body:    JSON.stringify(body),
  });
  return res.json();
}

async function _get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: _authHeaders() });
  return res.json();
}

export const HubAPI = {
  /** Register-or-login with username+password. Returns { ok, token, playerId, stash, gold, raiderPack }. */
  login:            (username, password)    => _post('/login', { username, password }),

  /** Load current hub state for an existing player. Returns { ok, stash, gold, raiderPack }. */
  getState:         (playerId)              => _get(`/${playerId}`),

  addToRaider:      (playerId, itemId)   => _post(`/${playerId}/raider/add`,    { itemId }),
  removeFromRaider: (playerId, itemId)   => _post(`/${playerId}/raider/remove`, { itemId }),
  dumpToStash:      (playerId)           => _post(`/${playerId}/raider/dump`),

  // Prices and recipe internals are resolved server-side. Client sends ids only.
  buy:              (playerId, itemId)   => _post(`/${playerId}/buy`,   { itemId }),
  sell:             (playerId, itemId)   => _post(`/${playerId}/sell`,  { itemId }),
  craft:            (playerId, recipeId) => _post(`/${playerId}/craft`, { recipeId }),

  // Returns { ok, username } on success or { ok:false, error } on failure.
  // Errors: 'username_taken' | 'invalid_username' | 'Player not found'.
  rename:           (playerId, username) => _post(`/${playerId}/rename`, { username }),
};
