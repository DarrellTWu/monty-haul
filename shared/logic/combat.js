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
 * With `advantage: true`, two d20s are rolled and the higher is kept. All
 * subsequent logic (natural 1 / natural 20 / hit threshold) operates on the
 * kept die. Both rolls are returned in `advantageRolls` so the caller can
 * surface them in the combat log.
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
 *   advantage?: boolean,
 *   rng?: () => number
 * }} params
 *
 * @returns {{
 *   hit: boolean, crit: boolean, damage: number, roll: number,
 *   rawD20: number, conditionBonus: number,
 *   advantageRolls?: [number, number]
 * }}
 */
export function resolveAttack({ attacker, target, weapon, conditions, advantage = false, rng = Math.random }) {
  let d20;
  let advantageRolls;
  if (advantage) {
    const a = rollDice(1, 20, rng);
    const b = rollDice(1, 20, rng);
    advantageRolls = [a, b];
    d20 = Math.max(a, b);
  } else {
    d20 = rollDice(1, 20, rng);
  }

  // Natural 1 — automatic miss. With advantage, this only fires if BOTH dice
  // rolled 1 (because we kept the higher). Same rule, applied to the kept die.
  if (d20 === 1) {
    return { hit: false, crit: false, damage: 0, roll: d20, rawD20: d20, conditionBonus: 0, advantageRolls };
  }

  const isCrit = d20 === 20;

  // ── Attack bonus ─────────────────────────────────────────────────────────
  // Players have abilityScores + level; enemies have a pre-computed attackBonus.
  let attackBonus;
  let abilityModForDamage = 0;

  if (attacker.abilityScores !== undefined && weapon !== null && weapon !== undefined) {
    // Finesse weapons (dagger, rapier, etc.) use whichever of STR/DEX gives
    // the higher modifier for both attack and damage rolls (SRD rule).
    let attackAbility = weapon.attackAbility;
    if (weapon.properties?.includes('finesse')) {
      const strMod = getModifier(attacker.abilityScores.str ?? 10);
      const dexMod = getModifier(attacker.abilityScores.dex ?? 10);
      attackAbility = strMod >= dexMod ? 'str' : 'dex';
    }
    const abilityMod = getModifier(attacker.abilityScores[attackAbility]);
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
    return { hit: false, crit: false, damage: 0, roll: totalRoll, rawD20: d20, conditionBonus, advantageRolls };
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

  return { hit: true, crit: isCrit, damage, roll: totalRoll, rawD20: d20, conditionBonus, advantageRolls };
}

// ─── Saving Throws ────────────────────────────────────────────────────────────

/**
 * Resolve a saving throw against a DC.
 *
 * @param {{
 *   creature: { abilityScores?: object, level?: number, saveProfs?: string[] },
 *   ability: 'str'|'dex'|'con'|'int'|'wis'|'cha',
 *   dc: number,
 *   rng?: () => number
 * }} params
 * @returns {{ success: boolean, roll: number, total: number }}
 */
export function resolveSave({ creature, ability, dc, rng = Math.random }) {
  const d20 = rollDice(1, 20, rng);
  const abilityMod = getModifier(creature.abilityScores?.[ability] ?? 10);
  const isProf = creature.saveProfs?.includes(ability) ?? false;
  const profBonus = isProf ? getProficiencyBonus(creature.level ?? 1) : 0;
  const total = d20 + abilityMod + profBonus;
  return { success: total >= dc, roll: d20, total };
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
 * @param {{
 *   target: { hp: number, resistances?: string[], damageReduction?: { value: number, bypass: string|null } | null },
 *   damage: number,
 *   damageType: string
 * }} params
 * @returns {{ newHP: number, overkill: number, finalDamage: number, resisted: boolean, drApplied: number }}
 *   newHP       — target's HP after damage, clamped to 0
 *   overkill    — damage beyond 0 HP
 *   finalDamage — damage after all reductions (before HP cap), used for logging
 *   resisted    — true if resistance halved the damage
 *   drApplied   — amount subtracted by Damage Reduction (0 if none or bypassed)
 */
export function applyDamage({ target, damage, damageType }) {
  const resistances = target.resistances ?? [];
  const dr          = target.damageReduction ?? null;

  let finalDamage = damage;

  // Resistance halves damage (SRD).
  const resisted = resistances.includes(damageType);
  if (resisted) {
    finalDamage = Math.floor(finalDamage / 2);
  }

  // TODO: add vulnerability (double damage) here when relevant enemies/conditions are added.

  // Damage Reduction (D&D 3.5 style): subtract DR value unless bypass type matches.
  // Example: DR 5/bludgeoning — bludgeoning bypasses, all other types reduced by 5.
  let drApplied = 0;
  if (dr && dr.value > 0 && damageType !== dr.bypass) {
    drApplied   = Math.min(finalDamage, dr.value); // don't reduce below 0 pre-minimum
    finalDamage = Math.max(0, finalDamage - dr.value);
  }

  // Minimum 1 damage on any successful hit.
  finalDamage = Math.max(1, finalDamage);

  const newHP    = Math.max(0, target.hp - finalDamage);
  const overkill = Math.max(0, finalDamage - target.hp);

  return { newHP, overkill, finalDamage, resisted, drApplied };
}
