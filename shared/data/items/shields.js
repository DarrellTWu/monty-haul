// shared/data/items/shields.js
// Shield definitions. Shields are off-hand items that add a flat AC bonus
// and prevent equipping two-handed weapons (SRD rule).

export const SHIELD = {
  id: 'shield',
  category: 'shield',
  label: 'Shield',
  acBonus: 2,          // Always +2 AC regardless of armor type (SRD)
  strRequirement: 0,
  goldValue: 10,
  sortKey: 300,
};

// Registry for lookup by id (used by server equip handler and InventoryScene).
export const SHIELD_REGISTRY = {
  shield: SHIELD,
};
