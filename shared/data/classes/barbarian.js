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

  // SRD Barbarian Unarmored Defense: AC = 10 + DEX mod + CON mod (no armor, no shield).
  unarmoredDefense: 'con',

  saveProficiencies: ['str', 'con'],

  // Per-level progression (SRD Barbarian 1–3).
  // Level 2: Reckless Attack (toggle — advantage on your melee attacks, attacks
  // against you have advantage) + Danger Sense (advantage on DEX saves).
  // Level 3: subclass slot + rage pool grows to 3 (grants.rageUses is absolute).
  levels: {
    1: { features: ['rage'], grants: { feat: 'alert' } },
    2: { features: ['reckless_attack'], grants: { dangerSense: true } },
    3: { features: [], grants: { rageUses: 3, subclassChoice: true } },
  },

  // Berserker (GDD Wave 1): Frenzy — one extra weapon attack per Attack event while raging.
  subclasses: {
    berserker: { id: 'berserker', name: 'Berserker', grants: { frenzy: true } },
  },

  startingItemIds: ['berserker_totem'],

  // Per-class resource pool at level 1; levels[n].grants.rageUses overrides upward.
  rageUses: 2,

  gearlessLevelCap: 3,

  canClimb: false,
};
