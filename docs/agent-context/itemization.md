---
status: shipped
updated: 2026-05-17
purpose: How items are defined, displayed, sorted, and referenced. Read when the task touches item data, display strings, gold values, stash layout, vendors, or crafting recipes.
---

# Itemization

The single registry of every item — weapon, armor, shield, consumable, material — is `ITEM_REGISTRY` in `shared/data/items/index.js`. It is the union of the five type-specific registries (`WEAPON_REGISTRY`, `ARMOR_REGISTRY`, `SHIELD_REGISTRY`, `CONSUMABLE_REGISTRY`, `MATERIAL_REGISTRY`), each owning the equip / hotbar / AC-math semantics for its category.

Every display string in the game is derived from the item def via `shared/logic/item-display.js`. There are no hand-maintained label/detail/sort tables anywhere else.

## Two taxonomic axes: `category` and `type`

Every item def carries `category` (top-level discriminator) and — where it adds information — `type` (sub-discriminator within category).

| category     | type values                                                          | type meaning              |
|--------------|----------------------------------------------------------------------|---------------------------|
| `weapon`     | `'melee' \| 'ranged'`                                                | attack-mode dispatch      |
| `armor`      | `'light' \| 'medium' \| 'heavy'`                                     | AC computation rule       |
| `consumable` | `'healing' \| 'bless' \| 'longstrider' \| 'false_life' \| 'extract'` | server consume branch     |
| `shield`     | —                                                                    | (category alone suffices) |
| `material`   | —                                                                    | (category alone suffices) |

Validator (`shared/tests/items.test.js`) enforces both axes.

## Required fields on every def

| field       | type                                                                 |
|-------------|----------------------------------------------------------------------|
| `id`        | string, must match its key in the type-specific registry             |
| `category`  | one of the five values above                                         |
| `label`     | non-empty string — single source of truth for the item's display name |
| `goldValue` | number ≥ 0 — buy price; also drives `sellPrice()` via `ITEM_GOLD_VALUE` |
| `sortKey`   | integer; lower sorts first within its category                       |
| `note?`     | optional hand-tuned hint shown in the equipped-weapon slot           |

Per-category required fields are listed in the validator. Add a sixth field on an existing category and the validator will need a parallel assertion.

## Adding a new item — three steps

1. **Write the def** in the right file (`shared/data/weapons/{melee,ranged}.js`, `shared/data/armor/armor.js`, or `shared/data/items/{shields,consumables,materials}.js`). Include every required field above; for the type-specific fields see a sibling def.
2. **Add it to the type-specific registry** in the same file (e.g. `WEAPON_REGISTRY = { ..., new_thing: NEW_THING }`).
3. *(Buyable only)* Add the id to a vendor's id list in `shared/data/shop.js`.

Stash row, sort order, sell price, gold value, display string, hub stash section, recipe-input target — all derive automatically. Forgetting any step fails `node shared/tests/items.test.js`, not runtime.

### Worked example: adding a crossbow

```js
// shared/data/weapons/ranged.js
export const LIGHT_CROSSBOW = {
  id: 'light_crossbow',
  category: 'weapon',
  type: 'ranged',
  label: 'Light Crossbow',
  damageDice: { count: 1, sides: 8 },
  damageBonus: 0,
  damageType: 'piercing',
  enhancement: 0,
  attackAbility: 'dex',
  properties: ['two-handed', 'loading'],
  range: { normal: ft(80), long: ft(320) },
  goldValue: 25,
  sortKey: 175,             // sits between shortbow (170) and longbow (180)
  note: 'ranged 80/320, two-handed',
};
```

Then in `WEAPON_REGISTRY`:
```js
export const WEAPON_REGISTRY = {
  ..., longbow: LONGBOW, light_crossbow: LIGHT_CROSSBOW,
};
```

If buyable, add `'light_crossbow'` to a vendor list in `shop.js`. Done — it appears in the stash list in the right section, sorted between shortbow and longbow; the formatter produces `'1d8  piercing'` for its detail; `ITEM_GOLD_VALUE.light_crossbow === 25`; `sellPrice('light_crossbow') === 6`.

## Display formatters

`shared/logic/item-display.js` exposes:

