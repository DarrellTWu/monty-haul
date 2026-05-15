---
status: shipped
updated: 2026-05-14
purpose: Walls, doors, platforms, rooms, steps, elevation, high-ground advantage. Read when the task touches collision, navigation, or terrain.
---

# Dungeon Geometry & Elevation

Implemented in the geometry sprint. Build plan and design rationale: `archive/geometry-sprint-plan.md`.

## Floor Data Shape
Alongside `enemies/chests/traps/stairs`, each floor in `shared/data/floors/` declares `walls`, `doors`, `platforms`, `rooms` arrays.

- Walls + platforms are **static** (server stashes refs in `_floorWalls` / `_floorPlatforms`).
- Doors populated into `state.doors` (synced MapSchema) so runtime lock state can mutate.
- Rooms are AI-navigation hints (stashed in `_floorRooms`). Each room: `{ id, x, y, w, h, doors: [doorId...] }`. Rect is the room *interior* (not the wall band).

## Platform Model
Platforms = visual ground at elevation 1 + perimeter wall band with gaps at each step.

- `platformPerimeterRects(platform)` generates 8 thin wall segments (4 edges × 2 halves, split at step positions declared in `platform.steps`).
- For elev-0 non-climbers: perimeter rects are **obstacles** (block movement except through step gaps).
- For climbers and all elev-1 entities: perimeter rects are **NOT** in the obstacle list — they pass through freely.
- **There is no step circle.** The original radius-based step model was replaced because it caused oscillation when wall push-back trapped entities inside the circle. Steps are simply gaps in the perimeter wall now (`STEP_HALF_WIDTH_PX = 24`, total gap = 48 px).

## Elevation Transitions
`tryAutoClimb(entity, platforms)` reads the entity's movement segment and translates any inward perimeter crossing into elev `0 → 1`, any outward into `1 → 0`. The wall list itself gates *who* can cross (non-climbers blocked except at step gaps), so once an entity has crossed the perimeter the elevation toggle is unconditional.

## Elevation Flow (causal chain — referenced in architecture review §3.3)
1. **Seeding**: `DungeonRoom._spawnElevation(x, y)` checks platform rects at join + descend, sets `PlayerState.elevation` / `EnemyState.elevation`.
2. **Mutation**: `MovementSystem.tryAutoClimb` flips elevation on perimeter crossing (each tick).
3. **Gating**: Wall obstacle list excludes/includes perimeter rects based on `canClimb` + current elevation.
4. **Visual**: `DungeonScene` reads elevation → render depth (ground=2, elevated=4; HP bar = entity depth + 1).
5. **Combat**: `CombatSystem` computes `advantage = attacker.elev===1 && target.elev===0` (see `combat.md`).

## `canClimb`
Class-level flag (Monk = true; Fighter/Barbarian = false) and enemy-def-level flag (Goblin = true; Dog/Skeleton = false). Read at call time from `CLASS_REGISTRY` / `enemyDefs`. **Not synced.** Long-term: replace with a per-character skill/feat.

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

## Known V1 Limitations
- No fall damage on walk-off
- No door interaction UX (all doors unlocked this sprint)
- Locked-door branch in collision/render is untested
- AI gets stuck on concave corners
- `isLineBlocked` is a stub (returns false; awaits LoS/ranged system)
- Multi-level stacking (>1) out of scope
- `canClimb` is a class flag, not yet a skill
