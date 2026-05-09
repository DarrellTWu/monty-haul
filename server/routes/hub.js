import { createRequire } from 'module';
const express = createRequire(import.meta.url)('express');

import * as store from '../store/playerStore.js';

const router = express.Router();

// Allow requests from the Vite dev client (localhost:5173).
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

// POST /hub/login  { username }
// Upsert player by username. Returns full hub state.
router.post('/login', asyncRoute(async (req, res) => {
  const username = req.body?.username?.trim();
  if (!username) return res.status(400).json({ ok: false, error: 'username required' });
  const p = await store.getOrCreate(username);
  res.json({ ok: true, playerId: p.playerId, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack });
}));

// GET /hub/:playerId
// Load current hub state for an existing player.
router.get('/:playerId', asyncRoute(async (req, res) => {
  const p = await store.getPlayer(req.params.playerId);
  if (!p) return res.status(404).json({ ok: false, error: 'Player not found' });
  res.json({ ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack });
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

export { router as hubRouter };
