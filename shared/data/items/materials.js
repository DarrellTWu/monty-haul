// shared/data/items/materials.js
// Crafting material definitions. Materials are bag items that drop from
// monster corpses. They cannot be equipped, consumed, or hotbar-bound —
// players can drop and move them in the inventory, and they survive runs
// like any other carried item. Crafting use is handled via RECIPE_REGISTRY.

export const SKELETON_BONE = {
  id:        'skeleton_bone',
  category:  'material',
  label:     'Skeleton Bone',
  goldValue: 2,
  sortKey:   500,
};

export const WOLF_PELT = {
  id:        'wolf_pelt',
  category:  'material',
  label:     'Wolf Pelt',
  goldValue: 4,
  sortKey:   510,
};

// Registry for lookup by id (used by client InventoryScene for rendering
// and by the recipe validator).
export const MATERIAL_REGISTRY = {
  skeleton_bone: SKELETON_BONE,
  wolf_pelt:     WOLF_PELT,
};
