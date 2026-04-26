// shared/data/items/materials.js
// Crafting material definitions. Materials are bag items that drop from
// monster corpses. They cannot be equipped, consumed, or hotbar-bound —
// players can drop and move them in the inventory, and they survive runs
// like any other carried item. Crafting use is a separate design pass.

export const SKELETON_BONE = {
  id:    'skeleton_bone',
  label: 'Skeleton Bone',
  type:  'material',
};

export const WOLF_PELT = {
  id:    'wolf_pelt',
  label: 'Wolf Pelt',
  type:  'material',
};

// Registry for lookup by id (used by client InventoryScene for rendering
// and by server validation when materials become craftable).
export const MATERIAL_REGISTRY = {
  skeleton_bone: SKELETON_BONE,
  wolf_pelt:     WOLF_PELT,
};
