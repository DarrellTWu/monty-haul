// shared/data/classes/barbarian.js
// Barbarian base stats and level table.

import { HP_MULTIPLIER } from '../constants.js';

export const BARBARIAN = {
  id: 'barbarian',
  name: 'Barbarian',
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

  levels: {
    1: { features: ['rage'], grants: { feat: 'alert' } },
    2: { features: [] },
    3: { features: [] },
  },

  // Per-class resource pool; not a per-level grant. Init'd on first Barbarian level.
  rageUses: 2,

  gearlessLevelCap: 3,

  canClimb: false,
};
