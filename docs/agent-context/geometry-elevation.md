---
status: shipped
updated: 2026-07-13
purpose: Walls, doors, platforms, rooms, steps, multi-level elevation, high-ground advantage, gradient climb visuals, line of sight. Read when the task touches collision, navigation, terrain, or LoS.
---

# Dungeon Geometry & Elevation

Implemented in the geometry sprint. Build plan and design rationale: `archive/geometry-sprint-plan.md`.

## Floor Data Shape
Alongside `enemies/chests/traps/stairs`, each floor in `shared/data/floors/` declares `walls`, `doors`, `platforms`, `rooms` arrays.

- Walls + platforms are **static** (server stashes refs in `_floorWalls` / `_floorPlatforms`).
- Doors populated into `state.doors` (synced MapSchema) so runtime lock state can mutate.
- Rooms are AI-navigation hints (stashed in `_floorRooms`). Each room: `{ id, x, y, w, h, doors: [doorId...] }`. Rect is the room *interior* (not the wall band).

## Platform Model (multi-level)
Platforms = elevated ground (`elevation: 1..2`, default 1 when omitted) + perimeter wall band with gaps at each step. **Stacking convention:** a higher tier is declared as a rect fully inside its lower tier (elev-2 "summit" inside an elev-1 base — see floor 3's Mesa). Three tiers exist today (0 = ground); the model supports more.

- `platformPerimeterRects(platform)` generates thin wall segments (4 edges, split at step positions declared in `platform.steps`).
- A platform's perimeter rects are **obstacles for any non-climber whose elevation is below that platform's level**; climbers and entities at/above the level pass through freely (grouping lives in MovementSystem/AISystem `perimeterGroups`).
- **There is no step circle.** The original radius-based step model was replaced because it caused oscillation when wall push-back trapped entities inside the circle. Steps are simply gaps in the perimeter wall now (`STEP_HALF_WIDTH_PX = 24`, total gap = 48 px).
- Authoring: geometry sits on the `TILE_PX` (40 px) grid — tile-art prep; chokepoint widths (80/48) and step gaps are the sanctioned off-grid gameplay constants.

## Elevation Transitions (positional model)
**Elevation IS position**: `elevationAt(x, y, platforms)` returns the highest containing platform's level (0 on open ground). `tryAutoClimb(entity, platforms)` now simply derives elevation from the entity's resolved final position — the obstacle list is what *gates* who can get there (non-climbers blocked except at step gaps), so anyone whose position ends up inside a footprint has earned the level. This generalizes to stacked tiers and self-heals any elevation desync.

## Climb Visuals (gradient tiles — RoomRenderer)
Placeholder-art language for "can this surface be climbed," painted from floor data alone (`client/src/rendering/RoomRenderer.js`; `scripts/render-floor.mjs` mirrors it for SVG previews):
- **Elevation color ladder** — one shade per tier (`ELEVATION_COLORS`), lighter = higher; stacked platforms paint lowest-first.
- **Climb band** — a *narrow* (12 px) low→high gradient straddling every perimeter edge: short and steep, reads as "a monk could scale this, nobody strolls up it."
- **Ramp strip** — the same gradient stretched wide and deep (48 × 32) at each step gap: reads as an accommodating slope anyone can walk. Ramps paint over the climb band, so the steep read survives only where the surface really is a wall.

**Body blocking:** `separateCircles` (geometry.js) gives living same-elevation entities solid bodies — pairwise separation at the end of `MovementSystem.update`, wall-re-resolved so a jostle can't shove anyone through geometry (behavior details: `combat.md` §Knockback).

Two other systems drive elevation through the same primitives:
- **Knockback** (`shared/logic/knockback.js`) runs its displacement segment through `tryAutoClimb` — an elevated target shoved across an edge drops a tier. Knockback treats the perimeters of any platform *above* the target's elevation as obstacles (nobody gets punched up a wall), which is what makes platform side-walls wall-slammable. Rules live in `combat.md` §Knockback.
- **Climb fatigue** (`MovementSystem`): a player whose upward crossing (any tier) intersects a perimeter *wall* rect (not a step gap) on a floor deeper than their climb level (`getClimbLevel` — max level across canClimb classes) emits a `climb_fatigue` event; `DungeonRoom` applies the condition (50% speed, 1 s per floor of deficit, 4 s cap). Design: `design/dynamic-combat.md` §Monk climb fatigue.

## Elevation Flow (causal chain — referenced in architecture review §3.3)
1. **Seeding**: `DungeonRoom._spawnElevation(x, y)` checks platform rects at join + descend, sets `PlayerState.elevation` / `EnemyState.elevation`.
2. **Mutation**: `MovementSystem` re-derives elevation positionally via `tryAutoClimb`/`elevationAt` (each tick).
3. **Gating**: Wall obstacle list includes the perimeter rects of platforms above the entity's elevation (unless `canClimb`).
4. **Visual**: `DungeonScene` reads elevation → render depth (2 + 2×elevation; HP bar = entity depth + 1).
5. **Combat**: `CombatSystem` grants high-ground advantage on any elevation differential (`attacker.elevation > target.elevation` — see `combat.md`).

## `canClimb`
Class-level flag (Monk = true; Fighter/Barbarian = false) and enemy-def-level flag (Goblin = true; Dog/Skeleton = false). Read at call time from `CLASS_REGISTRY` / `enemyDefs`. **Not synced** — `canClimb` never changes during a run, so syncing it would be wasteful. Server pure-logic helpers (`resolveWallCollision`, `tryAutoClimb`) take a plain `canClimb: boolean` parameter, decoupling them from def lookup.

### Why this is a stub (DEFERRED)
`canClimb` is a class-level flag, **not a skill**. Long-term, climbing is expected to be a learnable skill/feat per character — climbing should join other movement-related skills (e.g. Athletics) rather than being class-gated. For this sprint, Monk has `canClimb: true` as a stand-in for that future system. **Treat this as a placeholder, not the final model.**

The migration target: replace the class/enemy-def flag with a per-character runtime check (e.g. a `skills` set on `PlayerState`). Timing: when the broader skill system is designed. Historical decision record: `archive/geometry-sprint-plan.md` §"Open Questions" #12.

## AI Navigation (`AISystem.selectTargetPosition`)
Two routing layers:
1. **Walled-room routing**: if target is inside a room and enemy isn't (or vice versa), retarget to the nearest *unlocked* door (read live from `state.doors`).
2. **Elevation routing**: non-climbers chasing an elevated target retarget to the nearest step on the platform containing that target. Climbers always pursue directly.

Wall-sliding fallback (`applySlidingVelocity`) handles corridors and 90° turns; concave corners still trap (accepted V1).

## Visuals
Placeholders, no tiles yet.
- Base ground `0x2a2a3a`
- Platform ground `0x3a3a4f`
- Step transition strips two-tone (`0x36364a` / `0x30303d`)
- Walls `0x111118` with `0x4a4a5a` border
- Unlocked doors `0x4a4a5a` band; locked doors render identical to walls
- Entity render depth: elev 0 = 2, elev 1 = 4

## Line of Sight
`isLineBlocked(x1, y1, x2, y2, obstacles)` in `shared/logic/geometry.js` uses a Liang-Barsky segment-vs-AABB sweep against every rect in `obstacles`. Returns true on the first hit.

**Caller filters the rect list.** `DungeonRoom.attack` builds it as static walls + currently-locked-door rects. Unlocked doors and platform perimeters never block LoS — passing them in `obstacles` would block, but no current caller does.

Used by `CombatSystem.playerAttack` on the ranged branch (denial reason `'no_line_of_sight'`). See `agent-context/combat.md` for the ranged path.

## Known V1 Limitations
- No fall damage on walk-off
- No door interaction UX (all doors unlocked this sprint)
- Locked-door branch in collision/render is untested
- AI gets stuck on concave corners
- Multi-level stacking (>1) out of scope
- `canClimb` is a class flag, not yet a skill

## See also — historical context
`archive/geometry-sprint-plan.md` — original sprint design rationale + build plan. Read only if you need: the full Open Questions list (#1–#15 with "when to revisit" triggers), the abandoned step-circle model and why it was replaced, the original Collision Model decision table, or the build-order/milestone log. Frozen at sprint completion (2026-05-11).
