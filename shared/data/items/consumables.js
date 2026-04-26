// shared/data/items/consumables.js
// Potion and consumable item definitions.

export const HEALING_POTION = {
  id: 'healing_potion',
  label: 'Healing Potion',
  type: 'healing',
  damageDice: { count: 2, sides: 4 },
  diceBonus: 2,                // 2d4+2 HP restored (SRD standard)
};

export const BLESS_POTION = {
  id: 'bless_potion',
  label: 'Potion of Bless',
  type: 'bless',
  conditionDurationMs: 60000,  // grants 'bless' condition for 60 seconds
};

// SRD Longstrider: +10 ft speed for 1 hour. Tuned here to 2 minutes.
export const LONGSTRIDER_POTION = {
  id: 'longstrider_potion',
  label: 'Potion of Longstrider',
  type: 'longstrider',
  conditionDurationMs: 120000,  // grants 'longstrider' condition for 2 minutes
  speedBonusFt: 10,             // displayed in log; engine uses LONGSTRIDER_SPEED_BONUS_PX
};

// SRD False Life: gain 1d4+4 temporary HP for 1 hour. Tuned here to 2 minutes.
export const FALSE_LIFE_POTION = {
  id: 'false_life_potion',
  label: 'Potion of False Life',
  type: 'false_life',
  conditionDurationMs: 120000,  // temp HP expires after 2 minutes
  damageDice: { count: 1, sides: 4 },
  diceBonus: 4,                 // 1d4+4 temp HP (SRD base level)
};

// One-shot extraction. Using it ends the run successfully — the only
// non-death exit from the dungeon. No targeting, no save, no roll.
export const EXTRACTION_SCROLL = {
  id: 'extraction_scroll',
  label: 'Scroll of Extraction',
  type: 'extract',
};

export const CONSUMABLE_REGISTRY = {
  healing_potion:    HEALING_POTION,
  bless_potion:      BLESS_POTION,
  longstrider_potion: LONGSTRIDER_POTION,
  false_life_potion:  FALSE_LIFE_POTION,
  extraction_scroll:  EXTRACTION_SCROLL,
};
