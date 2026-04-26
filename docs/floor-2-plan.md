# Floor 2 + Extraction Scroll — Build Plan

> **Scope note:** Both floors' contents (enemy counts, chest stock, sub-room layout, scroll placement) are tuned for combat testing and prototype iteration. Nothing here reflects the final design vision — the GDD's biome/cohort/extraction-ritual model supersedes all of this once we get there.

## What We're Building

- **Floor concept** added to the dungeon. One Colyseus room per run; `state.floor` tracks which floor is loaded; entities swap on descend. Floor data is declarative (`shared/data/floors/`).
- **Floor 1**: existing content + a locked staircase next to the chest. Unlocks when all floor-1 enemies are dead.
- **Floor 2**: debug/tuning room. Entrance chest contains a Scroll of Extraction + 10× each potion. Three arms (N/E/W) each holding 6 sub-rooms with 1, 2, 4, 6, 8, 10 enemies of one type (N=goblin, E=skeleton, W=dog).
- **Scroll of Extraction**: new consumable. Using it ends the run — replaces today's "all enemies dead" auto-complete trigger.
- **Long rest on descend**: HP → maxHp, rage uses + Second Wind refresh, combat log entry.

---

## Locked Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Sub-room isolation | Wide spacing only — no wall collision, no AI pathing changes. Revisit later. |
| 2 | Wave count per arm | 6 sub-rooms: 1, 2, 4, 6, 8, 10 enemies. 31 per arm, 93 total. |
| 3 | Floor 2 dimensions | 2400×2400 starting point — adjust during playtest if cramped. |
| 4 | Floor 1 extraction | No scroll on floor 1. Run must descend to extract. |
| 5 | Long rest on descend | Full rest: HP, rage uses, Second Wind refreshed. Combat log line announces it. |
| 6 | Floors as single room | One Colyseus room per run with `state.floor` swapping entities. (Not separate rooms per floor.) |

---

## Floor Data Shape

```js
// shared/data/floors/floor1.js
export const FLOOR_1 = {
  width: 1600, height: 1200,
  playerSpawn: { x: 800, y: 600 },
  enemies: [{ id: 'goblin_0', type: 'goblin', x: 300, y: 300 }, ...],
  chests:  [{ id: 'chest_0', x: 880, y: 600, items: ['shield', ...] }],
  traps:   [{ id: 'trap_0', x: 1380, y: 160 }],
  stairs:  [{ id: 'stair_down_0', x: 880, y: 540, toFloor: 2,
              lockedUntilAllEnemiesDead: true }],
};
```

`FLOOR_REGISTRY = { 1: FLOOR_1, 2: FLOOR_2 }` exported from `index.js`.

---

## Architecture

### New shared/ files
- `data/items/consumables.js` — add `EXTRACTION_SCROLL = { id, label, type: 'extract' }`.
- `data/floors/floor1.js`, `floor2.js`, `index.js` — pure data, no logic.

### Server
- `state/StairState.js` — `{ id, x, y, toFloor, locked }`.
- `state/GameState.js` — add `floor: number`, `stairs: MapSchema<StairState>`.
- `rooms/DungeonRoom.js`:
  - Replace hardcoded `_spawnX` helpers and file-level position constants with `_loadFloor(n)`.
  - `_loadFloor(n)` clears `state.enemies/chests/traps/stairs`, clears `_enemyDefs` and `_lootRolled`, repopulates from `FLOOR_REGISTRY[n]`. Sets `state.floor = n`.
  - On descend: also reset player position to new floor's `playerSpawn`, full long rest, broadcast log line.
  - `descend { stairId }` message: validate exists, `!locked`, in range. On valid → `_loadFloor(stair.toFloor)` for *all* players in room (single-room model).
  - Tick: any stair with `lockedUntilAllEnemiesDead && !locked-already-cleared && allDead` → flip `locked = false`. Reuse existing `allDead` check.
  - `_useConsumable`: add `type === 'extract'` branch → `state.phase = 'complete'` (existing client wiring takes over).
  - **Remove** the auto-complete `if (allDead && phase === 'playing')` block.

### Client
- `scenes/DungeonScene.js`:
  - Watch `state.floor` for change. On change: destroy all entries in `_enemyGfx`, `_chestGfx`, `_trapGfx`, `_stairGfx`; redraw room background from new floor's `width/height`; reset camera bounds. Server's onAdd will repopulate.
  - New `_stairGfx` map + `_createStairGfx`. Locked = grey, unlocked = brown with arrow + `F: Descend` hint.
  - Read room dimensions from `FLOOR_REGISTRY[state.floor]` instead of file-level `ROOM_WIDTH/ROOM_HEIGHT` constants.
  - Rename `_tryLootNearby` → `_tryInteractNearby`. Extend to consider stairs alongside chests/corpses; dispatch `descend { stairId }` for stairs.
  - Run summary copy: "All enemies defeated." → "Extraction successful."
- `store/stash.js` — seed `extraction_scroll` into the initial item set so it round-trips through stash.

---

## Message Protocol Additions

**Client → Server**
- `descend { stairId }` — server validates death-gate + range, swaps floor.

**Server → Client**
- No new messages. Combat log carries the long-rest announcement. Floor swap is visible via `state.floor` + entity churn.

---

## Build Order — Three Commits, Test Between

| Commit | Layer | Steps | Verify |
|---|---|---|---|
| 1 | shared | EXTRACTION_SCROLL; floor data files | imports clean; `FLOOR_REGISTRY` has both keys |
| 2 | server | StairState; GameState fields; `_loadFloor` refactor; `descend` handler; stair unlock; long rest + log; `extract` branch; remove auto-complete | manual run: kill floor 1 → stair flips unlocked in console → F descends → floor 2 entities populate → "Long rest" in combat log → scroll ends run |
| 3 | client + hub | floor-change teardown; stair gfx; `_tryInteractNearby`; room dim from floor data; scroll seed in stash | visual end-to-end |

---

## Out of Scope

- Wall collision and AI pathing — sub-rooms isolated by spacing only
- 60s ritual / radius for extraction — instant for now
- Floor 3+ — registry pattern makes adding trivial
- Variable per-cohort floor maps — single floor map per floor
- Scroll-of-extraction sourcing outside the floor 2 chest (not in vendors, not in starter loadout)

---

## Doc Updates (flag after implementation)

- **`CLAUDE.md`** — message protocol: add `descend`. GameState fields: add `floor`, `stairs`. New consumable type `extract`. New file: `shared/data/floors/`.
- **`docs/tech_spec.md`** — file structure: add `shared/data/floors/`. Note the `FLOOR_REGISTRY` pattern and `_loadFloor` flow as the reference for adding floors.
