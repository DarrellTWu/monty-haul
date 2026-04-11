// shared/types/player.js
// JSDoc typedef for the Player shape consumed by shared/logic/combat.js.
// Only fields that combat resolution actually reads are defined here.
// Full player state (Colyseus @Schema) lives in server/state/PlayerState.js.

/**
 * @typedef {{
 *   str: number,
 *   dex: number,
 *   con: number,
 *   int: number,
 *   wis: number,
 *   cha: number
 * }} AbilityScores
 */

/**
 * @typedef {{
 *   id: string,
 *   hp: number,
 *   maxHp: number,
 *   ac: number,
 *   abilityScores: AbilityScores,
 *   level: number,
 *   conditions: string[],
 *   weaponSlot: import('./weapon.js').Weapon | null
 * }} Player
 *
 * @property {string}        id             — Unique player/session identifier
 * @property {number}        hp             — Current hit points
 * @property {number}        maxHp          — Maximum hit points (base × HP_MULTIPLIER)
 * @property {number}        ac             — Armor class (base + armor + DEX mod, capped by armor type)
 * @property {AbilityScores} abilityScores  — The six standard D&D ability scores (before modifiers)
 * @property {number}        level          — Current character level (1–20); drives proficiency bonus
 * @property {string[]}      conditions     — Active condition strings: 'bless', 'poisoned', 'stunned', etc.
 * @property {import('./weapon.js').Weapon | null} weaponSlot — Equipped weapon, or null for unarmed
 */

export {};
