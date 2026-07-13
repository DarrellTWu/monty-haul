import { createRequire } from 'module';
const express = createRequire(import.meta.url)('express');

import * as store from '../store/playerStore.js';
import { issueToken, requireAuth } from '../auth/tokens.js';

const router = express.Router();

// CORS: allowlist from ALLOWED_ORIGINS env (comma-separated origins, e.g.
// "https://montyhaul.pages.dev,http://localhost:5173"). Unset → wildcard,
// which keeps local dev zero-config; hosted deploys must set the env var
// (deployment-guide §8). Disallowed origins get no CORS headers — the
// browser blocks the response.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

router.use((req, res, next) => {
  if (allowedOrigins.length === 0) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (allowedOrigins.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Wraps an async handler, catches throws (e.g. supabase outage), returns 500.
function asyncRoute(handler) {
  return (req, res) => {
    handler(req, res).catch(err => {
      console.error(`[hub] ${req.method} ${req.originalUrl} failed:`, err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: 'Internal server error' });
      }
    });
  };
}

// POST /hub/login  { username, password }
// Register-or-authenticate by username+password (legacy passwordless accounts
// adopt the first password presented — see playerStore.authenticate). Returns
// full hub state plus the session token every other route requires.
router.post('/login', asyncRoute(async (req, res) => {
  const username = req.body?.username?.trim();
  const password = String(req.body?.password ?? '');
  if (!username)            return res.status(400).json({ ok: false, error: 'username required' });
  if (password.length < 6)  return res.status(400).json({ ok: false, error: 'password must be at least 6 characters' });
  const result = await store.authenticate(username, password);
  if (!result.ok) return res.status(401).json({ ok: false, error: result.error });
  const p = result.player;
  res.json({
    ok: true, token: issueToken(p.playerId),
    playerId: p.playerId, username: p.username, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack,
  });
}));

// Everything below /login requires a valid Bearer token whose playerId
// matches the :playerId in the path (401 bad token, 403 someone else's).
router.use('/:playerId', requireAuth);

// GET /hub/:playerId
// Load current hub state for an existing player.
router.get('/:playerId', asyncRoute(async (req, res) => {
  const p = await store.getPlayer(req.params.playerId);
  if (!p) return res.status(404).json({ ok: false, error: 'Player not found' });
  res.json({ ok: true, username: p.username, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack });
}));

// POST /hub/:playerId/raider/add  { itemId }
router.post('/:playerId/raider/add', asyncRoute(async (req, res) => {
  const result = await store.stashToRaider(req.params.playerId, req.body?.itemId);
  res.status(result.ok ? 200 : 400).json(result);
}));

// POST /hub/:playerId/raider/remove  { itemId }
router.post('/:playerId/raider/remove', asyncRoute(async (req, res) => {
  const result = await store.raiderToStash(req.params.playerId, req.body?.itemId);
  res.status(result.ok ? 200 : 400).json(result);
}));

// POST /hub/:playerId/raider/dump
router.post('/:playerId/raider/dump', asyncRoute(async (req, res) => {
  const result = await store.dumpToStash(req.params.playerId);
  res.status(result.ok ? 200 : 400).json(result);
}));

// POST /hub/:playerId/buy  { itemId }
// Server-authoritative: price comes from BUYABLE_PRICES, never the client.
router.post('/:playerId/buy', asyncRoute(async (req, res) => {
  const result = await store.buyItem(req.params.playerId, req.body?.itemId);
  res.status(result.ok ? 200 : 400).json(result);
}));

// POST /hub/:playerId/sell  { itemId }
// Server-authoritative: gold credit comes from sellPrice(), never the client.
router.post('/:playerId/sell', asyncRoute(async (req, res) => {
  const result = await store.sellItem(req.params.playerId, req.body?.itemId);
  res.status(result.ok ? 200 : 400).json(result);
}));

// POST /hub/:playerId/craft  { recipeId }
// Server-authoritative: recipe inputs/output come from RECIPE_REGISTRY.
router.post('/:playerId/craft', asyncRoute(async (req, res) => {
  const result = await store.craftRecipe(req.params.playerId, req.body?.recipeId);
  res.status(result.ok ? 200 : 400).json(result);
}));

// POST /hub/:playerId/rename  { username }
// Server validates length + uniqueness. Returns { ok, username? , error? }.
router.post('/:playerId/rename', asyncRoute(async (req, res) => {
  const result = await store.renamePlayer(req.params.playerId, req.body?.username);
  res.status(result.ok ? 200 : 400).json(result);
}));

export { router as hubRouter };
