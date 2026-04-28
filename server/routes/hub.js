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

// POST /hub/login  { username }
// Upsert player by username. Returns full hub state.
router.post('/login', (req, res) => {
  const username = req.body?.username?.trim();
  if (!username) return res.status(400).json({ ok: false, error: 'username required' });
  const p = store.getOrCreate(username);
  res.json({ ok: true, playerId: p.playerId, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack });
});

// GET /hub/:playerId
// Load current hub state for an existing player.
router.get('/:playerId', (req, res) => {
  const p = store.getPlayer(req.params.playerId);
  if (!p) return res.status(404).json({ ok: false, error: 'Player not found' });
  res.json({ ok: true, stash: p.stash, gold: p.gold, raiderPack: p.raiderPack });
});

// POST /hub/:playerId/raider/add  { itemId }
router.post('/:playerId/raider/add', (req, res) => {
  const result = store.stashToRaider(req.params.playerId, req.body?.itemId);
  res.status(result.ok ? 200 : 400).json(result);
});

// POST /hub/:playerId/raider/remove  { itemId }
router.post('/:playerId/raider/remove', (req, res) => {
  const result = store.raiderToStash(req.params.playerId, req.body?.itemId);
  res.status(result.ok ? 200 : 400).json(result);
});

// POST /hub/:playerId/raider/dump
router.post('/:playerId/raider/dump', (req, res) => {
  const result = store.dumpToStash(req.params.playerId);
  res.status(result.ok ? 200 : 400).json(result);
});

// POST /hub/:playerId/buy  { itemId, price }
router.post('/:playerId/buy', (req, res) => {
  const { itemId, price } = req.body ?? {};
  const result = store.buyItem(req.params.playerId, itemId, Number(price));
  res.status(result.ok ? 200 : 400).json(result);
});

// POST /hub/:playerId/sell  { itemId, price }
router.post('/:playerId/sell', (req, res) => {
  const { itemId, price } = req.body ?? {};
  const result = store.sellItem(req.params.playerId, itemId, Number(price));
  res.status(result.ok ? 200 : 400).json(result);
});

// POST /hub/:playerId/craft  { recipe }
router.post('/:playerId/craft', (req, res) => {
  const result = store.craftRecipe(req.params.playerId, req.body?.recipe);
  res.status(result.ok ? 200 : 400).json(result);
});

export { router as hubRouter };
