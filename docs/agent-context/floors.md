---
status: shipped
updated: 2026-07-13
purpose: Floor data, boot validation, unlock conditions, descend flow, long rest, level-up gate, Scroll of Extraction. Read when the task touches floor progression or run termination.
---

# Floor System

## Data Shape
Floors are declarative data in `shared/data/floors/` keyed by floor number in `FLOOR_REGISTRY`. Each floor:

```js
{ width, height, playerSpawn, enemies, chests, traps, stairs, walls, doors, platforms, rooms }
```

Add a new floor by adding a file + registry entry. **No logic changes.**

## Boot Validation
`validateFloorData(FLOOR_REGISTRY, { enemyTypes, isKnownItem })` in `shared/logic/validate-floors.js` runs at server startup (`server/index.js`) and refuses to boot on any error: required keys, spawn in bounds, unique entity ids per floor, enemy types resolve in `ENEMY_REGISTRY`, chest items resolve in `ITEM_REGISTRY`, stair targets exist (or `unlock: { kind: 'never' }`), unlock kinds known, door/wall/platform rects well-formed. Test suite: `shared/tests/floors.test.js` (also asserts the shipping registry validates clean).

## Loading (`DungeonRoom._loadFloor(n)`)
- Clears entity MapSchemas (guarded on `size > 0` to avoid an `OPERATION.CLEAR` patch poisoning the initial sync — see commit `f2a8d12`).
- Repopulates from floor data.
- Sets `state.floor = n` and updates `_bounds` for `MovementSystem`.
- Initial `onCreate` calls `_loadFloor(1)`.

## Unlock Conditions (stairs + doors)
Declarative `unlock` field on stair/door defs, evaluated per tick by `DungeonRoom._tick` via `shared/logic/unlock.js` (replaced `lockedUntilAllEnemiesDead` and the `_permanentlyLockedStairs` stopgap, 2026-07-13):

- `unlock: { kind: 'enemies_cleared' }` — starts locked; opens on the first tick every enemy on the floor is dead. Broadcasts `"Stair to Floor N unlocked."` / `"A door unlocks."` once.
- `unlock: { kind: 'never' }` — starts locked, never auto-opens (floor 3's stair to unbuilt floor 4).
- absent — starts unlocked. Doors may still declare static `locked: true` (never opens without an unlock def).

New kinds (lever, key item, per-room clear) are added in `unlock.js` + the ctx `_tick` builds; floor files only select them. Unknown kinds fail closed and the boot validator rejects them.

## Descend Flow
`descend { stairId }` → `_loadFloor(toFloor)` → teleports all players to the new spawn → applies `_longRest`:

- HP → maxHp
- tempHp → 0
- Second Wind + Action Surge refreshed (feature-gated via `getGrantedFeatures`)
- Rage uses reset via `getRageUsesMax` (2, or 3 at Barbarian 3); ki refilled via `getKiMax` (= monk level)
- All conditions dropped — timed ones (rage, bless, longstrider, false_life, patient_defense, dash) plus the Reckless toggle

Then, for every **alive** player, `_descendTo` sets `pendingLevelUp = true`. While that flag is true:

- Server drops `move` and `attack` messages from that player.
- Client locks input and opens `LevelUpModal` after the new floor finishes rendering (`DungeonScene._maybeOpenLevelUpModal`).
- Player picks a class → client sends `choose_level_up { classId }` → server validates, calls `applyClassLevel`, refills HP to new max, recomputes AC, clears the flag, seeds new features onto the hotbar, broadcasts the build summary.

Dead players keep `pendingLevelUp = false` and skip the modal. See `agent-context/combat.md` (Level-Up + Multiclass) for the data flow.

Broadcasts a long-rest combat-log line at the start of descent.

## Client Reaction to Floor Change
- `DungeonScene` detects `state.floor` change in `state.onChange` → `_applyFloorLayout` redraws the room background and resets camera bounds.
- Per-entity `onRemove` handlers translate the server's CLEAR ops into per-entity gfx destroy.

## Extraction (Scroll of Extraction)
- `extraction_scroll` is a `type: 'extract'` consumable in `shared/data/items/consumables.js`.
- `use_hotbar { slot }` with an `extract` consumable sets `state.phase = 'complete'`, ending the run.
- Server commits stash + gold via `playerStore.commitExtract` (in the per-player lock; failure logs to dead-letter).
- The `@potion_any` loot pool filters out `type === 'extract'` (Scroll is run-control, not loot).

## Floor 2 Tuning
Floor 2 contents (1, 2, 4, 6, 8, 10 enemies per arm × 3 arms; entry chest with scroll + 10× each potion) are tuned for combat testing — **not final design**.

## Floor `kills`
Shipped 2026-07-13: `PlayerState.kills` increments per enemy killed (see `agent-context/combat.md` §Kill Attribution) and `_buildRunMeta` writes it to `run_history.kills`.

## See also — historical context
`archive/floor-2-plan.md` — original build plan for floor 2 + Scroll of Extraction. Read only if you need: the locked-decisions log (why scroll-only extraction was chosen over auto-complete-on-clear), the original message-protocol additions, or the three-commit build sequence. Frozen at sprint completion.
