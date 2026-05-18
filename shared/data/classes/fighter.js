// shared/data/classes/fighter.js
// Fighter base stats and level table.
// These are the starting values before gear or run modifiers are applied.

import { HP_MULTIPLIER } from '../constants.js';

export const FIGHTER = {
  id: 'fighter',
  name: 'Fighter',
  hitDie: 10,

  // Base ability scores for a default fighter (no gear, no customization yet).
  baseAbilityScores: {
    str: 16, // +3 mod — primary attack stat
    dex: 14, // +2 mod — AC contribution with medium armor
    con: 16, // +3 mod — HP
    int: 10,
    wis: 10,
    cha: 10,
  },

  // HP at level 1: max hit die + CON modifier, then × HP_MULTIPLIER.
  getStartingHp(conMod) {
    return Math.floor((this.hitDie + conMod) * HP_MULTIPLIER);
  },

  startingWeaponId: 'longsword',
  startingArmorId: 'chain_mail',

  // SRD Fighter: STR and CON. First-class only post-multiclass.
  saveProficiencies: ['str', 'con'],

  // Per-level progression. MVP fills only level 1; 2/3 are explicit stubs.
  levels: {
    1: { features: ['second_wind'], grants: { fightingStyle: 'dueling', feat: 'alert' } },
    2: { features: [] },
    3: { features: [] }, // subclass slot — deferred
  },

  // Gearless cap per class (GDD §3). Will become gear-dependent later.
  gearlessLevelCap: 3,

  // Geometry: fighters can't scale platform perimeters — they must use a step.
  canClimb: false,
};
