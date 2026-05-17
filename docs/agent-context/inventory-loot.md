---
status: shipped
updated: 2026-05-17
purpose: Inventory, hotbar, containers (chests + corpses), loot tables. Read when the task touches items, drops, or container interaction.
---

# Inventory & Loot

## Loot Tables
- Tables live in `shared/data/loot/tier1.js` keyed by enemy id (`LOOT_TABLE_REGISTRY`).
- Shape per enemy: `{ gold: { dice, bonus } | null, drops: [{ itemId, chance, qty }] }`.
- `itemId` accepts literal ids OR `@pool_name` references resolved by `shared/logic/loot.js` (currently only `@potion_any` → `CONSUMABLE_REGISTRY`, filtered to exclude `type === 'extract'`). Add new pools to the POOLS map in `loot.js`.
- `DungeonRoom._tick` calls `applyDeathLoot(enemies, rolledSet, LOOT_TABLE_REGISTRY, onDrop)` from `shared/logic/loot.js` each tick — idempotent via the room's `_lootRolled` Set guard. Enemies with no table drop nothing silently.
- All numeric tuning (dice, chances, gold ranges) lives in the table file, **not** in logic.

## Container Protocol (chests + corpses)
Pure protocol in `shared/logic/loot-window.js`:
- `tryOpenContainer` — claim lock
- `tryCloseContainer` — release lock
- `releaseLocksHeldBy(sessionId)` — on disconnect
- `tickContainerLocks` — auto-release when player out of range / dead
- `tryTakeItem`, `tryTakeGold`, `tryDropItem`
- `checkLootAccess`, `refreshSourceFlags`

`EnemyState.lockedBy` / `ChestState.lockedBy` carry the holder's `sessionId` (`''` = free).

## Inventory & Hotbar
- `PlayerState.inventory` — flat `ArraySchema<string>` of item ids (no qty field; duplicates are separate entries).
- `PlayerState.hotbar` — 10-slot `ArraySchema<string>` for ability/consumable ids.
- `assign_hotbar { itemId, slot }` — bind id to slot 0–9.
- `use_hotbar { slot }` — activate. Consumable types: `healing`, `bless`, `longstrider`, `false_life`, `extract` (run terminator — see `floors.md`).

## Client Bag Rendering (`InventoryScene`)
- Groups duplicate items into one row with `× N` qty (**display-only** — server inventory stays flat).
- Fixed-height scrollable viewport via shared `GeometryMask`, reachable by mouse wheel; mask cleared on drag-start, restored on drag-end.
- Double-click routes by item type: weapons/armor → `sendEquip`, consumables → `sendAssignHotbar` to first free slot, materials → no-op.

## Loot Mode (Inventory ↔ Container)
Launched by `DungeonScene` with `{ lootSource: { kind, id } }`. Replaces the left character-sheet column with a loot panel showing container gold and items.
- `[→ Drop]` buttons push bag items into the container.
- `sendOpenContainer` on scene create, `sendCloseContainer` on shutdown.
- `_lootHandshakeSeen` prevents premature auto-close before the server confirms the lock.

## Item Registries
- Weapons: `shared/data/weapons/{melee,ranged,index}.js`. `index.js` is the unified `WEAPON_REGISTRY` barrel; everything else imports from there.
- Armor: `shared/data/armor/armor.js`.
- Consumables / shields / materials: `shared/data/items/{consumables,shields,materials}.js`.
- `consumables.js` includes `extraction_scroll` (`type: 'extract'`).

## See also — historical context
- `archive/inventory-system-plan.md` — original build plan for inventory + hotbar + equipment slots. Read only if you need: the original data-model decisions (flat ArraySchema vs. stacked qty), the future server-side migration notes, or why the bag stacks displays-only rather than at the server schema. Frozen at sprint completion.
- `archive/loot-system-plan.md` — original build plan for loot tables + container protocol. Read only if you need: the locked decisions (gold-as-int, no rarity tiers yet, table-driven not loot-class-driven), the original message-protocol design (why `take_item` carries `itemIndex` rather than `itemId`), or the abandoned `loot_corpse` single-shot message. Frozen at sprint completion.
