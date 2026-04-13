// shared/data/armor/armor.js
// All SRD armor definitions and the AC computation function.
// AC for a given character = computeAC(armorDef, dexMod, hasShield).

// ── Armor definitions ─────────────────────────────────────────────────────────

// Light armor: AC = base + full DEX modifier.
export const PADDED          = { id: 'padded',          label: 'Padded',          type: 'light',  baseAC: 11, stealthDisadvantage: true,  strRequirement: 0 };
export const LEATHER         = { id: 'leather',         label: 'Leather',         type: 'light',  baseAC: 11, stealthDisadvantage: false, strRequirement: 0 };
export const STUDDED_LEATHER = { id: 'studded_leather', label: 'Studded Leather', type: 'light',  baseAC: 12, stealthDisadvantage: false, strRequirement: 0 };

// Medium armor: AC = base + DEX modifier, maximum +2.
export const HIDE        = { id: 'hide',        label: 'Hide',        type: 'medium', baseAC: 12, stealthDisadvantage: false, strRequirement: 0 };
export const CHAIN_SHIRT = { id: 'chain_shirt', label: 'Chain Shirt', type: 'medium', baseAC: 13, stealthDisadvantage: false, strRequirement: 0 };
export const SCALE_MAIL  = { id: 'scale_mail',  label: 'Scale Mail',  type: 'medium', baseAC: 14, stealthDisadvantage: true,  strRequirement: 0 };
export const BREASTPLATE = { id: 'breastplate', label: 'Breastplate', type: 'medium', baseAC: 14, stealthDisadvantage: false, strRequirement: 0 };
export const HALF_PLATE  = { id: 'half_plate',  label: 'Half Plate',  type: 'medium', baseAC: 15, stealthDisadvantage: true,  strRequirement: 0 };

// Heavy armor: AC = base only, no DEX contribution.
export const RING_MAIL  = { id: 'ring_mail',  label: 'Ring Mail',  type: 'heavy', baseAC: 14, stealthDisadvantage: true,  strRequirement: 0  };
export const CHAIN_MAIL = { id: 'chain_mail', label: 'Chain Mail', type: 'heavy', baseAC: 16, stealthDisadvantage: true,  strRequirement: 13 };
export const SPLINT     = { id: 'splint',     label: 'Splint',     type: 'heavy', baseAC: 17, stealthDisadvantage: true,  strRequirement: 15 };
export const PLATE      = { id: 'plate',      label: 'Plate',      type: 'heavy', baseAC: 18, stealthDisadvantage: true,  strRequirement: 15 };

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
