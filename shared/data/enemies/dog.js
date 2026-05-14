// shared/data/enemies/dog.js
// Analog to SRD Mastiff — used as the "dog" enemy type.
// Significantly faster than a goblin; tests player positioning.
// Source: Systems Reference Document 5.1, "Mastiff"

export default {
  // ── Identity ────────────────────────────────────────────────────────────────
  id:           'dog',
  name:         'Dog (Mastiff)',
  cr:           '1/8',
  xp:           25,
  size:         'medium',
  creatureType: 'beast',
  alignment:    'unaligned',

  // ── Defense ─────────────────────────────────────────────────────────────────
  hp:       5,
  hitDice:  '1d8+1',        // 1d8 + 1 CON
  ac:       12,
  acSource: 'natural armor',

  // ── Ability scores ───────────────────────────────────────────────────────────
  abilityScores: { str: 13, dex: 14, con: 12, int: 3, wis: 12, cha: 7 },

  // ── Saving throws ────────────────────────────────────────────────────────────
  saveProficiencies: [],

  // ── Skills ───────────────────────────────────────────────────────────────────
  skillProficiencies: { perception: 3 },

  // ── Damage traits ────────────────────────────────────────────────────────────
  damageVulnerabilities: [],
  damageResistances:     [],
  damageImmunities:      [],
  conditionImmunities:   [],

  damageReduction: null,

  // ── Senses ───────────────────────────────────────────────────────────────────
  senses: { passivePerception: 13 },

  // ── Languages ────────────────────────────────────────────────────────────────
  languages: [],

  // ── Special traits ───────────────────────────────────────────────────────────
  traits: [
    {
      name: 'Keen Hearing and Smell',
      description: 'Advantage on Perception checks that rely on hearing or smell.',
    },
    {
      name: 'Pack Tactics',
      description: 'Advantage on attack rolls when an ally is adjacent to the target.',
      // TODO: implement advantage mechanic (roll 2d20 take highest) when Pack Tactics is active.
    },
  ],

  // ── Actions (SRD) ────────────────────────────────────────────────────────────
  actions: [
    {
      name:        'Bite',
      type:        'melee_attack',
      attackBonus: 3,      // STR +1 + prof +2
      reach:       5,
      targets:     1,
      damageDice:  '1d6',
      damageBonus: 1,
      damageType:  'piercing',
      onHit: {
        // SRD: target must succeed DC 11 STR save or be knocked prone.
        // TODO: implement prone condition.
        save:      { ability: 'str', dc: 11 },
        condition: 'prone',
      },
    },
  ],

  // ── Engine values ────────────────────────────────────────────────────────────
  attackBonus: 3,
  damageDice:  { count: 1, sides: 6 },
  damageBonus: 1,
  damageType:  'piercing',

  resistances: [],
  damageReduction: null,

  // SRD: 40 ft × 5 px/ft = 200 px/s. Tuned to remain at 200 — the speed
  // differential is the dog's defining gameplay trait.
  speed: 200,

  detectionRadius: null,

  // Geometry: dogs can't climb platform perimeters — they must route to a step.
  canClimb: false,
};
