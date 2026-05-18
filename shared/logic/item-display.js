// shared/logic/item-display.js
// Derived display strings for every item in ITEM_REGISTRY.
//
// Every display fact (bag-row detail string, stash section, sort-within-section,
// equipped-armor slot description) is computed from the canonical item def.
// No hand-maintained tables of labels/details/sort-orders exist anywhere else.
//
// Two consumer surfaces today:
//   1. Hub stash list (client/src/ui/hub/hub-data.js) — uses getItemDisplay
//      for label + bag-row detail and getStashSections / getStashOrder for grouping.
//   2. Dungeon InventoryScene (client/src/scenes/InventoryScene.js) — uses
//      getItemDisplay for bag rows + offhand/weapon-slot labels, and
//      getArmorSlotDescription for the long-form equipped-armor line.
//
// All five formatters are pure and deterministic — same def in, same string out.

import { ITEM_REGISTRY, CATEGORY_DISPLAY_ORDER } from '../data/items/index.js';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Display block for `itemId`. Returns null when the id is unknown so callers
 * can decide between a literal fallback (the id string itself) or an error.
 *
 * @param {string} itemId
 * @returns {{
 *   id: string,
 *   label: string,
 *   detail: string,
 *   note: string | null,
 *   section: string,
 *   sortKey: number,
 *   category: string,
 * } | null}
 */
export function getItemDisplay(itemId) {
  const def = ITEM_REGISTRY[itemId];
  if (!def) return null;
  const formatter = DETAIL_FORMATTERS[def.category];
  // Validator (shared/tests/items.test.js) asserts every category has a formatter,
  // so this is a programmer error if it ever returns undefined.
  const detail = formatter(def);
  return {
    id:       itemId,
    label:    def.label,
    detail,
    note:     def.note ?? null,
    section:  SECTION_FOR_CATEGORY[def.category],
    sortKey:  def.sortKey,
    category: def.category,
  };
}

/**
 * Long-form description for the equipped-armor slot in InventoryScene.
 * Derived entirely from the armor def. Light/medium include "+DEX"; medium
 * appends "(cap 2)"; heavy is just the base. Trailing parenthetical lists
 * type, stealth-disadv, and STR-requirement clauses.
 *
 * @param {object} armorDef — entry from ARMOR_REGISTRY
 * @returns {string}
 */
export function getArmorSlotDescription(armorDef) {
  if (!armorDef) return '';
  const acPart = armorAcString(armorDef);
  const clauses = [armorDef.type];
  if (armorDef.stealthDisadvantage) clauses.push('stealth disadv.');
  if (armorDef.strRequirement > 0)  clauses.push(`STR ${armorDef.strRequirement}`);
  return `${armorDef.label} — ${acPart}  (${clauses.join(', ')})`;
}

/**
 * Stash sections in display order. Walks ITEM_REGISTRY, groups by category,
 * filters out items that opt out via `hideInStash: true` (none today).
 * Section labels come from a single mapping table below.
 *
 * @returns {Array<{ label: string, ids: Set<string> }>}
 */
export function getStashSections() {
  // Sections are keyed by label (not category) so categories that share a
  // section label — armor + shield → "Armor & Shield" — merge into one row.
  const sectionsByLabel = new Map();
  for (const category of CATEGORY_DISPLAY_ORDER) {
    const label = SECTION_LABELS[category];
    for (const [id, def] of Object.entries(ITEM_REGISTRY)) {
      if (def.category !== category) continue;
      if (def.hideInStash) continue;
      let entry = sectionsByLabel.get(label);
      if (!entry) {
        entry = { label, ids: new Set() };
        sectionsByLabel.set(label, entry);
      }
      entry.ids.add(id);
    }
  }
  return [...sectionsByLabel.values()];
}

/**
 * All item ids sorted by (category-display-order, sortKey, label).
 * Items with `hideInStash: true` are excluded.
 *
 * @returns {string[]}
 */
export function getStashOrder() {
  const categoryRank = new Map(CATEGORY_DISPLAY_ORDER.map((c, i) => [c, i]));
  const entries = Object.entries(ITEM_REGISTRY)
    .filter(([, def]) => !def.hideInStash)
    .map(([id, def]) => ({
      id,
      rank: categoryRank.get(def.category) ?? Number.POSITIVE_INFINITY,
      sortKey: def.sortKey,
      label: def.label,
    }));
  entries.sort((a, b) => a.rank - b.rank || a.sortKey - b.sortKey || a.label.localeCompare(b.label));
  return entries.map(e => e.id);
}

// ── Internal: per-category detail formatters ────────────────────────────────
//
// Detail strings are tuned to match the pre-refactor visual style. Key
// conventions preserved here:
//   - Weapon dice are left-padded to 4 chars so 1d6 / 1d12 / 2d6 column-align:
//     "1d6  piercing", "1d12 slashing".
//   - "ranged" suffix lives in the bow note (set on the def), not in detail —
//     detail stays pure stats for symmetry between melee and ranged rows.
//   - Armor uses fixed two-space separator before the type clause:
//     "AC 11+DEX  light", "AC 14  heavy".

function diceStr(d) { return `${d.count}d${d.sides}`; }

function weaponDetail(def) {
  const die = diceStr(def.damageDice).padEnd(4);
  return `${die} ${def.damageType}`;
}

function armorAcString(def) {
  if (def.type === 'light')  return `AC ${def.baseAC}+DEX`;
  if (def.type === 'medium') return `AC ${def.baseAC}+DEX(cap 2)`;
  return `AC ${def.baseAC}`;
}

function armorDetail(def) {
  if (def.type === 'light')  return `AC ${def.baseAC}+DEX  ${def.type}`;
  if (def.type === 'medium') return `AC ${def.baseAC}+DEX  med`;
  return `AC ${def.baseAC}  ${def.type}`;
}

function shieldDetail(def) {
  return `+${def.acBonus} AC`;
}

// Consumable formatter switches on the canonical effect type. Each branch
// reads only fields that exist on its type — false_life uses damageDice+diceBonus
// the same way healing does, so the dice helper is shared.
function consumableDetail(def) {
  switch (def.type) {
    case 'healing':
      return `${diceStr(def.damageDice)}+${def.diceBonus} HP`;
    case 'bless':
      // SRD bless grants +1d4 to attack rolls for the duration. The +1d4 is
      // canonical to the bless effect, not a tunable field on the def.
      return `+1d4 atk ${Math.round(def.conditionDurationMs / 1000)}s`;
    case 'longstrider':
      return `+${def.speedBonusFt}ft spd ${Math.round(def.conditionDurationMs / 60000)}m`;
    case 'false_life':
      return `${diceStr(def.damageDice)}+${def.diceBonus} tmp HP ${Math.round(def.conditionDurationMs / 60000)}m`;
    case 'extract':
      return 'exit dungeon';
    default:
      return def.type;
  }
}

function materialDetail() {
  return 'crafting material';
}

const DETAIL_FORMATTERS = {
  weapon:     weaponDetail,
  armor:      armorDetail,
  shield:     shieldDetail,
  consumable: consumableDetail,
  material:   materialDetail,
};

// Section labels (one per category) for stash UI grouping.
const SECTION_LABELS = {
  weapon:     'Weapons',
  armor:      'Armor & Shield',
  shield:     'Armor & Shield',   // shields render in the same section as armor
  consumable: 'Potions',
  material:   'Materials',
};

// SECTION_FOR_CATEGORY mirrors SECTION_LABELS; kept separate so the public
// getItemDisplay.section field is stable even if section labels are restyled.
const SECTION_FOR_CATEGORY = SECTION_LABELS;
