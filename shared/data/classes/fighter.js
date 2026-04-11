// shared/data/classes/fighter.js
// Fighter base stats and level table.
// These are the starting values before gear or run modifiers are applied.

import { HP_MULTIPLIER } from '../constants.js';

export const FIGHTER = {
  id: 'fighter',
  hitDie: 10,

  // Base ability scores for a default fighter (no gear, no customization yet).
  // TODO: replace with player-chosen stat array when character creation exists.
  baseAbilityScores: {
    str: 16, // +3 mod — primary attack stat
    dex: 14, // +2 mod — AC contribution with medium armor
    con: 16, // +3 mod — HP
    int: 10,
    wis: 10,
    cha: 10,
  },

  // HP at level 1: max hit die + CON modifier, then × HP_MULTIPLIER.
  // getStartingHp(conMod) = (hitDie + conMod) * HP_MULTIPLIER
  getStartingHp(conMod) {
    return Math.floor((this.hitDie + conMod) * HP_MULTIPLIER);
  },

  // AC with chain mail (no DEX bonus). TODO: derive from equipped armor.
  baseAC: 16,

  // Proficiency bonus at level 1 is computed by getProficiencyBonus(level)
  // in combat.js — not stored here.
};
