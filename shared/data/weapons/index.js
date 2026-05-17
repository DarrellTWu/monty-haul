// shared/data/weapons/index.js
// Unified WEAPON_REGISTRY barrel. Single source of truth for "is X an equippable
// weapon?" Imports from this file replace the older `shared/data/weapons/melee.js`
// WEAPON_REGISTRY export.
//
// UNARMED is re-exported but intentionally NOT in WEAPON_REGISTRY — it's the
// fallback for an empty weapon slot, not an equippable item.

import {
  LONGSWORD, SHORTSWORD, HANDAXE, GREATAXE, GREATSWORD, DAGGER, MACE, UNARMED,
} from './melee.js';
import { SHORTBOW, LONGBOW } from './ranged.js';

export {
  LONGSWORD, SHORTSWORD, HANDAXE, GREATAXE, GREATSWORD, DAGGER, MACE, UNARMED,
  SHORTBOW, LONGBOW,
};

export const WEAPON_REGISTRY = {
  longsword:  LONGSWORD,
  shortsword: SHORTSWORD,
  handaxe:    HANDAXE,
  greataxe:   GREATAXE,
  greatsword: GREATSWORD,
  dagger:     DAGGER,
  mace:       MACE,
  shortbow:   SHORTBOW,
  longbow:    LONGBOW,
};
