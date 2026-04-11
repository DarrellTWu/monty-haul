// shared/logic/combat.js
// ─────────────────────────────────────────────────────────────────
// Pure attack resolution functions for D&D 5e SRD-style combat adapted for
// real-time play. No side effects. No framework dependencies. No Math.random —
// all randomness comes from an injected rng parameter (a function returning
// a float in [0, 1)) that defaults to Math.random when omitted.
//
// MULTI-ATTACK CONVENTION:
//   resolveAttack handles a single attack only and never returns an array.
//   Multi-attack (Extra Attack, Flurry of Blows, Reckless Attack) is the
//   caller's responsibility: CombatSystem.js calls resolveAttack N times per
//   action, where N comes from the character's class feature data
//   (e.g. shared/data/classes/fighter.js attacksPerAction at level 5).
//
// ENEMY ATTACKS:
//   Enemies carry a pre-computed attackBonus rather than abilityScores.
//   For enemy attacks, the CombatSystem.js caller should construct a
//   weapon-shaped object from the enemy's damageDice/damageBonus/damageType
//   and pass the enemy as attacker. resolveAttack detects the absence of
//   abilityScores and falls back to attacker.attackBonus automatically.

import { CRIT_MULTIPLIER } from '../data/constants.js';

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Roll count dice of the given number of sides using the provided rng.
 * Exposed for callers that need raw rolls outside of attack resolution.
 *
 * @param {number} count - Number of dice to roll
 * @param {number} sides - Number of sides on each die
 * @param {() => number} [rng=Math.random] - RNG function returning [0, 1)
 * @returns {number} Sum of all dice results
 */
export function rollDice(count, sides, rng = Math.random) {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(rng() * sides) + 1;
  }
  return total;
}

/**
 * Standard SRD ability modifier formula.
 * @param {number} abilityScore - The raw ability score (1–30)
 * @returns {number} The modifier (e.g. 16 → +3, 8 → -1)
 */
export function getModifier(abilityScore) {
  return Math.floor((abilityScore - 10) / 2);
}

/**
 * Standard SRD proficiency bonus by character level.
 * @param {number} level - Character level (1–20)
 * @returns {number} Proficiency bonus (+2 at level 1, +6 at level 17+)
 */
export function getProficiencyBonus(level) {
  return Math.floor((level - 1) / 4) + 2;
}

// ─── Attack Resolution ────────────────────────────────────────────────────────

/**
 * Resolve a single attack roll against a target.
 *
 * Natural 1  → automatic miss regardless of modifiers.
 * Natural 20 → automatic hit and critical hit.
 * Otherwise  → compare (d20 + attack bonus + condition modifiers) against target.ac.
 *
 * On a hit, weapon damage dice are rolled and flat bonuses added.
 * On a crit, the weapon dice are rolled CRIT_MULTIPLIER times total (e.g. 2× = double dice).
 * Damage bonuses (ability mod, enhancement, damageBonus) are added once regardless of crit.
 * The returned damage value is pre-resistance; pass it to applyDamage for final resolution.
 *
 * @param {{
 *   attacker: import('../types/player.js').Player | import('../types/enemy.js').Enemy,
 *   target: import('../types/player.js').Player | import('../types/enemy.js').Enemy,
 *   weapon: import('../types/weapon.js').Weapon | null,
 *   conditions?: string[],
 *   rng?: () => number
 * }} params
 *
 * @returns {{ hit: boolean, crit: boolean, damage: number, roll: number }}
 *   hit    — whether the attack connected
 *   crit   — whether it was a natural 20 (only meaningful when hit is true)
 *   damage — raw damage before resistance (0 on a miss)
 *   roll   — total attack roll (d20 + all bonuses); equals raw d20 on a natural 1
 */
