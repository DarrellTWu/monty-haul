// shared/data/values.js
// ITEM_GOLD_VALUE is now a derived view over ITEM_REGISTRY. Every item def
// carries its own goldValue field (see shared/data/items/* and the weapon /
// armor files). This module preserves the historical `ITEM_GOLD_VALUE` and
// `sellPrice` exports so call sites (shop.js, stash sell flow) don't change.

import { ITEM_REGISTRY } from './items/index.js';

export const ITEM_GOLD_VALUE = Object.freeze(
  Object.fromEntries(
    Object.entries(ITEM_REGISTRY).map(([id, def]) => [id, def.goldValue ?? 0]),
  ),
);

export const SELL_RATIO = 0.25;

/**
 * Sale price for `id` at the hub vendor. Returns 0 if the item has no
 * defined value. Floor of (value × ratio), but never less than 1 gp for
 * items that have a value — at quarter price, 2 gp items would otherwise
 * round to 0 and be unsellable.
 */
export function sellPrice(id) {
  const v = ITEM_GOLD_VALUE[id];
  if (!v) return 0;
  return Math.max(1, Math.floor(v * SELL_RATIO));
}
