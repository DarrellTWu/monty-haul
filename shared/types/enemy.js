// shared/types/enemy.js
// JSDoc typedef for the Enemy shape consumed by shared/logic/combat.js.
// Only fields that combat resolution actually reads are defined here.
// Full enemy state (Colyseus @Schema) lives in server/state/EnemyState.js.

/**
 * @typedef {{
 *   id: string,
 *   hp: number,
 *   maxHp: number,
 *   ac: number,
 *   attackBonus: number,
 *   damageDice: import('./weapon.js').DiceDef,
 *   damageBonus: number,
 *   damageType: string,
 *   resistances: string[]
 * }} Enemy
 *
 * @property {string}   id           — Unique enemy instance identifier
 * @property {number}   hp           — Current hit points
 * @property {number}   maxHp        — Maximum hit points
 * @property {number}   ac           — Armor class
 * @property {number}   attackBonus  — Pre-computed flat attack bonus (replaces per-stat calculation for enemies)
 * @property {import('./weapon.js').DiceDef} damageDice  — Damage dice for this enemy's attack
 * @property {number}   damageBonus  — Flat bonus added to damage rolls
 * @property {string}   damageType   — Damage type: 'slashing', 'piercing', 'bludgeoning', etc.
 * @property {string[]} resistances  — Damage types this enemy resists (damage halved, min 1)
 */

export {};
