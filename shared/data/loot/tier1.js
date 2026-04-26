// shared/data/loot/tier1.js
// Loot tables for tier 1 enemies (floors 1-3). Pure data — roll logic
// lives in shared/logic/loot.js.
//
// Schema per table:
//   gold:  { dice: { count, sides }, bonus } | null
//   drops: [{ itemId, chance, qty }, ...]
//
// itemId conventions:
//   'foo_bar'      → literal item id, looked up directly
//   '@pool_name'   → pool reference, resolved at roll time by loot.js
//                    (e.g. '@potion_any' picks any id in CONSUMABLE_REGISTRY)
//
// chance is 0..1; rolled independently per drop entry.

export const GOBLIN_LOOT = {
  gold: { dice: { count: 2, sides: 6 }, bonus: 0 },   // 2d6 gp
  drops: [
    { itemId: '@potion_any', chance: 0.25, qty: 1 },  // 25% chance of any defined potion
  ],
};

export const SKELETON_LOOT = {
  gold: { dice: { count: 1, sides: 4 }, bonus: 0 },   // 1d4 gp
  drops: [
    { itemId: 'skeleton_bone', chance: 0.75, qty: 1 },
  ],
};

export const DOG_LOOT = {
  gold: null,                                          // beasts carry no coin
  drops: [
    { itemId: 'wolf_pelt', chance: 0.75, qty: 1 },
  ],
};

// Registry keyed by enemy id. Server looks up via LOOT_TABLE_REGISTRY[enemy.type]
// at the moment of death. Enemies with no entry drop nothing.
export const LOOT_TABLE_REGISTRY = {
  goblin:   GOBLIN_LOOT,
  skeleton: SKELETON_LOOT,
  dog:      DOG_LOOT,
};
