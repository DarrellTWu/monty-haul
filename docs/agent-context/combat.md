---
status: shipped
updated: 2026-05-14
purpose: Combat resolution, class schema, loadout, ability scores. Read when the task touches attacks, classes, or character creation.
---

# Combat, Classes, Loadout

## Class Definition Schema
Each class file in `shared/data/classes/` exports a const (see `fighter.js` / `monk.js`):

- `id` — string key matching `CLASS_REGISTRY` entry
- `hitDie` — e.g. 10 for fighter, 8 for monk
- `baseAbilityScores` — `{ str, dex, con, int, wis, cha }`. Used for attack rolls, saves, AC
- `getStartingHp(conMod)` — function returning starting HP
- `startingWeaponId`, `startingArmorId` — item ids (`''` = none)
- `unarmoredDefense` — optional string key (e.g. `'wis'` for monk). When set, no armor and no shield, AC = 10 + DEX mod + [stat] mod. Handled in `DungeonRoom.onJoin` and `_recomputeStats`
- `saveProficiencies` — array of ability keys
- `fightingStyle` — string or null; passed to `CombatSystem` for Dueling bonus etc.
- `classFeatures` — array of ability ids seeded into hotbar slots 0–N on join (e.g. `['rage']`)
- `rageUses` — optional, Barbarian only for now
- `feat` — starting feat id string
- `canClimb: bool` — Monk true; Fighter/Barbarian false. Read at call time by `MovementSystem`/`AISystem`. **Not synced.** Long-term: replace with a per-character skill/feat. See `agent-context/geometry-elevation.md`.

## Loadout Model
`DungeonRoom.onJoin` branches on the raider pack loaded from `playerStore`:

- **Empty pack** → class default weapon/armor equipped, bag empty (free starter loadout).
- **Non-empty pack** → no class defaults; items go to bag, server auto-equips first weapon/armor/shield, auto-assigns consumables to hotbar.

Class default gear extracted at run-end enters the raider pack normally and triggers the non-empty branch on the next run.

## Ability Scores
- `PlayerState` carries `str, dex, con, int, wis, cha`. Set on join from client point-buy selection; **validated server-side** (currently only checks keys exist — see `architecture-review-2026-05-14.md` §3.2 for the open trust gap). Falls back to `classDef.baseAbilityScores` if invalid.
- Point-buy budget: 27 points, scores 8–16, non-linear cost via `POINT_COST` in `shared/data/constants.js`. UI in `HubScene.js` class panel.
- Mutable during run (potions, ASIs). Call `_recomputeStats(player)` after any change to keep derived values (AC, etc.) in sync.

## Attack Resolution (`shared/logic/combat.js`)
- `resolveAttack(...)` accepts optional `advantage: boolean`.
- When `advantage` true: rolls 2d20, keeps higher; natural 1 / natural 20 / hit threshold use the kept die. Returns `advantageRolls: [a, b]` (kept + discarded).
- `CombatSystem` computes `advantage = attacker.elevation === 1 && target.elevation === 0` at every call site (player main + offhand + monk MA, enemy attack). Asymmetric — no reverse disadvantage. Combat log renders `d20:N [adv: a, b]` when active. See `agent-context/geometry-elevation.md`.

## Kill Attribution (DEFERRED)
`PlayerState.kills` not implemented. `run_history.kills` always 0; column exists for future use. `_buildRunMeta` returns `kills: 0` literally. When attribution lands, increment in `CombatSystem` on enemy death.

## Reference Files (read before coding)
- `shared/types/player.js` and `shared/data/constants.js` (shapes + tuning)
- `server/state/PlayerState.js` — authoritative runtime schema
- `server/state/EnemyState.js`
- The specific file being modified; a structural reference file if creating something new
