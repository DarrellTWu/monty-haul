// shared/data/classes/monk.js
// Monk base stats. Level 1: Unarmored Defense + Martial Arts (both passive).
// Ki and related active abilities start at level 2 (deferred).

import { HP_MULTIPLIER } from '../constants.js';

export const MONK = {
  id: 'monk',
  name: 'Monk',
  hitDie: 8,

  baseAbilityScores: {
    str: 10,
    dex: 16,
    con: 14,
    int: 10,
    wis: 16,
    cha: 10,
  },

  getStartingHp(conMod) {
    return Math.floor((this.hitDie + conMod) * HP_MULTIPLIER);
  },

  startingWeaponId: 'shortsword',
  startingArmorId:  '',

  // Unarmored Defense AC stat: AC = 10 + DEX mod + this stat's mod (no armor, no shield).
  unarmoredDefense: 'wis',

  saveProficiencies: ['str', 'dex'],

  levels: {
    1: { features: [], grants: { feat: 'alert' } },
    2: { features: [] },
    3: { features: [] },
  },

  gearlessLevelCap: 3,

  // Geometry: monks can scale platform perimeters without a step.
  canClimb: true,
};
