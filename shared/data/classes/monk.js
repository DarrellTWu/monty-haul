// shared/data/classes/monk.js
// Monk base stats. Level 1: Unarmored Defense + Martial Arts (both passive).
// Ki and related active abilities (Flurry of Blows, etc.) start at level 2.

import { HP_MULTIPLIER } from '../constants.js';

export const MONK = {
  id: 'monk',
  hitDie: 8,

  baseAbilityScores: {
    str: 10,
    dex: 16, // +3 mod — primary attack stat (Martial Arts)
    con: 14, // +2 mod
    int: 10,
    wis: 16, // +3 mod — AC via Unarmored Defense
    cha: 10,
  },

  getStartingHp(conMod) {
    return Math.floor((this.hitDie + conMod) * HP_MULTIPLIER);
  },

  startingWeaponId: 'shortsword',
  startingArmorId:  '',           // monks start unarmored; AC from Unarmored Defense

  // Unarmored Defense: AC = 10 + DEX mod + [this stat] mod, when no armor and no shield.
  unarmoredDefense: 'wis',

  saveProficiencies: ['str', 'dex'],

  fightingStyle: null,  // monks don't get a fighting style

  classFeatures: [],    // no hotbar abilities at level 1; Ki starts at level 2

  feat: 'alert',

  // Geometry: monks can scale platform perimeters without using a step.
  // Stub for the future climbing-skill system; see docs/agent-context/geometry-elevation.md.
  canClimb: true,
};
