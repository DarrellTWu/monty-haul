// shared/data/weapons/melee.js
// All melee weapon definitions. Each entry matches the Weapon typedef with
// `category: 'weapon'` and `type: 'melee'`. Future thrown weapons (handaxe,
// dagger, javelin) gain an optional `thrown: { range }` sub-block but stay
// `type: 'melee'` since their primary mode is still melee.
// Enhancement defaults to 0 — magic variants are created at the item layer.

/** @type {import('../../types/weapon.js').Weapon} */
export const LONGSWORD = {
  id: 'longsword',
  category: 'weapon',
  type: 'melee',
  label: 'Longsword',
  damageDice: { count: 1, sides: 8 },
  damageBonus: 0,
  damageType: 'slashing',
  enhancement: 0,
  attackAbility: 'str',
  properties: ['versatile'], // versatile: 1d10 two-handed (not implemented yet)
  goldValue: 15,
  sortKey: 100,
  note: 'versatile (1d10)',
};

/** @type {import('../../types/weapon.js').Weapon} */
export const SHORTSWORD = {
  id: 'shortsword',
  category: 'weapon',
  type: 'melee',
  label: 'Shortsword',
  damageDice: { count: 1, sides: 6 },
  damageBonus: 0,
  damageType: 'piercing',
  enhancement: 0,
  attackAbility: 'dex',
  properties: ['finesse', 'light'],
  goldValue: 10,
  sortKey: 110,
  note: 'finesse, light',
};

/** @type {import('../../types/weapon.js').Weapon} */
export const DAGGER = {
  id: 'dagger',
  category: 'weapon',
  type: 'melee',
  label: 'Dagger',
  damageDice: { count: 1, sides: 4 },
  damageBonus: 0,
  damageType: 'piercing',
  enhancement: 0,
  attackAbility: 'str', // finesse — resolveAttack picks higher of STR/DEX automatically
  properties: ['finesse', 'light', 'thrown'],
  goldValue: 2,
  sortKey: 120,
  note: 'finesse · drag to offhand',
};

/** @type {import('../../types/weapon.js').Weapon} */
export const HANDAXE = {
  id: 'handaxe',
  category: 'weapon',
  type: 'melee',
  label: 'Handaxe',
  damageDice: { count: 1, sides: 6 },
  damageBonus: 0,
  damageType: 'slashing',
  enhancement: 0,
  attackAbility: 'str',
  properties: ['light', 'thrown'],
  goldValue: 5,
  sortKey: 130,
  note: 'light, thrown',
};

/** @type {import('../../types/weapon.js').Weapon} */
export const MACE = {
  id: 'mace',
  category: 'weapon',
  type: 'melee',
  label: 'Mace',
  damageDice: { count: 1, sides: 6 },
  damageBonus: 0,
  damageType: 'bludgeoning',
  enhancement: 0,
  attackAbility: 'str',
  properties: [],
  goldValue: 5,
  sortKey: 140,
  note: 'effective vs. skeletons',
};

/** @type {import('../../types/weapon.js').Weapon} */
export const GREATAXE = {
  id: 'greataxe',
  category: 'weapon',
  type: 'melee',
  label: 'Greataxe',
  damageDice: { count: 1, sides: 12 },
  damageBonus: 0,
  damageType: 'slashing',
  enhancement: 0,
  attackAbility: 'str',
  properties: ['heavy', 'two-handed'],
  goldValue: 30,
  sortKey: 150,
  note: 'two-handed',
};

/** @type {import('../../types/weapon.js').Weapon} */
export const GREATSWORD = {
  id: 'greatsword',
  category: 'weapon',
  type: 'melee',
  label: 'Greatsword',
  damageDice: { count: 2, sides: 6 },
  damageBonus: 0,
  damageType: 'slashing',
  enhancement: 0,
  attackAbility: 'str',
  properties: ['heavy', 'two-handed'],
  goldValue: 50,
  sortKey: 160,
  note: 'two-handed',
};

// UNARMED is intentionally NOT in WEAPON_REGISTRY (see weapons/index.js) —
// it's the fallback for an empty weapon slot, not an equippable item.
// It still carries the new fields so any code reading it directly stays well-formed.
/** @type {import('../../types/weapon.js').Weapon} */
export const UNARMED = {
  id: 'unarmed',
  category: 'weapon',
  type: 'melee',
  label: 'Unarmed',
  damageDice: { count: 1, sides: 4 }, // TODO: derive from class/level (Monk martial arts die)
  damageBonus: 0,
  damageType: 'bludgeoning',
  enhancement: 0,
  attackAbility: 'str',
  properties: [],
  goldValue: 0,
  sortKey: 0,
};
