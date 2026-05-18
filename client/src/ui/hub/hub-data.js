// client/src/ui/hub/hub-data.js
// Shared constants + tiny helpers for the hub panels.
//
// Per-item display metadata (ITEM_META, STASH_ORDER, STASH_SECTIONS) is
// derived once from ITEM_REGISTRY at module load. Panels read these as
// plain exports — shape is unchanged from the pre-refactor hand-maintained
// tables. To change how an item displays, edit its def in
// shared/data/items/* (or shared/data/weapons/*), not this file.

import { POINT_COST } from '../../../../shared/data/constants.js';
import { ITEM_REGISTRY } from '../../../../shared/data/items/index.js';
import {
  getItemDisplay, getStashOrder, getStashSections,
} from '../../../../shared/logic/item-display.js';

// Panel geometry — used by all hub panels for placement.
export const LP = { x: 30,  y: 70, w: 760, h: 600 }; // left panel
export const RP = { x: 810, y: 70, w: 440, h: 600 }; // right panel (raider config)

// Per-item display metadata — derived from ITEM_REGISTRY. Shape matches the
// historical hand-maintained table so panel code is unchanged.
export const ITEM_META = Object.freeze(
  Object.fromEntries(
    Object.keys(ITEM_REGISTRY).map((id) => {
      const d = getItemDisplay(id);
      return [id, { label: d.label, detail: d.detail }];
    }),
  ),
);

// Flat sort order across all items. Used by StashPanel and RaiderPanel to
// place rows in stable, designer-controlled positions.
export const STASH_ORDER = Object.freeze(getStashOrder());

// Section groupings for the stash list. Shape: [{ label, ids: Set<string> }].
// Sections share a label when their categories want to render together
// (armor + shield → "Armor & Shield").
export const STASH_SECTIONS = Object.freeze(getStashSections());

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
