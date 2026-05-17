// shared/types/weapon.js
// JSDoc typedef for the Weapon shape consumed by shared/logic/combat.js.
// Only fields that combat resolution actually reads are defined here.
// Additional display/UI fields will be added in the items module.

/**
 * @typedef {{ count: number, sides: number }} DiceDef
 * Describes a dice expression — e.g. 2d6 = { count: 2, sides: 6 }.
 */

/**
 * @typedef {{ normal: number, long: number }} RangeBand
 * Pixel ranges for a ranged or thrown attack. Beyond `normal` and within `long`
 * imposes the SRD long-range disadvantage; beyond `long` is out of range.
 */

/**
 * @typedef {{
 *   id: string,
 *   kind: 'melee' | 'ranged',
 *   damageDice: DiceDef,
 *   damageBonus: number,
 *   damageType: string,
 *   enhancement: number,
 *   attackAbility: 'str' | 'dex',
 *   properties: string[],
 *   range?: RangeBand,
 *   thrown?: { range: RangeBand, ability?: 'str' | 'dex' }
 * }} Weapon
 *
 * @property {string}   id             — Unique weapon identifier (e.g. 'longsword')
 * @property {'melee'|'ranged'} kind   — Canonical attack-mode discriminator. Required.
 * @property {DiceDef}  damageDice     — Weapon damage dice (e.g. { count: 1, sides: 8 } for 1d8)
 * @property {number}   damageBonus    — Flat bonus added to damage beyond ability mod (usually 0)
 * @property {string}   damageType     — Damage type string: 'slashing', 'piercing', 'bludgeoning', etc.
 * @property {number}   enhancement    — Magic weapon bonus applied to both attack roll and damage (+1/+2/+3)
 * @property {'str'|'dex'} attackAbility — Ability score key used for attack and damage modifiers
 * @property {string[]} properties     — SRD weapon properties: 'finesse', 'thrown', 'heavy', 'light', etc.
 * @property {RangeBand} [range]       — Required when kind === 'ranged'. Pixel-space normal/long bands.
 * @property {{ range: RangeBand, ability?: 'str' | 'dex' }} [thrown]
 *   Optional. Present on melee weapons that can also be thrown (handaxe, dagger, javelin).
 *   Damage dice + damageType reuse the top-level melee values; only the range gate and
 *   (optionally) the ability override differ.
 */

export {};
