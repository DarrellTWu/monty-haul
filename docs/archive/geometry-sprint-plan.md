---
status: archived
updated: 2026-05-11
purpose: Build plan + design rationale for walls, doors, platforms, steps, rooms, elevation, high-ground advantage. Shipped. For current behavior see docs/agent-context/geometry-elevation.md.
---
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
| Step interaction | Auto, anyone | Anyone (player or enemy) can use steps. Entity walks over a step circle and elevation toggles automatically. No F-key prompt. |
| Platform climbing | Climbers scale anywhere; non-climbers must use steps | `canClimb: true` on a class def or enemy def means the entity can scale up onto a platform anywhere along the perimeter (not just steps). **Among player classes: only Monk has `canClimb: true`** — Fighter and Barbarian are non-climbers. **Among enemies: only Goblin climbs** — Dogs and Skeletons don't. This is a stub: long-term, climbing is expected to be a skill or feat unlocked per-character rather than a static class flag. The class-level flag is the simplest expression of that intent until the skill system lands. |
| Walking *off* a platform | Anyone, anywhere | Any entity at elevation 1 can walk off any platform edge — no step required, no climb ability required. Drop is instant; no fall damage. |
| LoS / ranged attacks over platforms | Not blocked | Platforms block movement (subject to climb rules), but NOT line of sight or ranged attacks. Future LoS system only considers walls and locked doors. |
| High ground combat advantage | Attacker on elev 1 vs target on elev 0 gets advantage on the attack roll | Standard 5e advantage: roll 2d20, take the higher. Only the high-ground attacker benefits. Low-ground attacker is **not** at disadvantage. Applies to all attacks (melee + future ranged) since `resolveAttack` is the single chokepoint. |
| Floor 1 geometry (this sprint) | Center platform, no enclosing walls | Spawn, chest, and stairs sit on an elevated center platform. Steps in 4 cardinal directions. No walls around the platform — the elevation itself creates the choke point. |
| Floor 2 geometry (this sprint) | Walled center room, 4 doors | A walled room around spawn and the entry chest, with a door in each cardinal direction. North/East/West doors open into the existing enemy arms; **south door is reserved for a future 4th testing corridor** and opens into empty floor for now. |

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

### `canClimb` — server-side only, read from defs

`canClimb` is **not** added to PlayerState or EnemyState. It's read at call time from the static def:
- Enemies: `enemyDefs.get(id).canClimb` (added to `shared/data/enemies/tier1.js`)
- Players: `CLASS_REGISTRY[player.class].canClimb` (added to `monk.js` / `fighter.js` / `barbarian.js`)

This keeps the Colyseus schema lean — `canClimb` never changes during a run, so syncing it would be wasteful. Server pure-logic helpers (`resolveWallCollision`, `tryAutoClimb`) take a plain `canClimb: boolean` parameter, decoupling them from def lookup.

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

### Platform perimeter — asymmetric collision

The platform rect's perimeter is a movement boundary that depends on entity state. There is no separate "platform perimeter wall list"; the platform rect itself encodes the rule. For an entity attempting to cross the perimeter this tick:

| Entity state | Perimeter behavior |
|---|---|
| Elevation 0, `canClimb: false` | **Wall.** Treated identically to a regular wall rect: push out via AABB. |
| Elevation 0, `canClimb: true` | **Passable upward.** Entity crosses; elevation snaps to 1 (auto-climb). |
| Elevation 0, crossing through a step circle | **Passable upward via step.** Any entity (player or enemy) snaps elevation to 1. |
| Elevation 1, crossing perimeter outward | **Passable downward.** Any entity drops to elevation 0. No step required, no climb ability required. |

Implementation: `resolveWallCollision(entity, walls, doors, platforms)` receives the entity's elevation and `canClimb` flag. For each platform, it computes the perimeter-crossing intent (inward / outward / none) and applies the rule above. Step circles are checked before perimeter-as-wall so a `canClimb: false` entity crossing through a step transitions correctly.

### Line of sight

Platforms do **not** block LoS or ranged attacks. `isLineBlocked` only considers walls and locked doors. (Stub this sprint — body lands with the LoS/ranged system.)

