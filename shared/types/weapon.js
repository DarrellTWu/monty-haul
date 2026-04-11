// shared/types/weapon.js
// JSDoc typedef for the Weapon shape consumed by shared/logic/combat.js.
// Only fields that combat resolution actually reads are defined here.
// Additional display/UI fields will be added in the items module.

/**
 * @typedef {{ count: number, sides: number }} DiceDef
 * Describes a dice expression — e.g. 2d6 = { count: 2, sides: 6 }.
 */

/**
 * @typedef {{
 *   id: string,
 *   damageDice: DiceDef,
 *   damageBonus: number,
 *   damageType: string,
 *   enhancement: number,
 *   attackAbility: 'str' | 'dex',
 *   properties: string[]
 * }} Weapon
 *
 * @property {string}   id             — Unique weapon identifier (e.g. 'longsword')
 * @property {DiceDef}  damageDice     — Weapon damage dice (e.g. { count: 1, sides: 8 } for 1d8)
 * @property {number}   damageBonus    — Flat bonus added to damage beyond ability mod (usually 0)
 * @property {string}   damageType     — Damage type string: 'slashing', 'piercing', 'bludgeoning', etc.
 * @property {number}   enhancement    — Magic weapon bonus applied to both attack roll and damage (+1/+2/+3)
 * @property {'str'|'dex'} attackAbility — Ability score key used for attack and damage modifiers
 * @property {string[]} properties     — SRD weapon properties: 'finesse', 'thrown', 'heavy', 'light', etc.
 */

export {};
