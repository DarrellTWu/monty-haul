// shared/logic/equipment.js
// Pure equip/unequip slot routing + derived-stat recomputation.
// Mutates the player passed in (PlayerState carries ArraySchema inventory
// that can't be cheaply copied). Caller is responsible for verifying the
// player exists and is the intended target; this module only enforces the
// SRD slot rules (two-handed, shield, armor) and inventory presence.

import { ARMOR_REGISTRY, computeAC } from '../data/armor/armor.js';
import { SHIELD_REGISTRY }           from '../data/items/shields.js';
import { WEAPON_REGISTRY }           from '../data/weapons/index.js';
import { CLASS_REGISTRY, DEFAULT_CLASS } from '../data/classes/index.js';
import { getModifier }               from './combat.js';

/**
 * Recompute derived stats (AC) from the player's current ability scores and
 * equipment. Call after any equip/unequip or ability-score change.
 *
 * @param {object} player - mutated in place; reads class/equippedArmorId/offhandId/dex
 */
export function recomputeStats(player) {
  const classDef  = CLASS_REGISTRY[player.class] ?? DEFAULT_CLASS;
  const dexMod    = getModifier(player.dex);
  const hasShield = !!SHIELD_REGISTRY[player.offhandId];
  if (!player.equippedArmorId && !hasShield && classDef.unarmoredDefense) {
    const udMod = getModifier(player[classDef.unarmoredDefense]);
    player.ac = 10 + dexMod + udMod;
  } else {
    player.ac = computeAC(ARMOR_REGISTRY[player.equippedArmorId] ?? null, dexMod, hasShield);
  }
}

/**
 * Equip an item from the player's inventory into the appropriate slot. If
 * `slot` is omitted, infers from item type: armor → 'armor', shield → 'offhand',
 * weapon → 'weapon'. Items that don't fit the target slot are rejected.
 *
 * Side effects:
 *   - splices `itemId` out of inventory
 *   - any previously-equipped item in the target slot is pushed back to inventory
 *   - equipping a two-handed weapon auto-unequips the offhand
 *   - equipping anything to the offhand auto-unequips a two-handed main-hand
 *   - recomputeStats is called after a successful change
 *
 * Silently no-ops (returns { ok:false, reason }) if the item is not in inventory
 * or the slot/item combination is invalid. Matches the prior handler behavior.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function equipItem(player, { itemId, slot }) {
  const id  = String(itemId);
  const idx = player.inventory.indexOf(id);
  if (idx === -1) return { ok: false, reason: 'not in inventory' };

  const isShield = !!SHIELD_REGISTRY[id];
  const isWeapon = !!WEAPON_REGISTRY[id];
  const isArmor  = !!ARMOR_REGISTRY[id];

  const targetSlot = slot || (isArmor ? 'armor' : isShield ? 'offhand' : 'weapon');

  if (targetSlot === 'armor') {
    if (!isArmor) return { ok: false, reason: 'item is not armor' };
    if (player.equippedArmorId) player.inventory.push(player.equippedArmorId);
    player.inventory.splice(player.inventory.indexOf(id), 1);
    player.equippedArmorId = id;
    recomputeStats(player);
    return { ok: true };
  }

  if (targetSlot === 'offhand') {
    // Offhand accepts one-handed weapons OR shields. Blocks two-handed weapons.
    if (isWeapon && WEAPON_REGISTRY[id]?.properties?.includes('two-handed')) {
      return { ok: false, reason: 'two-handed weapon cannot go to offhand' };
    }
    if (!isWeapon && !isShield) return { ok: false, reason: 'item is not a weapon or shield' };
    // Equipping anything to offhand auto-unequips a two-handed weapon from main hand.
    if (player.equippedWeaponId && WEAPON_REGISTRY[player.equippedWeaponId]?.properties?.includes('two-handed')) {
      player.inventory.push(player.equippedWeaponId);
      player.equippedWeaponId = '';
    }
    if (player.offhandId) player.inventory.push(player.offhandId);
    player.inventory.splice(player.inventory.indexOf(id), 1);
    player.offhandId = id;
    recomputeStats(player);
    return { ok: true };
  }

  // weapon slot
  if (isShield || isArmor) return { ok: false, reason: 'item is not a weapon' };
  const newWeapon = WEAPON_REGISTRY[id];
  if (!newWeapon) return { ok: false, reason: 'unknown weapon' };
  // Two-handed weapon: auto-unequip offhand.
  if (newWeapon.properties?.includes('two-handed') && player.offhandId) {
    player.inventory.push(player.offhandId);
    player.offhandId = '';
  }
  if (player.equippedWeaponId) player.inventory.push(player.equippedWeaponId);
  player.inventory.splice(player.inventory.indexOf(id), 1);
  player.equippedWeaponId = id;
  recomputeStats(player);
  return { ok: true };
}

/**
 * Unequip the item in `slot` ('weapon' | 'offhand' | 'armor'); pushes it back
 * to inventory. Calls recomputeStats when AC could be affected (offhand/armor).
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function unequipItem(player, { slot }) {
  if (slot === 'weapon') {
    if (!player.equippedWeaponId) return { ok: false, reason: 'weapon slot empty' };
    player.inventory.push(player.equippedWeaponId);
    player.equippedWeaponId = '';
    return { ok: true };
  }
  if (slot === 'offhand') {
    if (!player.offhandId) return { ok: false, reason: 'offhand slot empty' };
    player.inventory.push(player.offhandId);
    player.offhandId = '';
    recomputeStats(player);
    return { ok: true };
  }
  if (slot === 'armor') {
    if (!player.equippedArmorId) return { ok: false, reason: 'armor slot empty' };
    player.inventory.push(player.equippedArmorId);
    player.equippedArmorId = '';
    recomputeStats(player);
    return { ok: true };
  }
  return { ok: false, reason: 'unknown slot' };
}