export function resolveAttack({ attacker, target, weapon, conditions, rng = Math.random }) {
  const d20 = rollDice(1, 20, rng);

  // Natural 1 — automatic miss. Return immediately; don't consume rng for bonuses.
  if (d20 === 1) {
    return { hit: false, crit: false, damage: 0, roll: d20 };
  }

  const isCrit = d20 === 20;

  // ── Attack bonus ─────────────────────────────────────────────────────────
  // Players have abilityScores + level; enemies have a pre-computed attackBonus.
  let attackBonus;
  let abilityModForDamage = 0;

  if (attacker.abilityScores !== undefined && weapon !== null && weapon !== undefined) {
    const abilityMod = getModifier(attacker.abilityScores[weapon.attackAbility]);
    abilityModForDamage = abilityMod;
    attackBonus = abilityMod + getProficiencyBonus(attacker.level) + (weapon.enhancement ?? 0);
  } else {
    // Enemy, or attacker without abilityScores — use flat attackBonus.
    attackBonus = attacker.attackBonus ?? 0;
  }

  // ── Condition modifiers ───────────────────────────────────────────────────
  // `conditions` parameter is the canonical source for this resolution;
  // falls back to attacker.conditions if not supplied.
  const activeConditions = conditions ?? attacker.conditions ?? [];
  let conditionBonus = 0;

  if (activeConditions.includes('bless')) {
    // Bless (SRD): add 1d4 to the attack roll.
    conditionBonus += rollDice(1, 4, rng);
  }

  // TODO: add further condition bonuses here (e.g. Guidance, Bardic Inspiration)
  //       as they are designed and added to the conditions system.

  const totalRoll = d20 + attackBonus + conditionBonus;
  const hit = isCrit || totalRoll >= target.ac;

  if (!hit) {
    return { hit: false, crit: false, damage: 0, roll: totalRoll };
  }

  // ── Damage ────────────────────────────────────────────────────────────────
  // On a crit, total damage (dice + all flat bonuses) is multiplied by CRIT_MULTIPLIER.
  // This means modifiers are included in the doubled value, not added on top afterwards.
  const dice = weapon !== null && weapon !== undefined ? weapon.damageDice : attacker.damageDice;
  const diceDamage = rollDice(dice.count, dice.sides, rng);

  let flatBonus;
  if (attacker.abilityScores !== undefined && weapon !== null && weapon !== undefined) {
    flatBonus = abilityModForDamage + (weapon.damageBonus ?? 0) + (weapon.enhancement ?? 0);
  } else {
    // Enemy: damageBonus is the complete flat bonus; no separate ability mod.
    const src = weapon ?? attacker;
    flatBonus = src.damageBonus ?? 0;
  }

  // Note: minimum-1 damage is enforced in applyDamage, not here, so the caller
  // receives the raw value and can distinguish "low roll" from "resisted to 0".
  const damage = (diceDamage + flatBonus) * (isCrit ? CRIT_MULTIPLIER : 1);

  return { hit: true, crit: isCrit, damage, roll: totalRoll };
}

// ─── Damage Application ───────────────────────────────────────────────────────

/**
 * Apply damage to a target, accounting for resistance and minimum-damage rules.
 *
 * Resistance halves damage (floor), with a minimum of 1 on any successful hit.
 * Vulnerability (double damage) is a TODO — not in scope for Wave 1 enemies.
 *
 * @param {{
 *   target: import('../types/player.js').Player | import('../types/enemy.js').Enemy,
 *   damage: number,
 *   damageType: string
 * }} params
 *
 * @returns {{ newHP: number, overkill: number }}
 *   newHP   — target's HP after damage, clamped to 0
 *   overkill — damage beyond 0 HP (useful for death-save threshold calculations)
 */
export function applyDamage({ target, damage, damageType }) {
  const resistances = target.resistances ?? [];

  let finalDamage = damage;

  if (resistances.includes(damageType)) {
    finalDamage = Math.floor(finalDamage / 2);
  }

  // TODO: add vulnerability (double damage) here when relevant enemies/conditions are added.

  // Minimum 1 damage on any successful hit.
  finalDamage = Math.max(1, finalDamage);

  const newHP = Math.max(0, target.hp - finalDamage);
  const overkill = Math.max(0, finalDamage - target.hp);

  return { newHP, overkill };
}
