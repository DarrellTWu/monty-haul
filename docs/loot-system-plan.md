# Loot System — Build Plan

## What We're Building

Monsters drop loot when killed. Each monster type has a loot table that defines:
- A gold roll (dice + bonus)
- A list of drops, each with an `itemId`, `chance`, and `qty`

Players loot corpses the same way they loot chests — walk close, press `F`. Surviving gold is added to a persistent hub wallet on extraction; lost on death.

This pass also introduces:
- A new item type — **crafting materials** (skeleton bone, wolf pelt) — interactable in the inventory like any other item
- **Gold tracking** — both run-scope (`player.gold`) and persistent (hub wallet)
- **Corpse looting** — new message + interaction layered on top of the existing chest pattern

---

## Locked Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Wolf vs new wolf enemy | Drop `wolf_pelt` from existing `dog` enemy. Rename later if needed. |
| 2 | Currency | Single `gold` integer. No cp/sp/ep/pp. |
| 3 | Goblin gold | **2d6** gp |
| 3 | Skeleton gold | **1d4** gp |
| 3 | Dog gold | **0** (beasts don't carry coin) |
| 4 | "Any potion" pool | Uniform random across `CONSUMABLE_REGISTRY` (healing, bless, longstrider, false_life) |
| 5 | Crafting materials | New `material` item type. **Interactable in dungeon inventory** — players can drop, rearrange, eventually craft mid-run. Stash-storable. Cannot equip / consume / hotbar. |
| 6 | Loot table location | Separate file: `shared/data/loot/tier1.js`. Keeps SRD stat blocks clean. |

---

## Loot Tables (initial)

```js
// shared/data/loot/tier1.js
goblin: {
  gold: { dice: { count: 2, sides: 6 }, bonus: 0 },
  drops: [
    { itemId: '@potion_any', chance: 0.25, qty: 1 },
  ],
}

skeleton: {
  gold: { dice: { count: 1, sides: 4 }, bonus: 0 },
  drops: [
    { itemId: 'skeleton_bone', chance: 0.75, qty: 1 },
  ],
}

dog: {
  gold: null,
  drops: [
    { itemId: 'wolf_pelt', chance: 0.75, qty: 1 },
  ],
}
```

The `@` prefix denotes a pool reference resolved at roll time. Today the only pool is `@potion_any` (any id in `CONSUMABLE_REGISTRY`). The convention scales: `@common_weapon`, `@tier1_armor`, etc. all become trivial to add.

---

## Architecture

### New shared/ files

**`shared/data/items/materials.js`**
```js
export const SKELETON_BONE = { id: 'skeleton_bone', label: 'Skeleton Bone', type: 'material' };
export const WOLF_PELT     = { id: 'wolf_pelt',     label: 'Wolf Pelt',     type: 'material' };
export const MATERIAL_REGISTRY = { skeleton_bone: SKELETON_BONE, wolf_pelt: WOLF_PELT };
```

**`shared/data/loot/tier1.js`** — `LOOT_TABLE_REGISTRY` keyed by enemy id (see above).

**`shared/logic/loot.js`** — pure functions:
```js
rollLoot(table, rng?) → { gold: number, items: string[] }
```
RNG injected for deterministic tests, matching the `combat.js` pattern. Pool references (`@foo`) resolve via a small built-in resolver.

**`shared/tests/loot.test.js`** — covers determinism with seeded RNG, pool resolution, expected drop rates over many trials within tolerance, gold roll distribution.

### Server

**`server/state/EnemyState.js`** — add fields:
- `lootGold: number` (default 0)
- `lootItems: ArraySchema<string>`
- `looted: boolean` (default false; flipped after first successful loot)

**`server/state/PlayerState.js`** — add field:
- `gold: number` (default 0, run-scope)

**`server/rooms/DungeonRoom.js`**:
- When an enemy's `alive` flips false (in `_tick` after `AISystem.update`, or at the kill site in `playerAttack`), look up `LOOT_TABLE_REGISTRY[enemy.type]` and call `rollLoot()`. Write results to `enemy.lootGold` / `enemy.lootItems`. No-op if no table exists for that type.
- New message handler: `loot_corpse { enemyId }`
  - Validate: enemy exists, `!alive`, `!looted`, player within `CHEST_LOOT_RANGE_PX` (reuse the constant; rename to `LOOT_RANGE_PX` if it bothers us — flag, don't rename in this pass)
  - Transfer `lootGold` → `player.gold`, push items into `player.inventory`
  - Set `looted = true`, clear the arrays

### Client

**`client/src/store/stash.js`** — new helpers:
- `getHubGold(): number`
- `addHubGold(n: number): void`
- `setHubGold(n: number): void` (rarely used; for resets)

Backed by new `mh_hub_gold` localStorage key. Same drop-in-Supabase migration story as the existing stash.

**`client/src/scenes/DungeonScene.js`**:
- Render dead enemies as visually distinct when lootable (corpse glow or small icon while `!looted && (lootGold > 0 || lootItems.length > 0)`).
- Generalize `_tryLootNearbyChest` → `_tryLootNearby`: scans both chests and corpses, picks closest within range, sends the right message.
- In `_onRunComplete`: read `player.gold`, call `addHubGold(player.gold)`. Add a "+N gold" line to the run summary panel.
- In `_onRunFailed`: nothing to do — gold is run-scope, dies with the raider.

**`client/src/scenes/HUDScene.js`** — small gold counter in a corner, reads `player.gold` from state.

**`client/src/scenes/HubScene.js`** — display total hub gold on the persistent right panel near the Enter Dungeon button.

**`client/src/scenes/InventoryScene.js`** — materials render alongside other bag items. Click behavior: same drop/move semantics as other items. No equip / hotbar affordances (just like weapons can't be hotbar'd). Materials are stash-eligible at run end via the existing `_collectItems` path.

### Loot table on enemy stat blocks

Stat blocks in `shared/data/enemies/*.js` stay untouched. The lookup is `LOOT_TABLE_REGISTRY[enemy.type]` server-side. Decoupled so that stat blocks remain pure SRD reference and loot tuning lives in one place.

---

## Message Protocol Additions

**Client → Server**
- `loot_corpse { enemyId }` — server validates death + range, transfers loot

**Server → Client**
- No new message — combat log already broadcasts kills; loot transfer is visible via state sync (`player.gold`, `player.inventory`, `enemy.looted`).

---

## Build Order

Each step independently verifiable. Three natural commits: shared, server, client.

| # | Layer | Module | Verify |
|---|---|---|---|
| 1 | shared | `data/items/materials.js` | Imports cleanly |
| 2 | shared | `data/loot/tier1.js` | Constants only, no logic |
| 3 | shared | `logic/loot.js` + `tests/loot.test.js` | `node shared/tests/loot.test.js` passes; expected rates within tolerance |
| 4 | server | `state/EnemyState.js` + `state/PlayerState.js` | Schema fields visible in client state inspector |
| 5 | server | `rooms/DungeonRoom.js` death hook + `loot_corpse` | Kill goblin, inspect `enemy.lootGold` / `lootItems`; loot it, gold transfers |
| 6 | client | `store/stash.js` hub gold helpers | localStorage round-trip in dev console |
| 7 | client | `DungeonScene.js` corpse render + F-to-loot | Full loop: kill → loot corpse → see items in inventory |
| 8 | client | `HUDScene.js` gold counter + run summary line | Visual: counter ticks up, summary shows "+N gold" |
| 9 | client | `HubScene.js` hub gold display + `InventoryScene.js` material rendering | Run completes → hub gold increases; materials visible in bag |

Steps 1–3 land first, can run independently with tests. 4–5 land second, testable with a manual kill. 6–9 land third, testable end-to-end.

---

## Out of Scope (This Pass)

- **Hub gold spending** — no vendors yet
- **Pre-loading in-run gold from hub** — no use case until vendors land
- **Loot scaling by floor** — no floor progression yet
- **Multi-player loot contention** — first-come-first-served on corpses matches existing chest behavior
- **Crafting recipes / crafting bench** — materials exist; what they're used for is a separate design pass
- **Server-side ownership validation of loot** — like `options.items` on join, the loot system trusts the room state (which the server fully controls). No new trust surface introduced.
- **Gold persistence to Supabase** — same migration story as stash; localStorage today, swap later

---

## Doc / Spec Updates (flag for after implementation)

When this lands, the following should be updated:

- **`docs/tech_spec.md`** — file structure: add `shared/data/items/materials.js`, `shared/data/loot/tier1.js`, `shared/logic/loot.js`. Note the `LOOT_TABLE_REGISTRY` pattern.
- **`CLAUDE.md`** — message protocol: add `loot_corpse`. PlayerState fields: add `gold`. EnemyState fields: add `lootGold`, `lootItems`, `looted`.
- **`docs/inventory-system-plan.md`** — out-of-scope section mentions "no mid-run pickup yet"; that line is now outdated.
