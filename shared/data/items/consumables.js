// shared/data/items/consumables.js
// Potion and consumable item definitions.

export const HEALING_POTION = {
  id: 'healing_potion',
  label: 'Healing Potion',
  type: 'healing',
  damageDice: { count: 2, sides: 4 },
  diceBonus: 2,           // 2d4+2 HP restored (SRD standard)
};

export const BLESS_POTION = {
  id: 'bless_potion',
  label: 'Potion of Bless',
  type: 'bless',
  conditionDurationMs: 60000,  // grants 'bless' condition for 60 seconds
};

export const CONSUMABLE_REGISTRY = {
  healing_potion: HEALING_POTION,
  bless_potion:   BLESS_POTION,
};
