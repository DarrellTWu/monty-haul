// shared/data/enemies/goblin.js
// SRD Goblin stat block — tuned for real-time play.
// Source: Systems Reference Document 5.1, "Goblin"

export default {
  // ── Identity ────────────────────────────────────────────────────────────────
  id:           'goblin',
  name:         'Goblin',
  cr:           '1/4',
  xp:           50,
  size:         'small',
  creatureType: 'humanoid (goblinoid)',
  alignment:    'neutral evil',

  // ── Defense ─────────────────────────────────────────────────────────────────
  hp:       7,
  hitDice:  '2d6',          // 2d6 + 0 CON
  ac:       15,
  acSource: 'leather armor, shield',

  // ── Ability scores ───────────────────────────────────────────────────────────
  abilityScores: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },

  // ── Saving throws ────────────────────────────────────────────────────────────
  // Goblins have no saving throw proficiencies in the SRD.
  saveProficiencies: [],

  // ── Skills ───────────────────────────────────────────────────────────────────
  skillProficiencies: { stealth: 6 },

  // ── Damage traits ────────────────────────────────────────────────────────────
  damageVulnerabilities: [],
  damageResistances:     [],
  damageImmunities:      [],
  conditionImmunities:   [],

  // Damage Reduction: null = none. { value, bypass } = DR X/bypass-type.
  damageReduction: null,

  // ── Senses ───────────────────────────────────────────────────────────────────
  senses: { darkvision: 60, passivePerception: 9 },

  // ── Languages ────────────────────────────────────────────────────────────────
  languages: ['Common', 'Goblin'],

  // ── Special traits ───────────────────────────────────────────────────────────
  traits: [
    { name: 'Nimble Escape', description: 'Can Disengage or Hide as a bonus action.' },
  ],

  // ── Actions (SRD) ────────────────────────────────────────────────────────────
  actions: [
    {
      name:        'Scimitar',
      type:        'melee_attack',
      attackBonus: 4,      // DEX +2 + prof +2
      reach:       5,
      targets:     1,
      damageDice:  '1d6',
      damageBonus: 2,
      damageType:  'slashing',
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

  // ── Engine values (derived from above for runtime AI use) ────────────────────
  // Primary attack used by CombatSystem / AISystem each tick.
  attackBonus: 4,
  damageDice:  { count: 1, sides: 6 },
  damageBonus: 2,
  damageType:  'slashing',

  // Resistance list passed to applyDamage (mirrors damageResistances above).
  resistances: [],

  // Movement in px/sec. SRD: 30 ft × 5 px/ft = 150 px/s; tuned down for feel.
  speed: 120,

  // Override COMBAT_DETECTION_RADIUS; null = use global constant.
  detectionRadius: null,

  // Geometry: can scale platform perimeters without using a step.
  // Stub for the climbing-skill system; see docs/geometry-sprint-plan.md.
  canClimb: true,
};
