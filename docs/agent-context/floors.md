---
status: shipped
updated: 2026-05-18
purpose: Floor data, descend flow, long rest, level-up gate, Scroll of Extraction. Read when the task touches floor progression or run termination.
---

# Floor System

## Data Shape
Floors are declarative data in `shared/data/floors/` keyed by floor number in `FLOOR_REGISTRY`. Each floor:

```js
{ width, height, playerSpawn, enemies, chests, traps, stairs, walls, doors, platforms, rooms }
```

Add a new floor by adding a file + registry entry. **No logic changes.**

## Loading (`DungeonRoom._loadFloor(n)`)
- Clears entity MapSchemas (guarded on `size > 0` to avoid an `OPERATION.CLEAR` patch poisoning the initial sync — see commit `f2a8d12`).
- Repopulates from floor data.
- Sets `state.floor = n` and updates `_bounds` for `MovementSystem`.
- Initial `onCreate` calls `_loadFloor(1)`.

## Stair Unlock
Stairs with `lockedUntilAllEnemiesDead: true` start `locked = true`. Flip to unlocked on the first tick where every enemy is dead; server broadcasts a `"Stair to Floor N unlocked"` combat-log line. Floors with no stairs (e.g. floor 2) are exit-only via Scroll of Extraction.

## Descend Flow
`descend { stairId }` → `_loadFloor(toFloor)` → teleports all players to the new spawn → applies `_longRest`:

- HP → maxHp
- tempHp → 0
- Second Wind refreshed
- Rage uses reset to class default (only if the player has any Barbarian level)
- All timed conditions dropped (rage, bless, longstrider, false_life)

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

## Floor `kills` (DEFERRED)
`_buildRunMeta` returns `kills: 0` literally. `run_history.kills` always 0. Attribution deferred.

## See also — historical context
`archive/floor-2-plan.md` — original build plan for floor 2 + Scroll of Extraction. Read only if you need: the locked-decisions log (why scroll-only extraction was chosen over auto-complete-on-clear), the original message-protocol additions, or the three-commit build sequence. Frozen at sprint completion.
