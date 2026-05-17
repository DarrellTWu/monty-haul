// shared/data/weapons/melee.js
// All melee weapon definitions. Each entry matches the Weapon typedef.
// Every entry carries `kind: 'melee'` — the canonical attack-mode discriminator.
// Future thrown weapons (handaxe, dagger, javelin) gain an optional `thrown: { range }`
// sub-block but stay `kind: 'melee'` since their primary mode is still melee.
// Enhancement defaults to 0 — magic variants are created at the item layer.

/** @type {import('../../types/weapon.js').Weapon} */
export const LONGSWORD = {
  id: 'longsword',
  kind: 'melee',
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
  kind: 'melee',
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
  kind: 'melee',
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
  kind: 'melee',
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
  kind: 'melee',
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
  kind: 'melee',
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
  kind: 'melee',
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
  kind: 'melee',
  damageDice: { count: 1, sides: 4 }, // TODO: derive from class/level (Monk martial arts die)
  damageBonus: 0,
  damageType: 'bludgeoning',
  enhancement: 0,
  attackAbility: 'str',
  properties: [],
};

// Per-weapon exports above are consumed by the unified registry in
// shared/data/weapons/index.js. UNARMED is intentionally not in the registry —
// it's the fallback for the empty weapon slot, not an equippable item.
