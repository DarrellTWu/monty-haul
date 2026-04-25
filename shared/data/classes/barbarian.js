// shared/data/classes/barbarian.js
// Barbarian base stats. Stub — abilities (Rage, Unarmored Defense, etc.) not yet implemented.

import { HP_MULTIPLIER } from '../constants.js';

export const BARBARIAN = {
  id: 'barbarian',
  hitDie: 10,

  baseAbilityScores: {
    str: 16,
    dex: 14,
    con: 16,
    int: 10,
    wis: 10,
    cha: 10,
  },

  getStartingHp(conMod) {
    return Math.floor((this.hitDie + conMod) * HP_MULTIPLIER);
  },

  startingWeaponId: 'greatsword',
  startingArmorId: 'chain_mail',

  saveProficiencies: ['str', 'con'],

  fightingStyle: 'dueling',

  classFeatures: ['rage'],
  rageUses: 2, // activations per run; restored on long rest

  feat: 'alert',
};
