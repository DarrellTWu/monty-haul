// shared/types/weapon.js
// JSDoc typedef for the Weapon shape consumed by shared/logic/combat.js
// and the itemization registry.

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
 *   category: 'weapon',
 *   type: 'melee' | 'ranged',
 *   label: string,
 *   damageDice: DiceDef,
 *   damageBonus: number,
 *   damageType: string,
 *   enhancement: number,
 *   attackAbility: 'str' | 'dex',
 *   properties: string[],
 *   goldValue: number,
 *   sortKey: number,
 *   note?: string,
 *   range?: RangeBand,
 *   thrown?: { range: RangeBand, ability?: 'str' | 'dex' }
 * }} Weapon
 *
 * @property {string}   id             — Unique weapon identifier (e.g. 'longsword')
 * @property {'weapon'} category       — Top-level item discriminator. Always 'weapon'.
 * @property {'melee'|'ranged'} type   — Attack-mode sub-discriminator. Required.
 * @property {string}   label          — Display name (e.g. 'Longsword'). Required.
 * @property {DiceDef}  damageDice     — Weapon damage dice (e.g. { count: 1, sides: 8 } for 1d8)
 * @property {number}   damageBonus    — Flat bonus added to damage beyond ability mod (usually 0)
 * @property {string}   damageType     — Damage type: 'slashing', 'piercing', 'bludgeoning', etc.
 * @property {number}   enhancement    — Magic weapon bonus (+1/+2/+3) applied to attack and damage
 * @property {'str'|'dex'} attackAbility — Ability score key used for attack and damage modifiers
 * @property {string[]} properties     — SRD weapon properties: 'finesse', 'thrown', 'heavy', 'light', etc.
 * @property {number}   goldValue      — SRD-derived buy price in gold pieces.
 * @property {number}   sortKey        — Integer sort key within the weapon category (lower first).
 * @property {string}   [note]         — Optional hand-tuned hint shown in the equipped-slot panel.
 * @property {RangeBand} [range]       — Required when type === 'ranged'. Pixel-space normal/long bands.
 * @property {{ range: RangeBand, ability?: 'str' | 'dex' }} [thrown]
 *   Optional. Present on melee weapons that can also be thrown (handaxe, dagger, javelin).
 *   Damage dice + damageType reuse the top-level melee values; only the range gate and
 *   (optionally) the ability override differ.
 */

export {};
