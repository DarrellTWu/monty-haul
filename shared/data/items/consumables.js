// shared/data/items/consumables.js
// Potion and consumable item definitions.
//
// All entries carry `category: 'consumable'` and a `type` sub-discriminator
// the display formatter (shared/logic/item-display.js) and server consume
// handler both switch on. `hotbarShort` is the 7-character label that fits
// inside a hotbar slot — only used by client rendering.

export const HEALING_POTION = {
  id: 'healing_potion',
  category: 'consumable',
  type: 'healing',
  label: 'Healing Potion',
  damageDice: { count: 2, sides: 4 },
  diceBonus: 2,                // 2d4+2 HP restored (SRD standard)
  goldValue: 50,
  sortKey: 400,
  hotbarShort: 'Heal Pot',
};

export const BLESS_POTION = {
  id: 'bless_potion',
  category: 'consumable',
  type: 'bless',
  label: 'Potion of Bless',
  conditionDurationMs: 60000,  // grants 'bless' condition for 60 seconds
  goldValue: 250,
  sortKey: 410,
  hotbarShort: 'Bless',
};

// SRD Longstrider: +10 ft speed for 1 hour. Tuned here to 2 minutes.
export const LONGSTRIDER_POTION = {
  id: 'longstrider_potion',
  category: 'consumable',
  type: 'longstrider',
  label: 'Potion of Longstrider',
  conditionDurationMs: 120000,  // grants 'longstrider' condition for 2 minutes
  speedBonusFt: 10,             // displayed in log; engine uses LONGSTRIDER_SPEED_BONUS_PX
  goldValue: 75,
  sortKey: 420,
  hotbarShort: 'Stride',
};

// SRD False Life: gain 1d4+4 temporary HP for 1 hour. Tuned here to 2 minutes.
export const FALSE_LIFE_POTION = {
  id: 'false_life_potion',
  category: 'consumable',
  type: 'false_life',
  label: 'Potion of False Life',
  conditionDurationMs: 120000,  // temp HP expires after 2 minutes
  damageDice: { count: 1, sides: 4 },
  diceBonus: 4,                 // 1d4+4 temp HP (SRD base level)
  goldValue: 100,
  sortKey: 430,
  hotbarShort: 'F.Life',
};

// One-shot extraction. Using it ends the run successfully — the only
// non-death exit from the dungeon. No targeting, no save, no roll.
export const EXTRACTION_SCROLL = {
  id: 'extraction_scroll',
  category: 'consumable',
  type: 'extract',
  label: 'Scroll of Extraction',
  goldValue: 100,
  sortKey: 440,
  hotbarShort: 'Extract',
};

export const CONSUMABLE_REGISTRY = {
  healing_potion:     HEALING_POTION,
  bless_potion:       BLESS_POTION,
  longstrider_potion: LONGSTRIDER_POTION,
  false_life_potion:  FALSE_LIFE_POTION,
  extraction_scroll:  EXTRACTION_SCROLL,
};
