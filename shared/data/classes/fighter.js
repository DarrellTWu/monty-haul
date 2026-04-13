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

  // Starting armor. Chain Mail is heavy (baseAC 16, no DEX bonus, STR 13 req).
  // AC is computed via computeAC() in shared/data/armor/armor.js — not stored here.
  startingArmorId: 'chain_mail',

  // Saving throw proficiencies (SRD Fighter: STR and CON).
  saveProficiencies: ['str', 'con'],

  // Fighting style chosen at level 1.
  // Dueling: +2 damage when wielding a melee weapon in one hand with no weapon in offhand
  // (a shield in offhand is permitted — SRD rule).
  fightingStyle: 'dueling',

  // Level 1 class features.
  classFeatures: ['second_wind'],

  // Human variant feat.
  feat: 'alert', // +5 to initiative, can't be surprised

  // Proficiency bonus at level 1 is computed by getProficiencyBonus(level)
  // in combat.js — not stored here.
};
