// shared/logic/loot.js
// ─────────────────────────────────────────────────────────────────
// Pure loot rolling. Given a loot table and an rng, returns { gold, items }.
// No side effects. No framework deps. Math.random is never called directly —
// all randomness comes from the optional rng parameter (defaults to Math.random).
//
// Pool references in tables: an itemId of '@poolName' picks a uniformly random
// id from the pool resolver registered below. Literal ids pass through as-is.
// New pools are added to the POOLS map; loot tables stay declarative.

import { rollDice } from './combat.js';
import { CONSUMABLE_REGISTRY } from '../data/items/consumables.js';

// Pool resolvers: name (without '@') → function returning an array of item ids.
// Resolved at roll time so newly-added registry entries are picked up automatically.
const POOLS = {
  potion_any: () => Object.keys(CONSUMABLE_REGISTRY),
};

/**
 * Resolve a single drop entry's itemId. Literal ids pass through; pool
 * references ('@name') pick uniformly from the named pool. Returns null
 * if the pool is unknown or empty (caller skips the drop in that case).
 *
 * @param {string} itemId
 * @param {() => number} rng
 * @returns {string | null}
 */
function resolveItemId(itemId, rng) {
  if (typeof itemId !== 'string' || itemId.length === 0) return null;
  if (itemId[0] !== '@') return itemId;
  const poolName = itemId.slice(1);
  const ids = POOLS[poolName]?.();
  if (!ids || ids.length === 0) return null;
  return ids[Math.floor(rng() * ids.length)];
}

/**
 * Roll a loot table.
 *
 * Drop chance check uses strict `<`: rng() < chance succeeds. So chance=0
 * never drops and chance=1 always drops, regardless of rng output.
 *
 * RNG consumption (deterministic order):
 *   1. If table.gold is non-null, gold dice are rolled first (count rng calls).
 *   2. For each entry in table.drops, in order:
 *      a. One rng call for the chance check.
 *      b. If the check succeeds AND itemId is a pool ref, one more rng call
 *         to pick from the pool. Literal ids consume no extra rng.
 *      c. The resolved id is pushed entry.qty times (no further rng).
 *
 * @param {{
 *   gold: { dice: { count: number, sides: number }, bonus?: number } | null,
 *   drops?: Array<{ itemId: string, chance: number, qty?: number }>,
 * } | null | undefined} table
 * @param {() => number} [rng=Math.random]
 * @returns {{ gold: number, items: string[] }}
 */
export function rollLoot(table, rng = Math.random) {
  if (!table) return { gold: 0, items: [] };

  let gold = 0;
  if (table.gold) {
    const { dice, bonus = 0 } = table.gold;
    gold = rollDice(dice.count, dice.sides, rng) + bonus;
  }

  const items = [];
  for (const entry of table.drops ?? []) {
    if (rng() >= entry.chance) continue;
    const id = resolveItemId(entry.itemId, rng);
    if (!id) continue;
    const qty = entry.qty ?? 1;
    for (let i = 0; i < qty; i++) items.push(id);
  }

  return { gold, items };
}
