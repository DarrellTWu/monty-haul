// shared/data/enemies/tier1.js
// Floor 1-3 enemy definitions. Stats sourced from D&D 5e SRD.
// HP_MULTIPLIER is NOT applied to enemies — only to players at run start.

export const GOBLIN = {
  type: 'goblin',

  // SRD stats
  hp: 7,
  ac: 15, // leather armor + shield

  // Pre-computed attack bonus (DEX +2 + proficiency +2 = +4)
  attackBonus: 4,

  // Scimitar: 1d6+2 slashing
  damageDice: { count: 1, sides: 6 },
  damageBonus: 2,
  damageType: 'slashing',

  resistances: [],

  // Movement speed in px/sec. SRD: 30 ft; 5px/ft → 150px, but goblins
  // feel better slightly slower than the player. Tunable.
  speed: 120,

  // Aggro range: goblins use the global COMBAT_DETECTION_RADIUS.
  // Override here if a specific enemy type should have different awareness.
  detectionRadius: null, // null = use COMBAT_DETECTION_RADIUS from constants
};
