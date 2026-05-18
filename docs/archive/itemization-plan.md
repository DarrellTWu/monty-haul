---
status: archived
updated: 2026-05-17
purpose: Sprint plan for the itemization refactor — collapsing item metadata into a single canonical registry with derived display. Shipped 2026-05-17 (Session 7). Frozen at sprint completion; current state lives in `agent-context/itemization.md`.
---

# Itemization Refactor Sprint Plan

## Goal

Make "add a new item" a one-step process. Today the same fact (label, gold value, category, sort order, display detail) is duplicated across as many as seven files for a single item — and nothing enforces that they agree. The bow-invisible-in-stash bug from the ranged-combat sprint was the inevitable consequence: the server saved the bow correctly, but three separate display tables didn't know it existed.

After this sprint:

- Every item carries its canonical metadata (id, category, label, goldValue, type-specific fields) on its own definition in `shared/data/`.
- One unified `ITEM_REGISTRY` is the only thing anyone looks up by id.
- Display strings are **derived** from the def via `getItemDisplay(id)` — no hand-maintained label tables.
- A validator catches typo'd item ids in floors, loot tables, vendor catalogs, and recipes at test time.
- The published add-an-item procedure becomes three steps, with file count = 1 (or 2 if a type-registry export is needed).

Zero behavioural change to gameplay — this is purely a data/display refactor. Stashes, equipment, combat, and run-history all keep working identically.

## Why now

