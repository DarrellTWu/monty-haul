// client/src/ui/hub/hub-data.js
// Shared constants + tiny helpers for the hub panels. Panel-display metadata
// (labels, sections, class blurbs) lives here so individual panel modules
// don't each carry their own table.

import { POINT_COST } from '../../../../shared/data/constants.js';

// Panel geometry — used by all hub panels for placement.
export const LP = { x: 30,  y: 70, w: 760, h: 600 }; // left panel
export const RP = { x: 810, y: 70, w: 440, h: 600 }; // right panel (raider config)

// Per-item display metadata (label + one-line detail).
export const ITEM_META = {
  longsword:           { label: 'Longsword',        detail: '1d8  slashing'    },
  shortsword:          { label: 'Shortsword',       detail: '1d6  piercing'    },
  dagger:              { label: 'Dagger',           detail: '1d4  piercing'    },
  handaxe:             { label: 'Handaxe',          detail: '1d6  slashing'    },
  mace:                { label: 'Mace',             detail: '1d6  bludgeoning' },
  greataxe:            { label: 'Greataxe',         detail: '1d12 slashing'    },
  greatsword:          { label: 'Greatsword',       detail: '2d6  slashing'    },
  shortbow:            { label: 'Shortbow',         detail: '1d6  piercing  ranged' },
  longbow:             { label: 'Longbow',          detail: '1d8  piercing  ranged' },
  padded:              { label: 'Padded',           detail: 'AC 11+DEX  light' },
  leather:             { label: 'Leather',          detail: 'AC 11+DEX  light' },
  studded_leather:     { label: 'Studded Leather',  detail: 'AC 12+DEX  light' },
  hide:                { label: 'Hide',             detail: 'AC 12+DEX  med'   },
  chain_shirt:         { label: 'Chain Shirt',      detail: 'AC 13+DEX  med'   },
  scale_mail:          { label: 'Scale Mail',       detail: 'AC 14+DEX  med'   },
  breastplate:         { label: 'Breastplate',      detail: 'AC 14+DEX  med'   },
  ring_mail:           { label: 'Ring Mail',        detail: 'AC 14  heavy'     },
  chain_mail:          { label: 'Chain Mail',       detail: 'AC 16  heavy'     },
  splint:              { label: 'Splint',           detail: 'AC 17  heavy'     },
  half_plate:          { label: 'Half Plate',       detail: 'AC 15+DEX  med'   },
  plate:               { label: 'Plate',            detail: 'AC 18  heavy'     },
  shield:              { label: 'Shield',           detail: '+2 AC'            },
  healing_potion:      { label: 'Healing Potion',   detail: '2d4+2 HP'         },
  bless_potion:        { label: 'Bless Potion',     detail: '+1d4 atk 60s'     },
  longstrider_potion:  { label: 'Longstrider Pot',  detail: '+10ft spd 2m'     },
  false_life_potion:   { label: 'False Life Pot',   detail: '1d4+4 tmp HP 2m'  },
  skeleton_bone:       { label: 'Skeleton Bone',    detail: 'crafting material'},
  wolf_pelt:           { label: 'Wolf Pelt',        detail: 'crafting material'},
};

export const STASH_ORDER = [
  'longsword','shortsword','dagger','handaxe','mace','greataxe','greatsword',
  'shortbow','longbow',
  'padded','leather','studded_leather',
  'hide','chain_shirt','scale_mail','breastplate','half_plate',
  'ring_mail','chain_mail','splint','plate',
  'shield',
  'healing_potion','longstrider_potion','false_life_potion','bless_potion',
  'skeleton_bone','wolf_pelt',
];

const ARMOR_IDS = [
  'padded','leather','studded_leather',
  'hide','chain_shirt','scale_mail','breastplate','half_plate',
  'ring_mail','chain_mail','splint','plate',
];

export const STASH_SECTIONS = [
  { label: 'Weapons',        ids: new Set(['longsword','shortsword','dagger','handaxe','mace','greataxe','greatsword','shortbow','longbow']) },
  { label: 'Armor & Shield', ids: new Set([...ARMOR_IDS, 'shield']) },
  { label: 'Potions',        ids: new Set(['healing_potion','bless_potion','longstrider_potion','false_life_potion']) },
  { label: 'Materials',      ids: new Set(['skeleton_bone','wolf_pelt']) },
];

// Stat labels for the point-buy UI, in display order.
export const STAT_KEYS   = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const STAT_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };

export function scoreMod(score)    { return Math.floor((score - 10) / 2); }
export function scoreModStr(score) { const m = scoreMod(score); return `(${m >= 0 ? '+' : ''}${m})`; }
export function pointsSpent(scores) {
  return STAT_KEYS.reduce((sum, k) => sum + (POINT_COST[scores[k]] ?? 0), 0);
}

// Class display metadata for the hub UI.
// `defaultScores`: the recommended standard-array allocation (costs exactly 27 pts).
export const CLASS_DISPLAY = {
  fighter: {
    label: 'Fighter',
    traits: [
      'Longsword · Chain Mail',
      'Second Wind — 1d10+level HP (1/rest)',
      'Fighting Style: Dueling (+2 dmg)',
    ],
    defaultScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  monk: {
    label: 'Monk',
    traits: [
      'Shortsword · Unarmored Defense (AC = 10+DEX+WIS)',
      'Martial Arts — DEX attacks, d4 unarmed',
      'Bonus unarmed strike after monk weapon attack',
    ],
    defaultScores: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  barbarian: {
    label: 'Barbarian',
    traits: [
      'Greatsword · Chain Mail',
      'Rage — +2 dmg, resist physical dmg (2 uses, 30s)',
    ],
    defaultScores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 },
  },
};
