// shared/data/weapons/melee.js
// All melee weapon definitions. Each entry matches the Weapon typedef.
// Enhancement defaults to 0 — magic variants are created at the item layer.

/** @type {import('../../types/weapon.js').Weapon} */
export const LONGSWORD = {
  id: 'longsword',
  damageDice: { count: 1, sides: 8 },
  damageBonus: 0,
  damageType: 'slashing',
  enhancement: 0,
  attackAbility: 'str',
  properties: ['versatile'], // versatile: 1d10 two-handed (not implemented yet)
};

/** @type {import('../../types/weapon.js').Weapon} */
export const SHORTSWORD = {
  id: 'shortsword',
  damageDice: { count: 1, sides: 6 },
  damageBonus: 0,
  damageType: 'piercing',
  enhancement: 0,
  attackAbility: 'dex',
  properties: ['finesse', 'light'],
};

/** @type {import('../../types/weapon.js').Weapon} */
export const HANDAXE = {
  id: 'handaxe',
  damageDice: { count: 1, sides: 6 },
  damageBonus: 0,
  damageType: 'slashing',
  enhancement: 0,
  attackAbility: 'str',
  properties: ['light', 'thrown'],
};

/** @type {import('../../types/weapon.js').Weapon} */
export const GREATAXE = {
  id: 'greataxe',
  damageDice: { count: 1, sides: 12 },
  damageBonus: 0,
  damageType: 'slashing',
  enhancement: 0,
  attackAbility: 'str',
  properties: ['heavy', 'two-handed'],
};

/** @type {import('../../types/weapon.js').Weapon} */
export const DAGGER = {
  id: 'dagger',
  damageDice: { count: 1, sides: 4 },
  damageBonus: 0,
  damageType: 'piercing',
  enhancement: 0,
  attackAbility: 'str', // finesse — resolveAttack picks higher of STR/DEX automatically
  properties: ['finesse', 'light', 'thrown'],
};

/** @type {import('../../types/weapon.js').Weapon} */
export const MACE = {
  id: 'mace',
  damageDice: { count: 1, sides: 6 },
  damageBonus: 0,
  damageType: 'bludgeoning',
  enhancement: 0,
  attackAbility: 'str',
  properties: [], // simple melee — effective vs. skeletons
};

/** @type {import('../../types/weapon.js').Weapon} */
export const GREATSWORD = {
  id: 'greatsword',
  damageDice: { count: 2, sides: 6 },
  damageBonus: 0,
  damageType: 'slashing',
  enhancement: 0,
  attackAbility: 'str',
  properties: ['heavy', 'two-handed'],
};

/** @type {import('../../types/weapon.js').Weapon} */
export const UNARMED = {
  id: 'unarmed',
  damageDice: { count: 1, sides: 4 }, // TODO: derive from class/level (Monk martial arts die)
  damageBonus: 0,
  damageType: 'bludgeoning',
  enhancement: 0,
  attackAbility: 'str',
  properties: [],
};

// Canonical id → weapon-def map. Single source of truth; previously duplicated
// in DungeonRoom and CombatSystem. UNARMED is intentionally excluded — it's the
// fallback for the empty weapon slot, not an equippable item.
export const WEAPON_REGISTRY = {
  longsword:  LONGSWORD,
  shortsword: SHORTSWORD,
  handaxe:    HANDAXE,
  greataxe:   GREATAXE,
  greatsword: GREATSWORD,
  dagger:     DAGGER,
  mace:       MACE,
};
