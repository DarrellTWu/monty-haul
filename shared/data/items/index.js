// shared/data/items/index.js
// Unified ITEM_REGISTRY — the union barrel across every type-specific registry.
//
// Type-specific registries (WEAPON_REGISTRY, ARMOR_REGISTRY, SHIELD_REGISTRY,
// CONSUMABLE_REGISTRY, MATERIAL_REGISTRY) continue to be where type-specific
// code looks (equipment routing, hotbar binding, AC math). ITEM_REGISTRY is
// what display layers, the gold-value table, the recipe validator, and any
// other "is this thing a known item at all?" lookup uses.
//
// Disjoint id namespace across registries is enforced by shared/tests/items.test.js.
// Spread order below is the type-precedence order in case the validator is bypassed —
// but it should never matter in practice because the validator is the contract.

import { WEAPON_REGISTRY }     from '../weapons/index.js';
import { ARMOR_REGISTRY }      from '../armor/armor.js';
import { SHIELD_REGISTRY }     from './shields.js';
import { CONSUMABLE_REGISTRY } from './consumables.js';
import { MATERIAL_REGISTRY }   from './materials.js';

export const ITEM_REGISTRY = Object.freeze({
  ...WEAPON_REGISTRY,
  ...ARMOR_REGISTRY,
  ...SHIELD_REGISTRY,
  ...CONSUMABLE_REGISTRY,
  ...MATERIAL_REGISTRY,
});

/** True iff `id` resolves in ITEM_REGISTRY. */
export const isKnownItem = (id) => Object.hasOwn(ITEM_REGISTRY, id);

/** Returns the item def or null. */
export const getItem = (id) => ITEM_REGISTRY[id] ?? null;

/** Categories in display order (used by getStashSections and friends). */
export const CATEGORY_DISPLAY_ORDER = ['weapon', 'armor', 'shield', 'consumable', 'material'];