| function                           | returns                                                                 |
|------------------------------------|-------------------------------------------------------------------------|
| `getItemDisplay(id)`               | `{ id, label, detail, note, section, sortKey, category }` or `null`     |
| `getArmorSlotDescription(def)`     | long-form description for the equipped-armor line (`'Plate — AC 18  (heavy, stealth disadv., STR 15)'`) |
| `getStashOrder()`                  | flat sorted id array — `(category-order, sortKey, label)`               |
| `getStashSections()`               | `[{ label, ids: Set<string> }]` for the stash list grouping            |

Per-category detail formatters live inside the same module:

| category     | detail derived from                                              | example                          |
|--------------|------------------------------------------------------------------|----------------------------------|
| `weapon`     | `damageDice` + `damageType`                                      | `'1d8  slashing'`                |
| `armor`      | `baseAC` + `type` (light/medium/heavy)                           | `'AC 11+DEX  light'`             |
| `shield`     | `acBonus`                                                        | `'+2 AC'`                        |
| `consumable` | `type`-keyed branch (healing/bless/longstrider/false_life/extract) | `'2d4+2 HP'`, `'+1d4 atk 60s'` |
| `material`   | constant                                                         | `'crafting material'`            |

The bag-row label, hub stash row, hotbar short label, and equipped-armor description all flow from these formatters. Renaming a potion or restating its dice happens once in the def.

## Stash sort

`sortKey` is an explicit integer per item. There is no derive-from-stats fallback — the current order ("iconic → exotic") wouldn't reproduce from `damageDice.sides`, and a "derive with override on every item" rule is the worst of both worlds. Reorder by editing the integer.

Current group conventions:

| range   | category   |
|---------|------------|
| 100–199 | weapons    |
| 200–299 | armor      |
| 300–399 | shields    |
| 400–499 | consumables |
| 500–599 | materials  |

## Gold value

`shared/data/values.js` exposes `ITEM_GOLD_VALUE` and `sellPrice(id)` as it always did, but the map is now derived once at module load from `ITEM_REGISTRY[id].goldValue`. To change a price, edit the def. Shop, stash sell-back, and run-history value calculations all read through.

## Recipes

`RECIPE_REGISTRY` (`shared/data/crafting/recipes.js`) carries `{ inputs: [{id, qty}], output: {id, qty}, bench }` only — no inline item shape on recipes, no parallel label/value tables. The validator enforces that every input id, output id, and `bench` resolves in the corresponding registry, so a typo in a recipe fails at test time rather than crashing the crafting UI.

When a future recipe produces an equippable item (e.g. a Forge Sword recipe outputting a `longsword_+1`), the validator's "output category must be in `{weapon, armor, shield, consumable, material}`" check fires on every entry — keeping the crafting domain in lockstep with the registry as recipes expand.

## Validator (`shared/tests/items.test.js`)

Eight suites, all pure data checks — run as part of `node shared/tests/items.test.js`:

1. Every item has the required base fields (`id`, `category`, `label`, `goldValue`, `sortKey`).
2. Per-category required fields (weapon: `type`+`damageDice`+`damageType`+`attackAbility`, ranged also `range`; armor: `type`+`baseAC`; shield: `acBonus`; consumable: `type`; material: base only).
3. `def.id === key` for every type-specific registry entry.
4. Disjoint id namespace across the five type-specific registries.
5. `getItemDisplay` returns a complete shape for every item.
6. Reference integrity: every chest item in `FLOOR_REGISTRY`, every literal loot-table itemId (skipping `@pool_name` refs), every vendor id resolves in `ITEM_REGISTRY`.
7. Recipe input/output ids resolve in `ITEM_REGISTRY`; output `category` is in the known whitelist.
8. Recipe `bench` resolves in `BENCH_REGISTRY`.

99 assertions today.

## See also

- `agent-context/inventory-loot.md` — inventory + hotbar + container protocol (uses item ids; what they mean lives here).
- `agent-context/hub-economy.md` — shop buy/sell prices and crafting flow that consume `ITEM_GOLD_VALUE` and `RECIPE_REGISTRY`.
- `archive/itemization-plan.md` — original sprint plan with the design decisions and trade-off discussion. Frozen at sprint completion.
