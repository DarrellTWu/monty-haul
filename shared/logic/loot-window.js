// shared/logic/loot-window.js
// Pure logic for the loot-window protocol: container lock acquire/release and
// the take/drop/gold flow. Imported by server (DungeonRoom.js) for authoritative
// resolution and by tests for direct exercise. The client will reuse the access
// predicate to gray out actions the player isn't allowed to take.
//
// All functions are pure data mutations on a state-shaped object. Required shape:
//   state.chests     — Map-like of ChestState by id (.get, iteration)
//   state.enemies    — Map-like of EnemyState by id (.get, iteration)
//   state.players    — Map-like of PlayerState by sessionId (.get)
// Source schemas need: x, y, lockedBy, alive (corpse), items|lootItems (Array-like),
// open (chest), looted/lootGold (corpse). Player schemas need: x, y, alive,
// inventory (Array-like), hotbar (Array-like), gold.
//
// No imports from server/ or client/. Range is passed in by the caller so this
// module stays free of constants.js side effects (callers import the constant).

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Resolve a loot source by kind+id. Returns the schema instance or null. */
export function getLootSource(state, kind, id) {
  if (kind === 'chest')  return state.chests.get(String(id))  ?? null;
  if (kind === 'corpse') return state.enemies.get(String(id)) ?? null;
  return null;
}

/**
 * Common gate for all flow operations. Returns { player, source } when
 * `sessionId` is allowed to operate on the container, else null.
 *
 * Conditions: player exists + alive, source exists, corpse-is-dead (if corpse),
 * lock held by sessionId, player within rangePx.
 */
export function checkLootAccess(state, sessionId, sourceKind, sourceId, rangePx) {
  const player = state.players.get(sessionId);
  const source = getLootSource(state, sourceKind, sourceId);
  if (!player || !player.alive || !source) return null;
  if (sourceKind === 'corpse' && source.alive) return null;
  if (source.lockedBy !== sessionId) return null;
  if (distance(player, source) > rangePx) return null;
  return { player, source };
}

/**
 * Attempt to claim the lock on a container.
 * Returns { ok: true, source } on success (mutates source.lockedBy).
 * Returns { ok: false, reason, holder? } on failure where reason is one of:
 *   'dead' | 'no-source' | 'alive' | 'range' | 'denied'
 */
export function tryOpenContainer(state, sessionId, sourceKind, sourceId, rangePx) {
  const player = state.players.get(sessionId);
  if (!player || !player.alive) return { ok: false, reason: 'dead' };
  const source = getLootSource(state, sourceKind, sourceId);
  if (!source) return { ok: false, reason: 'no-source' };
  if (sourceKind === 'corpse' && source.alive) return { ok: false, reason: 'alive' };
  if (distance(player, source) > rangePx) return { ok: false, reason: 'range' };
  if (source.lockedBy && source.lockedBy !== sessionId) {
    return { ok: false, reason: 'denied', holder: source.lockedBy };
  }
  source.lockedBy = sessionId;
  return { ok: true, source };
}

/**
 * Release the lock if `sessionId` owns it. Returns true on release, false otherwise.
 * No range or alive checks — closing always succeeds for the lock owner.
 */
export function tryCloseContainer(state, sessionId, sourceKind, sourceId) {
  const source = getLootSource(state, sourceKind, sourceId);
  if (!source) return false;
  if (source.lockedBy !== sessionId) return false;
  source.lockedBy = '';
  return true;
}

/** Release every lock held by `sessionId`. Used on disconnect. */
export function releaseLocksHeldBy(state, sessionId) {
  for (const [, c] of state.chests)  if (c.lockedBy === sessionId) c.lockedBy = '';
  for (const [, e] of state.enemies) if (e.lockedBy === sessionId) e.lockedBy = '';
}

/**
 * Per-tick lock janitor. Releases locks held by a player who is gone, dead,
 * or has walked out of range. Lets clients close their windows passively
 * without an explicit message round-trip.
 */
export function tickContainerLocks(state, rangePx) {
  const release = (source) => {
    const sid = source.lockedBy;
    if (!sid) return;
    const player = state.players.get(sid);
    if (!player || !player.alive) { source.lockedBy = ''; return; }
    if (distance(player, source) > rangePx) source.lockedBy = '';
  };
  for (const [, c] of state.chests)  release(c);
  for (const [, e] of state.enemies) release(e);
}

/**
 * Recompute the visual "is empty" flag on a loot source. Chests use `open`;
 * corpses use `looted`. With bidirectional flow these flip both ways — they
 * track current emptiness, not a one-way "has been raided" stamp.
 */
export function refreshSourceFlags(kind, source) {
  if (kind === 'chest')  source.open   = source.items.length === 0;
  if (kind === 'corpse') source.looted = source.lootGold === 0 && source.lootItems.length === 0;
}

/**
 * Take the item at `itemIndex` from a locked container into the player's
 * inventory. Returns true on success, false on any gate or index failure.
 */
export function tryTakeItem(state, sessionId, sourceKind, sourceId, itemIndex, rangePx) {
  const ctx = checkLootAccess(state, sessionId, sourceKind, sourceId, rangePx);
  if (!ctx) return false;
  const items = sourceKind === 'corpse' ? ctx.source.lootItems : ctx.source.items;
  const idx = Math.floor(Number(itemIndex));
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) return false;
  const itemId = items[idx];
  items.splice(idx, 1);
  ctx.player.inventory.push(itemId);
  refreshSourceFlags(sourceKind, ctx.source);
  return true;
}

/** Take all gold from a locked corpse. Returns true on success. */
export function tryTakeGold(state, sessionId, sourceId, rangePx) {
  const ctx = checkLootAccess(state, sessionId, 'corpse', sourceId, rangePx);
  if (!ctx) return false;
  if (ctx.source.lootGold <= 0) return false;
  ctx.player.gold += ctx.source.lootGold;
  ctx.source.lootGold = 0;
  refreshSourceFlags('corpse', ctx.source);
  return true;
}

/**
 * Drop the item at `inventoryIndex` from the player's inventory into a locked
 * container. On success also clears stale hotbar bindings — but only when the
 * player no longer holds any copy of the dropped id (so partial drops keep
 * the binding live).
 */
export function tryDropItem(state, sessionId, sourceKind, sourceId, inventoryIndex, rangePx) {
  const ctx = checkLootAccess(state, sessionId, sourceKind, sourceId, rangePx);
  if (!ctx) return false;
  const idx = Math.floor(Number(inventoryIndex));
  if (!Number.isInteger(idx) || idx < 0 || idx >= ctx.player.inventory.length) return false;
  const itemId = ctx.player.inventory[idx];
  ctx.player.inventory.splice(idx, 1);
  const items = sourceKind === 'corpse' ? ctx.source.lootItems : ctx.source.items;
  items.push(itemId);
  if (!ctx.player.inventory.includes(itemId)) {
    for (let i = 0; i < ctx.player.hotbar.length; i++) {
      if (ctx.player.hotbar[i] === itemId) ctx.player.hotbar[i] = '';
    }
  }
  refreshSourceFlags(sourceKind, ctx.source);
  return true;
}