### Auto-climb (step interaction)

Each tick, for every entity:
1. Check whether the entity's movement path this tick intersects a step circle (radius `STEP_RADIUS_PX`).
2. If yes, the entity's elevation toggles (0 → 1 or 1 → 0). Position is **not** snapped to the step center — the entity continues along its movement vector — so traversal feels continuous.
3. This applies to any entity regardless of `canClimb`. Steps are the universal traversal aid.

Path-crossing test is **segment-vs-circle** (entity's `(prevX, prevY) → (x, y)` segment against the step circle), not point-in-circle — at high tick velocities (longstrider + dash) a single tick can carry an entity ≈ 20 px, more than a small radius. Segment intersection ensures no jumps over the step.

**`STEP_RADIUS_PX` initial value: `24`.** Rationale: half of the worst-case single-tick travel (~20 px at longstrider + future dash, 20 Hz tick) leaves comfortable margin for diagonal traversal. Tunable in `constants.js`; revisit after playtesting.

`prevX / prevY` for each entity are tracked server-only (not synced) to feed the segment test. On teleport events (spawn, descend) `prevX/prevY` are set equal to current position so the crossing check yields no transition for that tick.

---

## Combat — High Ground Advantage

When an attacker at elevation 1 attacks a target at elevation 0, the attack roll uses **advantage** (roll 2d20, take the higher die). Standard 5e advantage applies the rule once per roll regardless of how many advantage sources stack.

- Reverse case (attacker elev 0, target elev 1) is **neutral** — not disadvantage. We can revisit later if playtesting shows the asymmetry is too strong.
- If both parties are at the same elevation, no effect.
- Bless (1d4 added to the attack roll) and other condition bonuses still apply on top of the higher d20.
- Natural 1 / natural 20 logic uses the *kept* die. With advantage, a natural 1 on one die is ignored if the other rolled higher than 1.
- The flag passed into `resolveAttack` is just `advantage: boolean`. Computing it from elevations is the caller's responsibility (`CombatSystem`).

### Implementation

`resolveAttack` in `shared/logic/combat.js` gains an optional `advantage: boolean` parameter. When true, it rolls two d20s and keeps the higher; the rest of the resolution (bonuses, crit, damage) is unchanged.

`CombatSystem` in `server/systems/CombatSystem.js` computes the flag at the call site:

```js
const advantage = attacker.elevation === 1 && target.elevation === 0;
```

This applies symmetrically to player→enemy and enemy→player attacks — no class- or species-specific logic.

Combat log will surface the advantage roll for transparency (e.g., "rolled 14 [adv: 7, 14]"). Exact log format is up to the implementer.

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

- **Non-climbers (dogs, skeletons) pursuing an elevated target:** The platform perimeter is a wall to them. They must route to the nearest step to climb. The pursuit vector retargets from `player.position` to `nearestStep.position` until the AI itself transitions to elevation 1 (step crossing during movement), after which it retargets to `player.position` again. If a non-climber is *already* elevated and its target descends, mirror behavior: route to nearest step to descend, then resume pursuit. (In practice, since walking off any edge transitions to elev 0, a non-climber on a platform whose target descends will most likely walk off the nearest edge in one tick — fine.)
- **Climbers (goblins):** Pursue the target's position directly. The perimeter is not a wall to them; auto-climb fires on perimeter crossing. They scale walls and walk over steps interchangeably.

Step targeting is "nearest by Euclidean distance to enemy" — not pathfinding-aware. Acceptable V1 limitation given platform geometry is convex this sprint.

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

Spawn:          (800, 600)   — center of platform                      [elevation: 1]
Chest:          (880, 600)   — east half of platform                   [elevation: 1]
Stairs:         (760, 600)   — west half of platform, not on any step  [elevation: 1]

Enemies (ground level, elevation: 0 — unchanged positions):
  goblin_0    (300,  300)   — NW  [will climb]
  goblin_1    (1300, 900)   — SE  [will climb]
  dog_0       (1300, 300)   — NE  [will not climb]
  skeleton_0  (300,  900)   — SW  [will not climb]

No enclosing walls. The platform edge itself creates the choke point.

Note: previous draft placed stairs at (980, 600) which collided with step_e —
moving stairs west to (760, 600) keeps them on the platform and away from any step.
```

### Floor 2 — Walled Center Room

Floor dimensions: `4000 × 4000` (unchanged).

A walled room surrounds the spawn and entry chest. Four doors (all unlocked) let players exit on each cardinal face. **The N, E, and W doors open into the existing enemy arms; the S door opens into empty floor and is reserved for a future 4th testing corridor.** The room creates a "staging area" — players can prepare before engaging.

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
- **No runtime door mutation this sprint.** All doors are unlocked. Door entities are created in `GameState` so future mechanics can mutate `.locked` without rearchitecting. The locked-door collision branch is therefore untested code this sprint.
- **`isLineBlocked` is a stub.** Always returns `false`. LoS system fills the body later. Included this sprint only because the wall/door data shape it will read is being defined now — no callers yet.
- **Elevation is binary (0/1) in practice.** The schema is a number; multi-level stacking is out of scope.
- **`prevX/prevY` not synced.** Skips climb check for one tick after teleports — no observable impact.
- **Step targeting for non-climber AI is greedy.** Picks nearest step by Euclidean distance with no awareness of walls between AI and step. Acceptable while platforms are convex and walls don't separate AI from steps. Revisit when corridors and platforms coexist.
- **`STEP_RADIUS_PX` is a starting guess (24 px).** Tunable, not playtested.
- **No wall art / sprites.** Walls and platforms render as colored rectangles this sprint (same approach as all other placeholder graphics).
- **No floor-2 door interaction UX yet.** Doors are passable openings only — there is no "open the door" action because all doors are unlocked. When key/lever mechanics land, the F-key interaction is a separate feature.
- **`canClimb` is a class-level flag, not a skill.** Long-term, climbing is expected to be a learnable skill/feat per character. For this sprint, Monk has `canClimb: true` as a stand-in. Treat this as a placeholder, not the final model.
- **High-ground advantage is one-directional.** Attacker at elev 1 vs target at elev 0 gets advantage; the reverse case is neutral, not disadvantage. We can revisit symmetry after playtesting.
- **No fall damage when walking off an elevated platform.** Drops are free this sprint.

---

## Open Questions — Punted

Captured here so they don't get lost. Each requires a deliberate decision when the relevant feature lands; **none block this sprint**.

| # | Question | When it must be answered |
|---|---|---|
| 1 | Should `open_container` / `take_item` / `descend` range checks require equal elevation between player and target? Today range is Euclidean only — a player at elev 0 standing next to the platform edge is "in range" of a chest at elev 1 on the platform. | Before any cross-elevation chest, stair, or interactive object is placed (i.e., as soon as platforms ship to non-debug content). |
| 2 | How does an entity climb a platform that has walls *on top* of it? (E.g. a fortified platform.) Today perimeter rule assumes the platform face is open. | Whenever a platform with walls on the top surface is designed. |
| 3 | Animation/timing for climb. Today auto-climb is instant — entity teleports up. | Before climb becomes a tactical primitive (e.g., interruptible). For now, instant is acceptable. |
| 4 | Fall damage / fall stun when walking off elevated platforms. Today drop is free. | When elevation > 1 enters the game, or when balance demands a downside to dropping. |
| 5 | Door interaction UX (locked doors, key items, levers). Today all doors unlocked; no F-prompt. | When the first locked-door mechanic is designed. |
| 6 | Concave-corner / diagonal-wall AI behavior under wall sliding. Today: enemies stall. | AI pass. |
| 7 | Step targeting for non-climbers when walls separate AI from the nearest-by-distance step. Today: greedy Euclidean pick. | When a floor introduces walls that can hide a step from a pursuing AI. |
| 8 | Multi-level elevation stacking (>1). Schema supports it; logic does not. | When multi-tier platforms are designed. |
| 9 | LoS rules for elevated entities firing down at ground entities, and vice versa. Today: platforms don't block LoS, but no projectile system exists. | When ranged/projectile combat lands. |
| 10 | Whether elevation should be exposed via Colyseus types or remain inferred client-side from platform overlap. Today: synced field on PlayerState/EnemyState. Keep it — flagged here only so we revisit if it bloats schema bandwidth. | Performance pass. |
| 11 | Should `prevX/prevY` be tracked outside `MovementSystem` for any other system (e.g. trap leading-edge detection)? Today: each system tracks its own. | When two systems need the same prev-position data. |
| 12 | Migrate `canClimb` from class def to a per-character skill/feat unlock. Today: a hard-coded class flag (Monk only among PCs). | When the skill system is designed — climbing should join other movement-related skills (e.g. Athletics) rather than being class-gated. |
| 13 | Should low-ground attackers suffer disadvantage attacking up at high-ground targets? Today: neutral. | After enough playtime to know if high-ground advantage alone is sufficient. |
| 14 | Should the high-ground advantage rule eventually distinguish melee from ranged? Today: applies to all attacks. | When ranged combat lands — variant 5e rules generally apply high-ground only to ranged. |
| 15 | Visual treatment when an entity is mid-step (partway across the gradient zone). Today: elevation flips discretely on segment-circle intersection; no animation. | When climb timing becomes a tactical concern (see #3). |
| 16 | How should multiple platforms with overlapping/adjacent perimeters interact? Today: floors only have one platform. | When a floor design needs adjacent or nested platforms. |

---

---

# Part 2 — Build Plan

## Files Changed

| File | Change |
|---|---|
| `shared/logic/geometry.js` | **New** — `resolveWallCollision`, `isLineBlocked` stub, `tryAutoClimb`, perimeter-crossing helpers |
| `shared/tests/geometry.test.js` | **New** — unit tests for all geometry functions |
| `shared/data/constants.js` | Add `STEP_RADIUS_PX = 24` |
| `shared/data/floors/floor1.js` | Add platform + 4 steps; reposition stairs to `(760, 600)` (off step_e) |
| `shared/data/floors/floor2.js` | Add walls + 4 doors around center room (south door reserved for future arm) |
| `shared/data/enemies/tier1.js` | Add `canClimb: bool` to goblin (true), dog (false), skeleton (false) |
| `shared/data/classes/monk.js` | Add `canClimb: true` |
| `shared/data/classes/fighter.js` | Add `canClimb: false` |
| `shared/data/classes/barbarian.js` | Add `canClimb: false` |
| `shared/logic/combat.js` | `resolveAttack` gains optional `advantage: boolean` param (rolls 2d20, keeps higher) |
| `server/systems/CombatSystem.js` | Compute `advantage = attacker.elevation === 1 && target.elevation === 0` at the call site for both player→enemy and enemy→player resolution |
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

### M2.5 — High-ground combat advantage

1. Add optional `advantage: boolean` to `resolveAttack` params. When true, roll 2d20 and keep the higher (still using the injected `rng`). Natural 1 / natural 20 checks operate on the *kept* die.
2. Update both attack paths in `server/systems/CombatSystem.js` (player attacking enemy, enemy attacking player) to compute `advantage = attacker.elevation === 1 && target.elevation === 0` and pass it through.
3. Surface the advantage in the combat log (e.g., append `[adv: a, b]` after the attack roll line).
4. Extend `shared/tests/combat.test.js` with: advantage rolls 2d20 and keeps higher; bless still adds 1d4 on top of the higher d20; natural-1 logic uses the kept die; without advantage, behavior unchanged.

*Verify: a player on a floor 1 platform attacking a ground-level enemy hits more often; existing combat tests still pass; advantage flag is OFF for same-elevation engagements.*

### M3 — AI wall sliding + elevation awareness

1. Update `AISystem` to use wall-sliding fallback (full → x-only → y-only → zero). Pass `_floorWalls` and `_floorDoors` from `DungeonRoom`.
2. Add elevation-aware pursuit:
   - Non-climbers pursuing an elevated target retarget the move vector to the nearest step (Euclidean) until the AI itself reaches elevation 1, then retarget to the player.
   - Climbers pursue the player directly; perimeter is not a wall to them; auto-climb fires on perimeter or step crossing.

*Verify: goblin navigates floor 2 N corridor (via north door) to reach the player; dog/skeleton on floor 1 ground routes to the nearest step when the player is on the platform, then climbs once it reaches the step; goblin on floor 1 scales the platform anywhere (not only via a step) to follow.*

### M4 — Client rendering

Platforms and walls are **visually distinct**: walls are solid obstacles, platforms are differently-colored ground. We have no tile graphics yet — color shading is the entire visual language.

1. Update `DungeonScene` to listen on `state.doors.onAdd/onRemove` (same pattern as `state.stairs`); store `_doorGfx` map.
2. In `_applyFloorLayout`:
   - **Base ground:** keep the current `0x2a2a3a` fill.
   - **Walls:** draw as dark filled rectangles with a border — clearly an obstacle. Suggested color a notch darker than the wall border used today (e.g. `0x111118`).
   - **Platforms:** fill the platform rect with a **lighter ground color** (e.g. `0x3a3a4f` — same hue family as base ground, perceptibly lighter, no border). Looks like terrain, not an obstacle. This communicates "high ground" at a glance and distinguishes platforms from walls without dedicated art.
   - **Step zones:** render each step as a small rectangular transition area at the platform edge where the platform color fades into the base ground color. Implementation: a short gradient strip (built from a couple of stacked semi-transparent rects perpendicular to the edge, or a single fill that visually splits the difference between platform color and base color). Players read this as a ramp without needing a chevron or icon.
   - **Wall and platform layering:** platforms render *under* walls and entities; walls render under entities.
3. In `update` (or via the door schema's `onChange`): re-draw door gfx based on `doorState.locked` — open doors render as a gap or a lighter-than-wall segment; locked doors render identical to a wall segment.
4. Use entity `elevation` for render depth: elevated entities at `depth = 2`; ground entities at `depth = 1`. This gives the visual cue that a climbed goblin is "on top of" the platform tinting rather than "behind" it.
5. No step glyphs / chevrons / ramp markers — the color transition is the only step indicator.

*Verify: floor 1 platform color and step transitions are legible without any UI hint; floor 2 walls vs. platform are obviously different shapes of obstacle (walls block, platforms are walkable terrain at a different height); a climbed goblin visually overlaps the platform tint rather than disappearing under it.*

### M5 — Docs refresh

Per CLAUDE.md's "Keeping Docs Current" rule, this sprint adds fields to synced state (`elevation` on PlayerState/EnemyState, `doors` MapSchema on GameState), a new file structure layer (`shared/logic/geometry.js`, `server/state/DoorState.js`), and a new convention (floor data declares `walls/doors/platforms`). Update:

1. `CLAUDE.md` — PlayerState/EnemyState field list, GameState doors map, file structure entries for the new modules, floor system section to mention walls/doors/platforms, agent task context list to include `server/state/DoorState.js` when relevant.
2. `docs/tech_spec.md` — same shape changes if reflected there.
3. Floor 1 layout reference if it appears in `docs/floor-2-plan.md` or `docs/tech_spec.md`.

*Verify: a fresh agent reading CLAUDE.md alone would correctly understand the geometry model and where to find it.*

---

## Test Coverage

| Test file | What it covers |
|---|---|
| `shared/tests/geometry.test.js` | Wall push-out (head-on, corner, grazing pass-through), `isLineBlocked` stub returns false, step crossing via segment intersection (N/S/E/W), step miss (segment doesn't intersect circle), high-speed traversal still detects crossing, elevation toggle both directions, `canClimb: true` perimeter crossing, `canClimb: false` blocked by perimeter, walk-off from elev 1 always permitted, locked door behaves as wall, unlocked door is passable |
| `shared/tests/combat.test.js` (additions) | `advantage: true` rolls two d20 and keeps the higher; bless adds 1d4 to the kept die; natural-1 logic uses the kept die; natural-20 logic uses the kept die; `advantage: false` (default) behaves exactly as today (no regression) |

No new integration or smoke tests required this sprint — the geometry module is pure logic and the existing supabase/run-history/concurrency smokes are unaffected.
