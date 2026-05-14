// shared/data/enemies/skeleton.js
// SRD Skeleton stat block with DR 5/bludgeoning (D&D 3.5 style).
// SRD vanilla has vulnerability to bludgeoning; this uses DR instead to test
// the damage reduction system and make the mace a meaningful counter-pick.
// Source: Systems Reference Document 5.1, "Skeleton"

export default {
  // ── Identity ────────────────────────────────────────────────────────────────
  id:           'skeleton',
  name:         'Skeleton',
  cr:           '1/4',
  xp:           50,
  size:         'medium',
  creatureType: 'undead',
  alignment:    'lawful evil',

  // ── Defense ─────────────────────────────────────────────────────────────────
  hp:       13,
  hitDice:  '2d8+4',        // 2d8 + 4 CON
  ac:       13,
  acSource: 'armor scraps',

  // ── Ability scores ───────────────────────────────────────────────────────────
  abilityScores: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },

  // ── Saving throws ────────────────────────────────────────────────────────────
  saveProficiencies: [],

  // ── Skills ───────────────────────────────────────────────────────────────────
  skillProficiencies: {},

  // ── Damage traits ────────────────────────────────────────────────────────────
  // SRD has vulnerability to bludgeoning; replaced here with DR 5/bludgeoning.
  damageVulnerabilities: [],
  damageResistances:     [],
  damageImmunities:      ['poison'],
  conditionImmunities:   ['exhaustion', 'poisoned'],

  // DR 5/bludgeoning: subtract 5 from all non-bludgeoning damage.
  // Bludgeoning (mace) bypasses this entirely — full damage.
  damageReduction: { value: 5, bypass: 'bludgeoning' },

  // ── Senses ───────────────────────────────────────────────────────────────────
  senses: { darkvision: 60, passivePerception: 9 },

  // ── Languages ────────────────────────────────────────────────────────────────
  languages: ['understands languages it knew in life but cannot speak'],

  // ── Special traits ───────────────────────────────────────────────────────────
  traits: [],

  // ── Actions (SRD) ────────────────────────────────────────────────────────────
  actions: [
    {
      name:        'Shortsword',
      type:        'melee_attack',
      attackBonus: 4,      // DEX +2 + prof +2
      reach:       5,
      targets:     1,
      damageDice:  '1d6',
      damageBonus: 2,
      damageType:  'piercing',
    },
    {
      name:        'Shortbow',
      type:        'ranged_attack',
      attackBonus: 4,
      range:       '80/320',
      targets:     1,
      damageDice:  '1d6',
      damageBonus: 2,
      damageType:  'piercing',
    },
  ],

  // ── Engine values ────────────────────────────────────────────────────────────
  attackBonus: 4,
  damageDice:  { count: 1, sides: 6 },
  damageBonus: 2,
  damageType:  'piercing',

  resistances: [],   // DR handled separately via damageReduction field

  // SRD: 30 ft × 5 px/ft = 150 px/s; tuned slightly slower for undead feel.
  speed: 100,

  detectionRadius: null,

  // Geometry: skeletons can't climb platform perimeters — they must route to a step.
  canClimb: false,
};
