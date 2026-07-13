// shared/data/classes/monk.js
// Monk base stats. Level 1: Unarmored Defense + Martial Arts (both passive).
// Level 2: Ki (Flurry of Blows, Patient Defense, Step of the Wind) + Unarmored
// Movement. Level 3: subclass slot (Way of the Open Hand via emblem item).

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

  // Per-level progression (SRD Monk 1–3).
  // Level 2: Ki (pool = monk level; refills on long rest) fueling Flurry of
  // Blows / Patient Defense / Step of the Wind, plus Unarmored Movement.
  // Level 3: subclass slot.
  levels: {
    1: { features: [], grants: { feat: 'alert' } },
    2: {
      features: ['flurry_of_blows', 'patient_defense', 'step_of_wind'],
      grants: { ki: true, unarmoredMovementFt: 10 },
    },
    3: { features: [], grants: { subclassChoice: true } },
  },

  // Way of the Open Hand (SRD): Open Hand Technique — Flurry of Blows hits
  // stagger the target (attack timer pushed back; real-time stand-in for trip/push).
  subclasses: {
    open_hand: { id: 'open_hand', name: 'Way of the Open Hand', grants: { openHandTechnique: true } },
  },

  startingItemIds: ['open_hand_manual'],

  gearlessLevelCap: 3,

  // Geometry: monks can scale platform perimeters without a step.
  canClimb: true,
};
