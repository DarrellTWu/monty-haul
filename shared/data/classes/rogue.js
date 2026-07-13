// shared/data/classes/rogue.js
// Rogue base stats and level table.
// Level 1: Sneak Attack (passive — extra d6s on the first eligible hit per
// Attack event; eligibility in shared/logic/combat.js sneakAttackEligibility,
// dice count from getSneakAttackDice). Level 2: Cunning Action (Dash).
// Level 3: subclass slot (Skirmisher via emblem item).
// SRD Expertise / Thieves' Cant have no skill system to land on — skipped.
// Full 1–10 design: docs/design/skirmisher-progression.md.

import { HP_MULTIPLIER } from '../constants.js';

export const ROGUE = {
  id: 'rogue',
  name: 'Rogue',
  hitDie: 8,

  baseAbilityScores: {
    str: 10,
    dex: 16, // primary attack stat (finesse/ranged weapons)
    con: 14,
    int: 12,
    wis: 12,
    cha: 10,
  },

  getStartingHp(conMod) {
    return Math.floor((this.hitDie + conMod) * HP_MULTIPLIER);
  },

  startingWeaponId: 'shortsword',
  startingArmorId:  'leather',

  unarmoredDefense: null,

  // SRD Rogue: DEX and INT. First-class only post-multiclass.
  saveProficiencies: ['dex', 'int'],

  // Per-level progression (SRD Rogue 1–3, adapted).
  // Level 1: Sneak Attack — passive, no hotbar entry; dice scale with rogue
  //   level (ceil(level / 2) d6 — 1d6 at 1, 2d6 at 3).
  // Level 2: Cunning Action — Dash on the hotbar (Disengage/Hide deferred:
  //   no opportunity-attack or stealth system yet).
  levels: {
    1: { features: [], grants: { sneakAttack: true, feat: 'alert' } },
    2: { features: ['cunning_action'] },
    3: { features: [], grants: { subclassChoice: true } },
  },

  // Skirmisher (GDD Wave 1, original subclass): Skirmish — Sneak Attack is
  // also eligible when both the rogue and the target are moving at the moment
  // the attack resolves. See docs/design/skirmisher-progression.md.
  // TODO(deferred): Swashbuckler subclass (melee half of the Rogue pair) — see docs/design/gdd.md §Rogue.
  subclasses: {
    skirmisher: { id: 'skirmisher', name: 'Skirmisher', grants: { skirmish: true } },
  },

  startingItemIds: ['skirmisher_spurs'],

  gearlessLevelCap: 3,

  // Geometry: rogues scale platform perimeters without a step (second-story
  // work). High ground feeds the advantage → Sneak Attack loop.
  canClimb: true,
};
