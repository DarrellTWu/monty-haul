---
status: in-progress
updated: 2026-05-19
purpose: Sprint plan — add debug floor 3 (clone of floor 2) + stair down on floor 2 (starts unlocked). Floor 3 has a stair down to floor 4 that stays locked for now.
---

# Floor 3 Sprint Plan

## Goal
Extend the debug dungeon from 2 floors to 3, with as little surface area as possible:

1. **Floor 2 gains a stair down to floor 3**, starting **unlocked** (so testers can descend immediately on spawn — unlike floor 1, where the stair is gated on clearing the floor).
2. **Floor 3 is a near-exact clone of floor 2**: same arms, same enemy counts, same entry chest with the same items. Descending triggers the standard floor-descent flow (long rest, level-up modal, max-floor bump).
3. **Floor 3 has a stair down to floor 4** that stays locked for now. Floor 4 does not exist yet.

## Out of scope
- Any rework of stair-unlock conditions. The existing model is "stair starts locked, auto-unlocks when all enemies die." A richer unlock-condition system (variety of triggers per stair/door) is a known future need; **explicitly punted**. For this sprint we'll add the minimum to keep the floor-3 stair locked, and call out the spot the future system will replace.
- New enemies, new items, new chest contents, balance changes. Floor 3 is a verbatim clone for now.
- Floor 4 content.

## Locked decisions
- **Floor 2 stair location**: inside the central walled room, near spawn, so descent is one keypress from join. Exact coords picked during step 2.
- **Keeping the floor-3 stair locked**: simplest stopgap is a `permanentLock: true` data flag on the stair entry, which (a) maps to `stair.locked = true` at load, and (b) is skipped by the auto-unlock-on-all-enemies-dead loop in `DungeonRoom._tick`. Tracked server-side in a `Set<stairId>` so we don't bloat the synced `StairState` schema. Will be replaced when the broader unlock-condition system lands — leave a `TODO(deferred)` comment at the unlock site.
- **Floor 3 chest id**: `chest_floor3_entry` (mirrors `chest_floor2_entry` naming).
- **Floor 3 stair id**: `stair_floor3_down`. Floor 2's new stair: `stair_floor2_down`.

## Plan (with verification)

### 1. Add `shared/data/floors/floor3.js`
Copy `floor2.js` wholesale. Change only:
- File-header comment (s/Floor 2/Floor 3/, note this is a verbatim clone of floor 2 for now).
- Chest id → `chest_floor3_entry`.
- Add one entry to `stairs[]`:
  ```js
  { id: 'stair_floor3_down', x: <near spawn>, y: <near spawn>, toFloor: 4, permanentLock: true }
  ```
  Place inside the central walled room, mirroring where floor 2's new stair lives (e.g. ~60 px south of spawn).

Verify:
- `node shared/tests/items.test.js` passes (chest item-id reference integrity covers the new floor).
- File diff against `floor2.js` is small and reviewable.

### 2. Add a stair down on floor 2
Edit `shared/data/floors/floor2.js`. Append to `stairs[]`:
```js
{ id: 'stair_floor2_down', x: <near spawn>, y: <near spawn>, toFloor: 3, lockedUntilAllEnemiesDead: false }
```
Place inside the central walled room, clear of the entry chest (chest sits at `CENTER.x + 80, CENTER.y`) and the four doors. ~60 px south of spawn is a clean spot.

Verify:
- Manual: join the dungeon, descend floor 1 → floor 2, press F next to the new stair → lands on floor 3.
- The stair appears unlocked from the first tick (no enemies-cleared gate broadcast).

### 3. Register floor 3
Edit `shared/data/floors/index.js`:
- `import { FLOOR_3 } from './floor3.js';`
- Add `3: FLOOR_3` to `FLOOR_REGISTRY`.

Verify:
- Server boots without warning; `_loadFloor(3)` log line shows the expected enemy/chest/stair counts.

### 4. Server: honor `permanentLock` on stairs
Edit `server/rooms/DungeonRoom.js`:
- Add an instance field, e.g. `this._permanentlyLockedStairs = new Set();` in `onCreate`.
- In `_loadFloor`, clear and re-populate it: when `s.permanentLock` is true, push `s.id` into the set and set `stair.locked = true`.
- In the auto-unlock block in `_tick` (around line 580), skip stairs whose id is in the set.
- Add a `// TODO(deferred): replace with general stair/door unlock-condition system` comment at the unlock site.

Verify:
- Manual: on floor 3, kill every enemy. Confirm **no** "Stair to Floor 4 unlocked" line in combat log. Walk onto the stair and press F → server `descend` handler silently rejects (existing `if (stair.locked) return` guard).
- Existing floor-1 unlock behavior unchanged (kill all enemies → "Stair to Floor 2 unlocked" still fires).

### 5. End-to-end smoke
Start `npm start`, run through:
- Floor 1 → clear → descend to floor 2.
- Floor 2 → without clearing, descend immediately on the new stair to floor 3.
- On entering floor 3, verify:
  - Combat-log line: `── Descending to Floor 3 — long rest taken … ──`.
  - HP refilled, any active conditions cleared, Second Wind/rage uses refreshed.
  - Level-up modal opens; pick a class; floor-3 movement re-enables.
  - Entry chest is at the expected spot with `extraction_scroll` + 10× each of the four potions.
  - The floor-4 stair is visible, locked, and pressing F on it is a no-op.
- Use the extraction scroll → run ends cleanly, stash + gold commit as usual.
- Death on floor 3 → run terminates, `run_history.floors_reached = 3` (max-floor tracker bumps in `_descendTo`).

## Files touched (expected)
- `shared/data/floors/floor3.js` *(new)*
- `shared/data/floors/floor2.js` *(+1 stair entry)*
- `shared/data/floors/index.js` *(+1 import, +1 registry entry)*
- `server/rooms/DungeonRoom.js` *(~6 lines: field init, `_loadFloor` branch, `_tick` skip, TODO comment)*

## Doc updates to flag at the end
After ship, surface these to the user (don't update unprompted):
- `docs/PROJECT_STRUCTURE.md` — floors row ("Both floors…" → "Three floors…").
- `docs/agent-context/floors.md` — mention floor 3 in the tuning section; note the `permanentLock` stopgap and that it'll be subsumed by the future unlock-condition system.
- Archive this plan to `docs/archive/` once shipped (matches the pattern set by `archive/floor-2-plan.md`, `archive/scroll-viewport-sprint-plan.md`).

## Risk / things to watch
- **Floor 3 stair placement** — must not overlap the entry chest's `CHEST_LOOT_RANGE_PX` interact zone, or pressing F on spawn becomes ambiguous between "open chest" and "descend." `_tryInteractNearby` should pick the closest entity; pick stair coords that are unambiguously closer to spawn than the chest (or further away).
- **Permanent-lock stopgap leaking** — the `Set<stairId>` is per-room; `_loadFloor` must clear it before re-populating, otherwise stale ids from a previous floor would persist if a future floor reused them. Belt-and-suspenders: also key the skip on "stair currently in `state.stairs`."