The pattern hits a non-linear pain cliff as the item count grows. At ~20 items today, adding one means touching 5–7 files; at ~100 items (which the GDD's full weapon/armor/potion roster implies), it's the same per-item cost. The display tables would be a maintenance sinkhole.

The bow bug is the concrete evidence that the current pattern can ship silent breakage. The fix is structural, not a checklist.

## Out of scope

- Schema migration. No DB changes — `gear_stash` rows already store opaque item ids; meaning stays unchanged.
- New items. This sprint changes how items are described, not what items exist.
- Magic / enhanced / unique-named variants. The new shape makes them trivial later (one spread), but no magic items ship in this sprint.
- Inventory tooltips, drag-drop UX, hotbar polish.
- Replacing `WEAPON_REGISTRY`, `ARMOR_REGISTRY`, etc. — those stay as the type-organized export surfaces. `ITEM_REGISTRY` is the new union, not a replacement.

## Design decisions

### Two taxonomic axes: `category` and `type`

Every item def gains `category: 'weapon' | 'armor' | 'shield' | 'consumable' | 'material'` — the top-level discriminator the registry and display formatter switch on.

In the same sprint, **rename `weapon.kind` → `weapon.type`** so every item type uses a single consistent sub-discriminator name. After the rename:

| category     | type values                                                  |
|--------------|--------------------------------------------------------------|
| `weapon`     | `'melee' \| 'ranged'`                                        |
| `armor`      | `'light' \| 'medium' \| 'heavy'`                             |
| `consumable` | `'healing' \| 'bless' \| 'longstrider' \| 'false_life' \| 'extract'` |
| `shield`     | (omitted — category alone is enough)                         |
| `material`   | (omitted — category alone is enough)                         |

Today's `shield.type = 'shield'` and `material.type = 'material'` redundant fields are removed; callers that need to discriminate use `category`.

The `kind → type` rename is a mechanical sweep across ~6 files: `shared/logic/combat.js`, `server/systems/CombatSystem.js`, `client/src/scenes/InventoryScene.js`, `client/src/scenes/DungeonScene.js`, `shared/tests/combat.test.js`, `server/tests/dead-letter.test.js`, plus JSDoc in `shared/types/weapon.js`. Ship it as commit #1 of the sprint — no logic change, just makes the rest of the plan describable in two axes instead of three.

Enum (not duck-type) on both axes because the validator and the display formatter both want exhaustive switches.

### Display is derived, not stored

The renderer never owns metadata. `getItemDisplay(id)` returns `{ label, detail, note?, section, sortKey }` computed from the def. The five display tables in `InventoryScene.js` and the three exports in `hub-data.js` collapse to lookups.

When a fact genuinely isn't derivable (the human-tuned `"stealth disadv."` armor note, the `"effective vs. skeletons"` mace hint), it lives on the def as a `note: string` field. Lossless migration — every hand-tuned string today is captured.

### `ITEM_REGISTRY` is a barrel union, not a replacement

`WEAPON_REGISTRY`, `ARMOR_REGISTRY`, `SHIELD_REGISTRY`, `CONSUMABLE_REGISTRY`, `MATERIAL_REGISTRY` continue to exist and continue to be where type-specific code looks (equipment slot routing, hotbar binding). `ITEM_REGISTRY` in `shared/data/items/index.js` is the union, queried by display layers and validators that want "is this thing an item at all?".

Two-layer naming keeps the type-specific files small and the global lookup possible.

### `values.js` becomes a derived view

`ITEM_GOLD_VALUE` keeps its export (callers like `shop.js` rely on it) but is built once at module load from `ITEM_REGISTRY[id].goldValue`. `sellPrice(id)` is unchanged in signature; internally it reads the registry.

### Stash sort order is explicit per-item

`STASH_ORDER` today is a hand-maintained array. After the refactor: sort by `(category, sortKey, label)`, where **every item def carries an explicit `sortKey: number`**. No default-from-stats fallback — relying on `damageDice.sides` would reshuffle the current weapon order (dagger→sword→bow→longsword→greataxe→greatsword) into a damage-die-size order that doesn't match the current "iconic → exotic" feel, and a "derive with manual override on every weapon" scheme is the worst of both worlds.

The sort key is just an integer per item. Cheap to write, trivial to reorder, no hidden formula. Group conventions (weapons 100–199, armor 200–299, etc.) keep the file readable.

### `STASH_SECTIONS` becomes derived

A small function `getStashSections()` walks `ITEM_REGISTRY` and groups by `category`. The four sections (Weapons / Armor & Shield / Potions / Materials) come from category names + a fixed display order at the top of `hub-data.js`.

### Crafting integrates with `ITEM_REGISTRY` as a first-class consumer

Crafting is the next major itemization-adjacent system (six benches declared in `BENCH_REGISTRY`, only forge + apothecary `open`, two recipes total today). It will grow item-by-item the same way the weapon/armor lists have — and it'll do so against this new registry, not by re-declaring item facts.

The sprint locks in the contract so future crafting work doesn't reintroduce the duplication problem:

- **Recipe inputs and outputs are item ids only.** No inline item shape on recipes, no parallel label/value tables. Recipes carry `{ id, qty }` tuples; the renderer pulls labels via `getItemDisplay`.
- **Validator enforces every recipe id resolves in `ITEM_REGISTRY`.** Both `inputs[*].id` and `output.id`. Catches future-recipe typos at test time the same way it catches floor-chest typos.
- **Output category is consistent with usage.** When a recipe's output is then "equippable" (Tan Hide → leather armor, future Forge Sword → longsword variants), the validator checks the output's `category` is one the crafting UI knows how to render. Two-line check; future-proofs the moment crafting starts producing items it didn't previously produce.
- **Materials are first-class items.** When a future material lands (`iron_ingot`, `cloth_scrap`, `dragon_scale`), it follows the same one-file flow: write the def in `materials.js` with `category: 'material'`, add to `MATERIAL_REGISTRY`, done. Stash, sell, recipe-input — all work automatically.
- **Magic / enhanced outputs use the spread pattern.** `MAGIC_SHORTBOW = { ...SHORTBOW, id: 'shortbow_+1', label: 'Shortbow +1', enhancement: 1, goldValue: SHORTBOW.goldValue * 4 }`. Already covered by the design — calling it out so crafting recipes that produce them inherit the entire flow for free.

The crafting domain doesn't ship anything new in this sprint. The plan just makes sure the seams it'll need exist and the validator covers them now, while there are only two recipes to verify against.

## Implementation

### 1. Extend every item def (`shared/data/*`)

Touches: `weapons/melee.js`, `weapons/ranged.js`, `armor/armor.js`, `items/shields.js`, `items/consumables.js`, `items/materials.js`.

Each item def gains:
- `category` — new field. `'weapon'` / `'armor'` / `'shield'` / `'consumable'` / `'material'`.
- `label` — already on armor/shields/consumables/materials; **add to weapons** (currently missing — label was carried in display tables).
- `goldValue` — already in `values.js`; **moved onto the def**. `values.js` still exports `ITEM_GOLD_VALUE`, derived once at module load.
- `note?` — optional hand-tuned hint string, used when the derived detail isn't enough. Captures every hand-tuned string from today's display tables (e.g. `"effective vs. skeletons"` on mace, `"stealth disadv."` on heavy armor).
- `sortKey` — required integer for within-category sort order.

Also in this step (commit #1): rename `weapon.kind` → `weapon.type` per the design decision above. Sweep the ~6 referring files; remove the redundant `shield.type = 'shield'` and `material.type = 'material'` fields.

Per-category required fields stay otherwise unchanged. JSDoc updates in `shared/types/weapon.js`: rename `kind` → `type`, add `label`, `goldValue`, `note?`, `sortKey`.

### 2. New: `shared/data/items/index.js`

```js
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

export const isKnownItem = (id) => Object.hasOwn(ITEM_REGISTRY, id);
export const getItem     = (id) => ITEM_REGISTRY[id] ?? null;
```

The spread order is the type-precedence order. Collisions are forbidden — the validator (§5) asserts disjoint id namespaces across registries.

### 3. New: `shared/logic/item-display.js`

```js
/**
 * Per-category formatters. Each returns { detail, section, defaultSortKey }
 * from the canonical def. All facts come from the def — no string tables.
 */
export function getItemDisplay(itemId) {
  const def = ITEM_REGISTRY[itemId];
  if (!def) return null;
  const fmt = FORMATTERS[def.category];
  const { detail, defaultSortKey } = fmt(def);
  return {
    id: itemId,
    label: def.label,
    detail,
    note: def.note ?? null,
    section: SECTION_FOR_CATEGORY[def.category],
    sortKey: def.sortKey ?? defaultSortKey,
  };
}
```

Five formatters — `weapon`, `armor`, `shield`, `consumable`, `material`. Each is ~10 lines, pure, deterministic. Examples:

- `weapon` → `"1d6 piercing"` from `damageDice` + `damageType`; `type === 'ranged'` appends `"ranged 80/320"` from `range`.
- `armor` → `"AC 11+DEX light"` from `baseAC` + `type`; flags appended via `note` field on def.
- `consumable` → `"2d4+2 HP"` (healing), `"+1d4 atk 60s"` (bless), etc. — derived from `damageDice` + `diceBonus` + `conditionDurationMs` keyed off `type`.
- `material` → `"crafting material"` (constant; the only category where the string is genuinely hard-coded).

**Column-alignment caveat.** Today's `ITEM_META.detail` strings use deliberate double-spacing (`'AC 11+DEX  light'`) for visual column alignment in the stash list. The formatter should preserve that exact spacing convention so the stash view is byte-identical post-refactor. The playtest checklist eyeballs this on one armor row.

**Behaviour note on `extraction_scroll`.** It's in `CONSUMABLE_REGISTRY` but absent from today's `ITEM_META`/`STASH_ORDER`/`STASH_SECTIONS`, so it currently can't appear in the stash list. After the refactor, `getStashSections()` will surface it automatically. This is a deliberate (small) behaviour change — extraction scrolls held at extract will now appear in stash under Potions/Scrolls. If we want to keep them invisible, add `hideInStash: true` on the def and skip in `getStashSections`. Default plan: surface them.

`ARMOR_SLOT_DISPLAY` (the long-sentence equipped-armor label in `InventoryScene`) gets its own formatter `getArmorSlotDescription(armorDef)` in the same module — same input, different verbosity.

### 4. Migrate display layers

**`client/src/scenes/InventoryScene.js`**
- Delete `WEAPON_DISPLAY`, `SHIELD_DISPLAY`, `CONSUMABLE_DISPLAY`, `ARMOR_BAG_DISPLAY`, `MATERIAL_DISPLAY`, `ARMOR_SLOT_DISPLAY` — 6 tables, ~80 LOC.
- Replace lookups with `getItemDisplay(id)` and `getArmorSlotDescription(armorDef)`.
- `FINESSE_IDS` and `MONK_WPNS` are behaviour gates, not display — they stay (or get derived from weapon properties, but that's a separate clean-up).

**`client/src/ui/hub/hub-data.js`**
- `ITEM_META` → derived export: `export const ITEM_META = buildItemMeta()` where the function walks `ITEM_REGISTRY` and produces `{ id → { label, detail } }`.
- `STASH_ORDER` → derived export: `getStashOrder()` returns ids sorted by `(category, sortKey, label)`.
- `STASH_SECTIONS` → derived export: `getStashSections()` returns `[{ label, ids: Set<...> }]` keyed off `category`.

If panels read these as plain exports today, the derived versions can preserve the same shape so panel code doesn't change.

### 5. New: `shared/tests/items.test.js`

Validator coverage:

1. **Every item has required fields.** For each entry in `ITEM_REGISTRY`: `id`, `category`, `label` (non-empty), `goldValue` (number ≥ 0).
2. **Per-category required fields.** Weapon → `type` (`'melee' | 'ranged'`), `damageDice`, `damageType`, `attackAbility`; `type === 'ranged'` also requires `range`. Armor → `type` (`'light' | 'medium' | 'heavy'`), `baseAC`. Shield → `acBonus`. Consumable → `type` (one of the consumable type values). Material → just the base.
3. **id matches map key.** `ITEM_REGISTRY[key].id === key` for every entry.
4. **Disjoint namespaces.** No id appears in two type-registries. (Spread-merge would silently shadow today.)
5. **`getItemDisplay` returns a complete shape** for every item — no `undefined` labels, sections, or details.
6. **Reference integrity** — every item id referenced from external data resolves in `ITEM_REGISTRY`. Catches `'shotbow'` typos before they ship. Sources walked:
   - `FLOOR_REGISTRY[*].chests[*].items[*]`
   - `LOOT_TABLE_REGISTRY[*]` literal entries (skip `@pool_name` references)
   - `VENDOR_CATALOG[*].id` (every vendor section)
   - `RECIPE_REGISTRY[*].inputs[*].id` and `.output.id` — both sides of every recipe
7. **Recipe output category sanity** — every `RECIPE_REGISTRY[*].output.id` resolves in `ITEM_REGISTRY` *and* its `category` is in the explicit whitelist `{'weapon', 'armor', 'shield', 'consumable', 'material'}` (i.e. all five — recipes can produce anything in the registry, but the whitelist makes it impossible for an output to silently fall outside the known categories if a sixth category is added later without updating the crafting UI). Today's two recipes (Tan Hide → `hide` armor, Bone Brew → `false_life_potion` consumable) both pass.
8. **Recipe bench reference** — every `RECIPE_REGISTRY[*].bench` resolves in `BENCH_REGISTRY`. (Field is `bench`, not `benchId`, per `shared/data/crafting/recipes.js`.) Separate registry, same validator file — keeps the "all crafting data references are checked at test time" guarantee in one place.

### 6. Migrate `shared/data/values.js`

```js
import { ITEM_REGISTRY } from './items/index.js';

export const ITEM_GOLD_VALUE = Object.freeze(
  Object.fromEntries(
    Object.entries(ITEM_REGISTRY).map(([id, def]) => [id, def.goldValue ?? 0]),
  ),
);

// sellPrice and SELL_RATIO unchanged.
```

`shop.js` keeps reading `ITEM_GOLD_VALUE`. Zero call-site changes.

### 7. Documentation

Add `docs/agent-context/itemization.md` with:
- The three-step add-item procedure.
- A worked example (adding a hypothetical crossbow).
- The category → display-formatter mapping table.
- Pointers to the validator (`shared/tests/items.test.js`) and the registry barrel.

Update:
- `CLAUDE.md` Agent Task Context — add itemization.md to the docs map row covering inventory.
- `docs/agent-context/inventory-loot.md` — replace the "Item Registries" section's per-type listing with a one-liner pointer to `itemization.md`.

## Adding a new item — before vs after

**Before (today, for the shortbow):**

1. Write def in `shared/data/weapons/ranged.js`.
2. Add to `WEAPON_REGISTRY` in `weapons/index.js`.
3. Add to `ITEM_GOLD_VALUE` in `shared/data/values.js`.
4. Add to `WEAPON_DISPLAY` in `client/src/scenes/InventoryScene.js`.
5. Add to `ITEM_META` in `client/src/ui/hub/hub-data.js`.
6. Add to `STASH_ORDER` in `client/src/ui/hub/hub-data.js`.
7. Add to `STASH_SECTIONS` Weapons set in `client/src/ui/hub/hub-data.js`.

Seven edits. Forgetting any silently breaks one rendering surface.

**After (target):**

1. Write def in `shared/data/weapons/ranged.js` (with `category`, `type`, `label`, `goldValue`, `sortKey`, `note?`).
2. Add to `WEAPON_REGISTRY` (still part of the same file, but in the export block).
3. (Buyable only) Add id to a vendor list in `shop.js`.

One file for the common case, two for buyables. Forgetting an edit fails the validator at test time, not at runtime.

## Testing

### Unit (`shared/tests/items.test.js`, new)

Six validator suites per §5. ~80 LOC, all pure.

### Migration regression

Every existing test suite continues to pass without modification. The contract changes (label location, value location) are all type-internal — `WEAPON_REGISTRY[id].damageDice` still works, `ARMOR_REGISTRY[id].baseAC` still works, etc. The only field that *moves* between layers is `goldValue`, and `ITEM_GOLD_VALUE` keeps its public shape.

### Manual playtest checklist

Run `npm start`, fighter class.

- [ ] **Stash sanity**: existing extracted items still render correctly (label, detail, section, order). Bows from prior runs still visible.
- [ ] **Loot a chest**: every item type renders in the dungeon bag — weapon, armor, shield, potion, material.
- [ ] **Equip a weapon → bag label, slot label, AC strip all match the pre-refactor visuals.** (Eyeball comparison; if anything regresses, the formatter is wrong, not the data.)
- [ ] **Sell every category in the shop**: gold value matches `ITEM_REGISTRY[id].goldValue`.
- [ ] **Equipped armor "slot description"** (the long sentence with stealth / STR-req notes) reads correctly for all 12 armors.
- [ ] **Buy a potion**: catalog price, completion message, sell-back value all consistent.
- [ ] **Extract**: every carried item lands in the stash and is sellable.
- [ ] **Reference-integrity validator** caught a planted typo (commit a `'shotbow'` in a chest temporarily, confirm `npm test` fails, revert).
- [ ] **Recipe validator** catches a planted bad recipe — change a `RECIPE_REGISTRY` output id to `'shotbow_+1'` temporarily, confirm validator fails, revert.
- [ ] **Craft a Tan Hide and a Bone Brew** through the crafting UI; verify both outputs render in the bag with proper labels via `getItemDisplay` (no regression from the old hand-tuned strings).

## Doc updates required after merge

- `docs/agent-context/itemization.md` — new doc, lands as part of the sprint.
- `CLAUDE.md` Docs Map — add the itemization.md row.
- `docs/agent-context/inventory-loot.md` — replace per-type registry listing with a pointer.
- `docs/PROJECT_STRUCTURE.md` — add `shared/data/items/index.js`, `shared/logic/item-display.js`, `shared/tests/items.test.js`; update test counts.
- `CHANGELOG.md` — Session N entry.
- Move this file to `docs/archive/` once shipped.

## Estimated scope

- ~20 items × small frontmatter additions: ~60 LOC of data churn (pure additions to defs).
- New files: `items/index.js` (~15 LOC), `item-display.js` (~120 LOC), `items.test.js` (~150 LOC — eight validator suites including crafting reference checks).
- Deletions in `InventoryScene.js`: ~100 LOC (six display tables) replaced with ~30 LOC of lookups.
- `hub-data.js`: ~40 LOC of hand-listed exports replaced by ~30 LOC of derivation.
- `values.js`: 30 LOC → 10 LOC.

Net diff: roughly +200 LOC added (mostly the new formatter + validator), ~150 LOC removed (display tables + hand-maintained ordering), with the working-on-items surface area dropping from 7 files to 1. Tests grow by ~120 LOC of validation.

Single sprint. No half-state is shippable — display layer reads from the new helpers or the old tables, not both.
