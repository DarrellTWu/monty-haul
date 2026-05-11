# Dungeon Geometry Sprint Plan
## Walls, Doors, and Elevated Platforms

*Status: Planning — do not code until this doc is approved.*

---

# Part 1 — Feature Description

## Overview

Add static dungeon geometry to the floor system:

- **Walls** — block movement for all entities. Will block LoS and ranged combat when those systems land.
- **Doors** — openings in walls. Door entities with server-authoritative lock state, so they can later be locked/unlocked by levers, keys, or other triggers without enabling client-side exploits.
- **Elevated platforms** — raised areas that block movement except via designated step points. Do NOT block LoS or ranged combat. Only certain entity types can climb them.

---

## Design Decisions

| Question | Decision | Notes |
|---|---|---|
| AI pathfinding | Wall sliding (V1) | Try full vector → x-only → y-only. Fix properly during the dedicated AI pass. |
| Door state authority | Server-authoritative, synced | Door `locked` state lives in `GameState` (`DoorState` MapSchema). Server mutates; clients render from synced state. Prevents local exploits. |
| Step interaction | Auto-climb | Entity walks over a step point and elevation changes automatically. No F-key prompt. |
| Who can climb platforms | Goblins only | `canClimb: true` on the goblin def; dogs and skeletons are `canClimb: false`. |
| Floor 1 geometry (this sprint) | Center platform, no enclosing walls | Spawn, chest, and stairs sit on an elevated center platform. Steps in 4 cardinal directions. No walls around the platform — the elevation itself creates the choke point. |
| Floor 2 geometry (this sprint) | Walled center room | A walled room around spawn and the entry chest, with a door in each cardinal direction. Enemies outside; players must exit through a door to engage. |

---

## Geometry Model

### Floor data schema additions

Walls, doors, and platforms are declared as arrays in floor data, alongside existing `enemies / chests / traps / stairs`. They are static per floor — no runtime mutation except door `locked` state, which is managed server-side.

```js
{
  // ... existing fields ...

  walls: [
    { id: 'wall_n', x, y, w, h },
    // Axis-aligned rectangles. Entities cannot pass through.
  ],

  doors: [
    { id: 'door_n', x, y, w, h, locked: false },
    // `locked` here is the initial state only.
    // Runtime lock/unlock is server-authoritative via DoorState in GameState.
  ],

  platforms: [
    {
      id: 'platform_center',
      x, y, w, h,
      elevation: 1,
      steps: [
        { id: 'step_n', x, y },
        { id: 'step_s', x, y },
        { id: 'step_e', x, y },
        { id: 'step_w', x, y },
      ],
    },
  ],
}
```

### `DoorState` — synced entity

Door lock/unlock state is held in a new `MapSchema` on `GameState`, mirroring the pattern used for chests, traps, and stairs. This makes the server the single authority and lets clients render doors correctly without trusting any local state.

```
GameState.doors: MapSchema<DoorState>
  DoorState.id:     string
  DoorState.x:      number
  DoorState.y:      number
  DoorState.w:      number
  DoorState.h:      number
  DoorState.locked: boolean
```

`DungeonRoom._loadFloor` populates `state.doors` from floor data (same pattern as stairs). When a lever/key mechanic lands, it mutates `state.doors.get(id).locked` server-side and Colyseus propagates the change.

### `elevation` — synced field on entities

```
PlayerState.elevation: number  (default 0)
EnemyState.elevation:  number  (default 0)
```

`0` = ground, `1` = elevated. The schema is a number to support future multi-level stacking, but this sprint treats any transition between 0 and 1 as the only case.

### Spawn elevation

When `_loadFloor` places players (on join or after descend), it checks whether the spawn point falls inside any platform rect on the new floor. If so, it sets the entity's `elevation` to match that platform. This ensures a player spawning on floor 1's center platform starts at `elevation: 1`, not `elevation: 0`.

---

## Collision Model

### Wall and door collision

Axis-aligned bounding box (AABB) push-out of a circle against a rectangle. For each wall rect the entity overlaps:
- Compute penetration depth on both axes.
- Push out on the axis with the smaller penetration (minimum translation vector).
- Unlocked doors are excluded from the collision check — they are passable openings.
- Locked doors are treated identically to walls.

All collision math lives in `shared/logic/geometry.js` as pure functions. `MovementSystem` calls them after velocity integration and before updating entity position.

### Elevation-aware collision

Entities only collide with walls and doors at their own elevation level. A platform's bounding rect (`x, y, w, h`) also acts as a movement boundary for entities on the ground — ground-level entities cannot walk through the space occupied by the elevated surface, because the platform perimeter is represented as walls at elevation 0. (The platform interior is open space for elevated entities.)

> **Implementation note:** Rather than a separate "platform perimeter" wall list, the platform rect itself is used as a wall for `elevation: 0` entities. `resolveWallCollision` receives the entity's current elevation and skips platform rects when called for elevated entities.

### Auto-climb (step interaction)

