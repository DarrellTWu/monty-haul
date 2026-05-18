// shared/data/armor/armor.js
// All SRD armor definitions and the AC computation function.
// AC for a given character = computeAC(armorDef, dexMod, hasShield).

// ── Armor definitions ─────────────────────────────────────────────────────────
//
// Each entry carries `category: 'armor'` plus its existing `type` sub-discriminator
// ('light' | 'medium' | 'heavy'). Display layers derive every armor string from
// these fields via shared/logic/item-display.js — there is no separate label or
// detail table anywhere else in the codebase.

// Light armor: AC = base + full DEX modifier.
export const PADDED          = { id: 'padded',          category: 'armor', type: 'light',  label: 'Padded',          baseAC: 11, stealthDisadvantage: true,  strRequirement: 0, goldValue: 5,   sortKey: 200 };
export const LEATHER         = { id: 'leather',         category: 'armor', type: 'light',  label: 'Leather',         baseAC: 11, stealthDisadvantage: false, strRequirement: 0, goldValue: 10,  sortKey: 210 };
export const STUDDED_LEATHER = { id: 'studded_leather', category: 'armor', type: 'light',  label: 'Studded Leather', baseAC: 12, stealthDisadvantage: false, strRequirement: 0, goldValue: 45,  sortKey: 220 };

// Medium armor: AC = base + DEX modifier, maximum +2.
export const HIDE        = { id: 'hide',        category: 'armor', type: 'medium', label: 'Hide',        baseAC: 12, stealthDisadvantage: false, strRequirement: 0, goldValue: 10,  sortKey: 230 };
export const CHAIN_SHIRT = { id: 'chain_shirt', category: 'armor', type: 'medium', label: 'Chain Shirt', baseAC: 13, stealthDisadvantage: false, strRequirement: 0, goldValue: 50,  sortKey: 240 };
export const SCALE_MAIL  = { id: 'scale_mail',  category: 'armor', type: 'medium', label: 'Scale Mail',  baseAC: 14, stealthDisadvantage: true,  strRequirement: 0, goldValue: 50,  sortKey: 250 };
export const BREASTPLATE = { id: 'breastplate', category: 'armor', type: 'medium', label: 'Breastplate', baseAC: 14, stealthDisadvantage: false, strRequirement: 0, goldValue: 400, sortKey: 260 };
export const HALF_PLATE  = { id: 'half_plate',  category: 'armor', type: 'medium', label: 'Half Plate',  baseAC: 15, stealthDisadvantage: true,  strRequirement: 0, goldValue: 750, sortKey: 270 };

// Heavy armor: AC = base only, no DEX contribution.
export const RING_MAIL  = { id: 'ring_mail',  category: 'armor', type: 'heavy', label: 'Ring Mail',  baseAC: 14, stealthDisadvantage: true,  strRequirement: 0,  goldValue: 30,   sortKey: 280 };
export const CHAIN_MAIL = { id: 'chain_mail', category: 'armor', type: 'heavy', label: 'Chain Mail', baseAC: 16, stealthDisadvantage: true,  strRequirement: 13, goldValue: 75,   sortKey: 290 };
export const SPLINT     = { id: 'splint',     category: 'armor', type: 'heavy', label: 'Splint',     baseAC: 17, stealthDisadvantage: true,  strRequirement: 15, goldValue: 200,  sortKey: 295 };
export const PLATE      = { id: 'plate',      category: 'armor', type: 'heavy', label: 'Plate',      baseAC: 18, stealthDisadvantage: true,  strRequirement: 15, goldValue: 1500, sortKey: 298 };

// ── AC computation ────────────────────────────────────────────────────────────

/**
 * Compute a character's Armor Class from their equipped armor, DEX modifier,
 * and whether they're holding a shield. Follows SRD rules exactly.
 *
 * Light  — baseAC + dexMod (uncapped)
 * Medium — baseAC + min(dexMod, 2)
 * Heavy  — baseAC (DEX ignored)
 * Shield — always +2, regardless of armor type
 * Unarmored (armor = null) — 10 + dexMod
 *
 * @param {object|null} armorDef - one of the armor exports above, or null for unarmored
 * @param {number} dexMod - the character's DEX ability modifier
 * @param {boolean} [hasShield=false]
 * @returns {number} final Armor Class
 */
export function computeAC(armorDef, dexMod, hasShield = false) {
  let ac;

  if (!armorDef) {
    ac = 10 + dexMod; // unarmored
  } else if (armorDef.type === 'light') {
    ac = armorDef.baseAC + dexMod;
  } else if (armorDef.type === 'medium') {
    ac = armorDef.baseAC + Math.min(2, dexMod);
  } else {
    // heavy
    ac = armorDef.baseAC;
  }

  if (hasShield) ac += 2;
  return ac;
}

// Registry for lookup by id (used by server and inventory scene).
export const ARMOR_REGISTRY = {
  padded:          PADDED,
  leather:         LEATHER,
  studded_leather: STUDDED_LEATHER,
  hide:            HIDE,
  chain_shirt:     CHAIN_SHIRT,
  scale_mail:      SCALE_MAIL,
  breastplate:     BREASTPLATE,
  half_plate:      HALF_PLATE,
  ring_mail:       RING_MAIL,
  chain_mail:      CHAIN_MAIL,
  splint:          SPLINT,
  plate:           PLATE,
};
