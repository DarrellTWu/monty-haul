// client/src/network/HubAPI.js
// Async fetch wrapper for the /hub HTTP routes on the Colyseus server.
// Derives the base URL from VITE_COLYSEUS_URL so only one env var is needed.

const _wsUrl = import.meta.env.VITE_COLYSEUS_URL || 'ws://localhost:2567';
const BASE   = _wsUrl.replace(/^ws/, 'http') + '/hub';

async function _post(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

async function _get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

export const HubAPI = {
  /** Upsert player by username. Returns { ok, playerId, stash, gold, raiderPack }. */
  login:            (username)              => _post('/login', { username }),

  /** Load current hub state for an existing player. Returns { ok, stash, gold, raiderPack }. */
  getState:         (playerId)              => _get(`/${playerId}`),

  addToRaider:      (playerId, itemId)      => _post(`/${playerId}/raider/add`,    { itemId }),
  removeFromRaider: (playerId, itemId)      => _post(`/${playerId}/raider/remove`, { itemId }),
  dumpToStash:      (playerId)              => _post(`/${playerId}/raider/dump`),
  buy:              (playerId, itemId, price) => _post(`/${playerId}/buy`,  { itemId, price }),
  sell:             (playerId, itemId, price) => _post(`/${playerId}/sell`, { itemId, price }),
  craft:            (playerId, recipe)      => _post(`/${playerId}/craft`,  { recipe }),
};