Each tick, for every entity that can potentially change elevation (all players; enemies where `canClimb: true`):
1. Check whether the entity's movement path this tick crosses a step point (step is a small circle of radius `STEP_RADIUS_PX`).
2. If yes, snap the entity to the step center and toggle elevation (0 → 1 or 1 → 0).
3. Non-climbable enemies (`canClimb: false`) are never passed to this check — they simply cannot cross step points.

`prevX / prevY` for each entity are tracked server-only (not synced) to detect step crossing. On teleport events (spawn, descend) `prevX/prevY` are set equal to current position, so the crossing check yields no transition for that tick.

---

## AI Behavior

### Wall sliding (V1)

After computing the desired velocity vector toward the target:
1. Try the full `(vx, vy)` move. If it would collide with a wall, try step 2.
2. Try x-component only `(vx, 0)`.
3. Try y-component only `(0, vy)`.
4. If all three collide, zero velocity — enemy is cornered.

This is O(1) per enemy per tick. It handles corridor navigation and 90-degree turns. Known failure cases: concave corners, diagonal walls. These are accepted as V1 limitations; fix during the AI pass.

### Elevation-aware pursuit

- **Non-climbers (dogs, skeletons):** When the target is at a different elevation, the enemy pursues to the nearest step point of the platform, then stops. It does not halt the moment the target climbs — it closes to the base. This creates natural "siege" pressure from below.
- **Climbers (goblins):** Pursue normally. When their path crosses a step point, `tryAutoClimb` fires and they follow the player onto or off the platform.

---

## Floor Layouts (This Sprint)

### Floor 1 — Center Platform

Floor dimensions: `1600 × 1200` (unchanged).

The center of the room is an elevated platform. Spawn, the entry chest, and the staircase to floor 2 all sit on the platform. Players begin the run elevated. To engage ground-level enemies, they must descend via one of the four steps.

```
Platform rect:  approx. 680–980 x, 480–720 y  (300 × 240 px, centered on 800, 600)
Elevation:      1
Steps (edge midpoints):
  step_n  at (800, 480)   — north face
  step_s  at (800, 720)   — south face
  step_e  at (980, 600)   — east face
  step_w  at (680, 600)   — west face

Spawn:          (800, 600)   — center of platform  [elevation: 1]
Chest:          (880, 600)   — on platform          [elevation: 1]
Stairs:         (980, 600)   — east edge of platform, adjacent to step_e  [elevation: 1]

Enemies (ground level, elevation: 0 — unchanged positions):
  goblin_0    (300,  300)   — NW  [will climb]
  goblin_1    (1300, 900)   — SE  [will climb]
  dog_0       (1300, 300)   — NE  [will not climb]
  skeleton_0  (300,  900)   — SW  [will not climb]

No enclosing walls. The platform edge itself creates the choke point.
```

### Floor 2 — Walled Center Room

Floor dimensions: `4000 × 4000` (unchanged).

A walled room surrounds the spawn and entry chest. Four doors (unlocked) let players exit into the three enemy arms. The room creates a "staging area" — players can prepare before engaging.

```
Room rect:  1800–2200 x, 1800–2200 y  (400 × 400 px, centered on 2000, 2000)
Elevation:  0 (ground only — no platforms on floor 2 this sprint)

Walls (segments around the room perimeter, minus door openings):
  wall_n_left    from (1800, 1800) to (1960, 1800)   — north wall, left of door
  wall_n_right   from (2040, 1800) to (2200, 1800)   — north wall, right of door
  wall_s_left    from (1800, 2200) to (1960, 2200)
  wall_s_right   from (2040, 2200) to (2200, 2200)
  wall_e_top     from (2200, 1800) to (2200, 1960)
  wall_e_bottom  from (2200, 2040) to (2200, 2200)
  wall_w_top     from (1800, 1800) to (1800, 1960)
  wall_w_bottom  from (1800, 2040) to (1800, 2200)

Doors (80 px wide openings, one per face — all unlocked):
  door_n  at (1960, 1800),  w: 80, h: 8, locked: false
  door_s  at (1960, 2200),  w: 80, h: 8, locked: false
  door_e  at (2200, 1960),  w: 8,  h: 80, locked: false
  door_w  at (1800, 1960),  w: 8,  h: 80, locked: false

Spawn:        (2000, 2000)   — center of room
Entry chest:  (2080, 2000)
No stairs (exit only via Scroll of Extraction — unchanged)
```

Wall segments are stored as AABB rects in the `walls` array. Exact coordinates to be finalized during implementation; the above are design intent.

---

## Known Limitations (Accepted)

- **AI gets stuck on concave corners and diagonal obstacles.** Wall sliding doesn't handle these. Fix during the AI pass.
- **No runtime door mutation this sprint.** All doors are unlocked. Door entities are created in `GameState` so future mechanics can mutate `.locked` without rearchitecting.
- **`isLineBlocked` is a stub.** Always returns `false`. LoS system fills the body later — callers are already in place.
- **Elevation is binary (0/1) in practice.** The schema is a number; multi-level stacking is out of scope.
- **`prevX/prevY` not synced.** Skips climb check for one tick after teleports — no observable impact.
- **No wall art / sprites.** Walls and platforms render as colored rectangles this sprint (same approach as all other placeholder graphics).

