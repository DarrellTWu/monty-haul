---
status: shipped
updated: 2026-05-14
purpose: Shop, crafting, hub gold, stash mutations, Debug Mode toggle. Read when the task touches the hub UI or hub-side state.
---

# Hub Economy, Crafting, Settings

## Pricing Source of Truth
`shared/data/values.js`:
- `ITEM_GOLD_VALUE` — SRD prices for weapons/armor/potions, nominal values for materials.
- `sellPrice(id)` — ¼× value, floor, min 1 gp.

Both shop buy prices and stash sell prices read from this map — single source, no drift.

## Shop
`shared/data/shop.js`:
- `VENDOR_CATALOG` — keyed by vendor (`potions`, `armor`); each entry `{ id, price }` computed from `ITEM_GOLD_VALUE`.
- `BUYABLE_PRICES` — flat `{ itemId → price }` map derived from every vendor's entries. **Used server-side to gate `/buy`.** Add a new buyable item by editing id arrays in `shop.js`; the server picks it up automatically.

## Crafting Benches
`shared/data/crafting/benches.js`:
- `BENCH_REGISTRY` — six benches with `status: 'open' | 'planned'`.
- Planned benches render a "Coming soon" placeholder in the Craft sub-screen.
- Six benches: **forge, binder, artificer, apothecary, scriptorium, refinery**.

Currently open: forge, apothecary. Others awaiting recipes.

## Recipes
`shared/data/crafting/recipes.js`:
- `RECIPE_REGISTRY` keyed by recipe id.
- Shape: `{ id, label, bench, inputs: [{ id, qty }], output: { id, qty } }`.
- `recipesForBench(benchId)` filters by bench.
- New recipes are pure data — no logic to write.
- Current recipes: Tan Hide (forge), Bone Brew (apothecary).

## Stash Mutation Flow
All mutations: `client/src/store/stash.js` → `server/routes/hub.js` → `server/store/playerStore.js`.

- `buyItem(id)`, `sellItem(id)`, `craftRecipe(recipeId)`, `dumpRaiderPackToStash()` — all async.
- Most return `Promise<bool>`. **`renameUser(newUsername)` returns full `{ ok, username?, error? }`** so the UI distinguishes `username_taken` / `invalid_username` / network failure.
- Client sends **ids only**; server resolves canonical prices from `BUYABLE_PRICES` / `sellPrice()` and recipe internals from `RECIPE_REGISTRY`.
- Per-player mutation lock in `playerStore._withLock` serializes concurrent same-player writes.

Inconsistency to be aware of: the architecture review (§3.1) flags that boolean returns on buy/sell/craft prevent specific error messaging in the UI. Normalize to `{ ok, error? }` if you're touching this layer.

## Hub Settings: Debug Mode Toggle
Settings panel in `HubScene.js` (`_renderMenuBody`) shows a DEBUG MODE row with `[ ON ]` (yellow, locked) and `[ OFF ]` (dim, non-interactive).

This toggle is the **routing hook** for which dungeon `[ Enter Dungeon ]` loads:

- **ON** (current behavior) → today's testing/tuning dungeon — Floor 1 + Floor 2 from `FLOOR_REGISTRY`, full loot, all classes unlocked, tuned for combat testing.
- **OFF** (DEFERRED — not built) → intended end-user gameplay — production dungeon with matchmaking, fresh-party rooms, production loot tuning, intended difficulty curve.

The production gameplay path doesn't exist yet, which is why OFF is locked. When it lands:
1. Make `[ OFF ]` interactive
2. Persist the toggle state (likely in `client/src/store/stash.js`)
3. Branch on it inside `_buildRaiderPanel`'s `[ Enter Dungeon ]` `pointerdown` handler before `this.scene.start('DungeonScene', ...)`

## See also — historical context
`archive/hub-settings-plan.md` — original feature plan for the Settings panel (rename + logout + Debug Mode placeholder). Read only if you need: the Phase 1/Phase 2 split decisions, the original modal/keyboard interaction design, or why Debug Mode was chosen as a routing hook rather than a real persisted setting. Covers settings only — shop and craft were built incrementally without a corresponding sprint plan. Frozen at sprint completion (2026-05-11).
