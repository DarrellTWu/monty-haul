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

  // Per-level progression (SRD Fighter 1–3).
  levels: {
    1: { features: ['second_wind'], grants: { fightingStyle: 'dueling', feat: 'alert' } },
    2: { features: ['action_surge'] },
    3: { features: [], grants: { subclassChoice: true } }, // subclass unlocked by emblem item — see subclasses below
  },

  // Subclasses reachable at SUBCLASS_UNLOCK_LEVEL when the matching emblem
  // item (category 'emblem', unlocks.classId === 'fighter') is carried.
  // Champion (SRD): Improved Critical — crit on 19–20.
  subclasses: {
    champion: { id: 'champion', name: 'Champion', grants: { critRange: 19 } },
  },

  // Free starter loadout extras (empty-raider-pack joins only). The emblem
  // enables the Champion subclass unlock at Fighter 3.
  startingItemIds: ['champion_sigil'],

  // Gearless cap per class (GDD §3). Will become gear-dependent later.
  gearlessLevelCap: 3,

  // Geometry: fighters can't scale platform perimeters — they must use a step.
  canClimb: false,
};