---

---

# Part 2 — Build Plan

## Files Changed

| File | Change |
|---|---|
| `shared/logic/geometry.js` | **New** — `resolveWallCollision`, `isLineBlocked` stub, `tryAutoClimb` |
| `shared/tests/geometry.test.js` | **New** — unit tests for all geometry functions |
| `shared/data/floors/floor1.js` | Add platform + steps; reposition spawn/chest/stairs onto platform |
| `shared/data/floors/floor2.js` | Add walls + 4 doors around center room |
| `shared/data/enemies/tier1.js` | Add `canClimb: bool` to goblin (true), dog (false), skeleton (false) |
| `server/state/DoorState.js` | **New** — `id, x, y, w, h, locked` schema |
| `server/state/GameState.js` | Add `doors: MapSchema<DoorState>` |
| `server/state/PlayerState.js` | Add `elevation: 0` |
| `server/state/EnemyState.js` | Add `elevation: 0` |
| `server/systems/MovementSystem.js` | Accept `walls, doors, platforms`; call `resolveWallCollision` after integration |
| `server/systems/AISystem.js` | Wall-sliding fallback; elevation-aware pursuit |
| `server/rooms/DungeonRoom.js` | Populate `state.doors`; store floor geometry; auto-climb tick loop; set entity elevation on spawn/descend |
| `client/src/scenes/DungeonScene.js` | Listen to `state.doors` onAdd/onRemove; render walls, doors, platforms, step points in `_applyFloorLayout` |

**Not changed:** persistence layer, hub routes, `StairState`, `ChestState`, `TrapState`, Supabase migrations, `GameState.phase/floor`.

---

## Milestones

### M1 — Data layer + geometry logic

1. Write `shared/logic/geometry.js`: `resolveWallCollision`, `isLineBlocked` stub, `tryAutoClimb`.
2. Write `shared/tests/geometry.test.js`: wall push-out (head-on, corner, pass-through), line-blocked stub, step crossing (N/S/E/W), step miss, elevation toggle, non-climbable entity not climbing.
3. Add `walls`, `doors`, `platforms` to floor 1 and floor 2 data per the layouts above.
4. Add `canClimb` to enemy defs.
5. Create `server/state/DoorState.js`; add `doors` MapSchema to `GameState`.

*Verify: `node shared/tests/geometry.test.js` passes. Server starts without error.*

### M2 — Server collision + elevation

1. Update `MovementSystem.update` signature to accept `{ walls, doors, platforms }` and call `resolveWallCollision` after integration. Elevation-aware: pass only geometry matching entity elevation.
2. Add `elevation: 0` to `PlayerState` and `EnemyState`.
3. Update `DungeonRoom._loadFloor` to: populate `state.doors` from floor data (same pattern as `state.stairs`); store `_floorWalls`, `_floorDoors`, `_floorPlatforms` as instance fields.
4. Update `DungeonRoom` tick loop: call `tryAutoClimb` for each player and climbable enemy; apply elevation change + snap. Track `_prevPos` map (sessionId/enemyId → `{x, y}`) server-only.
5. In `onJoin` and `_longRest`/descend: set entity `elevation` from spawn point vs. platform rects on the new floor.

*Verify: player can't walk through walls on floor 2; player spawns at elevation 1 on floor 1; no regression on existing stair/chest/trap behavior.*

### M3 — AI wall sliding + elevation awareness

1. Update `AISystem` to use wall-sliding fallback (full → x-only → y-only → zero). Pass `_floorWalls` and `_floorDoors` from `DungeonRoom`.
2. Add elevation-aware pursuit: non-climbers stop at platform base when target is elevated; climbers follow via auto-climb.

*Verify: goblin navigates floor 2 corridor to reach the player; skeleton on floor 1 ground stays below platform; goblin follows player up the platform.*

### M4 — Client rendering

1. Update `DungeonScene` to listen on `state.doors.onAdd/onRemove` (same pattern as `state.stairs`); store `_doorGfx` map.
2. In `_applyFloorLayout`: read `FLOOR_REGISTRY[floor].walls` and `.platforms` (static); draw wall rects as dark filled rectangles with a border; draw platforms as lighter-tinted elevated rect with a drop-shadow edge.
3. In `update`: re-draw door gfx based on `doorState.locked` (open doors rendered as a gap/lighter color, locked doors as a wall segment).
4. Render step points as small ramp markers (e.g., small trapezoid or chevron).
5. Use entity `elevation` for render depth: elevated entities at `depth = 2`; ground entities at `depth = 1`.

*Verify: floor 1 platform is visually distinct; floor 2 walls and door openings are legible; entity depth layering is correct when a goblin climbs the platform.*

---

## Test Coverage

| Test file | What it covers |
|---|---|
| `shared/tests/geometry.test.js` | Wall push-out, line-blocked stub, step crossing/miss, elevation toggle, canClimb gating |

No new integration or smoke tests required this sprint — the geometry module is pure logic and the existing supabase/run-history/concurrency smokes are unaffected.
