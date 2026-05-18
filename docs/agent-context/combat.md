---
status: shipped
updated: 2026-05-18
purpose: Combat resolution (melee + ranged + advantage/disadvantage tri-state), target selection, class schema, loadout, ability scores, level-up / multiclass. Read when the task touches attacks, classes, or character creation.
---

# Combat, Classes, Loadout

## Class Definition Schema
Each class file in `shared/data/classes/` exports a const (see `fighter.js` / `monk.js` / `barbarian.js`):

- `id` — string key matching `CLASS_REGISTRY` entry
- `name` — display label (e.g. `'Fighter'`); used in combat-log build summaries
- `hitDie` — e.g. 10 for fighter, 8 for monk
- `baseAbilityScores` — `{ str, dex, con, int, wis, cha }`. Used for attack rolls, saves, AC
- `getStartingHp(conMod)` — returns the **level-1 max-die** HP value: `(hitDie + conMod) * HP_MULTIPLIER`. Subsequent levels use the SRD-average formula in `class-progression.computeHpGainForLevel`; the two coexist by design.
- `startingWeaponId`, `startingArmorId` — item ids (`''` = none)
- `unarmoredDefense` — optional string key (e.g. `'wis'` for monk). AC = 10 + DEX mod + [stat] mod when no armor and no shield. **Activates if any taken class grants it** (see `getDerivedClassFeatures`); applied inside `recomputeStats`.
- `saveProficiencies` — array of ability keys. **First-class only post-multiclass** (SRD rule); reads off `player.class` (the primary class).
- `levels: { [n]: { features, grants } }` — per-level progression table. `features` is the list of ability ids granted at level `n` (seeded onto the hotbar by `applyClassLevel` on the **first** time a player takes any level in that class). `grants` carries passive metadata (`fightingStyle`, `feat`). MVP only fills level 1; 2 and 3 are explicit stubs.
- `rageUses` — Barbarian per-class resource pool. Top-level (not per-level). `applyClassLevel` seeds `rageUsesRemaining` from this on the first Barbarian level; `_longRest` refills it on descend.
- `gearlessLevelCap` — `3` for every MVP class. Read by `class-progression.getMaxLevelForClass`. Will become gear-dependent later.
- `canClimb: bool` — Monk true; Fighter/Barbarian false. **OR across all taken classes** via `getDerivedClassFeatures`. Read at call time by `MovementSystem`/`AISystem`. **Not synced.**

## Level-Up + Multiclass (`shared/logic/class-progression.js`)

Pure module — no framework or RNG deps. Owns the single mutation path for character level.

- `PlayerState.classLevels: MapSchema<string, number>` — per-class totals; source of truth for build state.
- `PlayerState.levelUpHistory: ArraySchema<string>` — ordered class ids; index `i` = class chosen at level `i+1`. `levelUpHistory[0]` is the **primary class** (used for starting equipment + save proficiencies only).
- `PlayerState.pendingLevelUp: boolean` — true between descend and `choose_level_up`. While set, server drops `move` / `attack` messages and client locks input + opens `LevelUpModal`.
- `PlayerState.level` — cached `sum(classLevels.values)`. Invariant: only `applyClassLevel` mutates this trio.

Flow:
1. `DungeonRoom.onJoin` calls `applyClassLevel(player, classId)` to seed level 1 — this initializes `classLevels`, `levelUpHistory`, `level`, and (on first-in-class) seeds the per-class resource pool (`rageUsesRemaining`, `secondWindAvailable`). HP for the join seed is then patched to `classDef.getStartingHp(conMod)` (max-die formula, level-1 only).
2. `_descendTo` runs `_longRest` on every alive player, then sets `pendingLevelUp = true`.
3. `choose_level_up { classId }` validates eligibility via `getEligibleClassChoicesForLevelUp` (MVP: untaken classes only), calls `applyClassLevel`, calls `recomputeStats`, clears the flag, seeds new features onto the first empty hotbar slot (or emits a `combat_log` notice if none), and broadcasts the build summary.

Derived features (`getDerivedClassFeatures(player)`) — consult instead of `CLASS_REGISTRY[player.class].X` for any passive that should activate after multiclass:

| Field | Rule | Callsite |
|---|---|---|
| `fightingStyle` | First non-null `levels[n].grants.fightingStyle` across taken classes | `CombatSystem.playerAttack` (Dueling) |
| `unarmoredDefense` | First non-null `def.unarmoredDefense` across taken classes | `equipment.recomputeStats` (AC) |
| `canClimb` | OR across all taken classes | `MovementSystem.update` |

## Loadout Model
`DungeonRoom.onJoin` branches on the raider pack loaded from `playerStore`:

- **Empty pack** → class default weapon/armor equipped, bag empty (free starter loadout).
- **Non-empty pack** → no class defaults; items go to bag, server auto-equips first weapon/armor/shield, auto-assigns consumables to hotbar.

Class default gear extracted at run-end enters the raider pack normally and triggers the non-empty branch on the next run.

## Ability Scores
- `PlayerState` carries `str, dex, con, int, wis, cha`. Set on join from client point-buy selection; **validated server-side** via `validateAbilityScores` in `shared/logic/character.js` (enforces all six keys present, range `[SCORE_MIN, SCORE_MAX]`, point cost ≤ `POINT_BUY_BUDGET`). Falls back to `classDef.baseAbilityScores` if invalid. `client/src/ui/hub/RaiderPanel.js` calls the same validator pre-submit as a defensive check.
- Point-buy budget: 27 points, scores 8–16, non-linear cost via `POINT_COST` in `shared/data/constants.js`. UI in `client/src/ui/hub/ClassPanel.js`.
- Mutable during run (potions, ASIs). Call `recomputeStats(player)` (from `shared/logic/equipment.js`) after any change to keep derived values (AC, etc.) in sync.

## Attack Resolution (`shared/logic/combat.js`)
- `resolveAttack(...)` takes `sources: Array<{ kind: 'advantage' | 'disadvantage', reason: string }>`. Cancellation is binary per SRD: any advantage + any disadvantage → normal roll. `resolveRollMode(sources)` is the pure helper; the result carries `rollMode` + `rollModeSources` (the winning side) so combat-log labels can surface why.
- Advantage path: 2d20 keep higher; nat-1 only if both dice are 1; nat-20 if either die is 20.
- Disadvantage path: 2d20 keep lower; nat-1 if either die is 1; nat-20 only if both are 20.
- Sources are assembled where they're computed (no registry). Today's wired-up sources:
  - **High-ground** advantage — `attacker.elevation === 1 && target.elevation === 0`. Player main/offhand/MA and enemy attacks all check this. Asymmetric: no reverse disadvantage. See `agent-context/geometry-elevation.md`.
  - **Long-range** disadvantage — ranged attacks where distance > `weapon.range.normal` and ≤ `weapon.range.long`.
  - **Foe-adjacent** disadvantage — ranged attacks with any living non-target enemy within `ADJACENT_FOE_PX` of the attacker.
- Combat log renders `d20:N [adv: a, b — high-ground]` or `d20:N [dis: a, b — long range, foe adjacent]`. Cancelled sources don't appear.

## Attack Dispatch (`pickAttackMode`)
- `pickAttackMode(weapon, distance)` in `shared/logic/combat.js` returns `'melee' | 'ranged' | 'thrown' | null`. Single source of truth for the dispatch branch in `playerAttack`.
- `'melee'` — `weapon.type === 'melee'` and `distance ≤ MELEE_HIT_RANGE_PX`. Also returned for `null` weapon (empty slot → unarmed) at melee distance.
- `'ranged'` — `weapon.type === 'ranged'` and `distance ≤ weapon.range.long`. Caller is responsible for adding long-range disadvantage when `distance > weapon.range.normal`.
- `'thrown'` — `weapon.type === 'melee'` AND `weapon.thrown` is set AND target is beyond `MELEE_HIT_RANGE_PX` but within `weapon.thrown.range.long`. Reserved branch — no weapon ships with `thrown` today; `playerAttack` returns `invalid_target` defensively if it fires.
- `null` — beyond every viable mode → caller denies with `'out_of_range'`.

## Ranged Combat
- Shortbow (1d6 piercing, range `ft(80)`/`ft(320)`) and longbow (1d8 piercing, range `ft(150)`/`ft(600)`). Both two-handed; longbow heavy. DEX-keyed. Live in `shared/data/weapons/ranged.js`; merged with melee in `shared/data/weapons/index.js` (unified `WEAPON_REGISTRY`).
- Infinite arrows in v1 — no ammunition model.
- **Target required.** Ranged weapons with no `targetId` reply `attack_denied: 'no_target'`. No nearest-enemy fallback. Phrased per-weapon (`type: 'ranged'`), not as a global ranged-combat invariant — future ranged weapons whose target is a point or environment object will set their own targetability rules on the weapon def.
- **LoS gate** — `isLineBlocked(x1, y1, x2, y2, obstacles)` in `shared/logic/geometry.js`. Caller passes pre-filtered obstacle rects; `DungeonRoom.attack` builds the list as static walls + currently-locked-door rects. Platforms never block.
- **Arrows are cosmetic.** Server resolves to-hit instantly and broadcasts `projectile_fired` with `{attackerId, fromX, fromY, toX, toY, hit, style: 'arrow'}`. Client tweens a dot from→to over 250 ms; misses overshoot by 15%. The `style` discriminator carries forward to bolts, thrown daggers, firebolts, magic missiles — all reuse the same wire shape.
- **Ranged enemies (forward note)**: `enemyAttack` currently builds a weapon-shaped object inline from `enemyDef.damageDice/damageBonus/damageType`. When the first ranged enemy lands, the same `pickAttackMode` branch can apply — either give enemies a `WEAPON_REGISTRY` id or carry a `kind: 'ranged'` weapon shape on the stat block.

## Target Selection
- `playerAttack(state, sessionId, enemyDefs, targetId?, geometry?)` in `server/systems/CombatSystem.js`. `geometry = { obstacles }` is required for ranged LoS; melee ignores it.
- With `targetId`: validates exists + alive. Subsequent gates (`pickAttackMode` → range, ranged LoS) run from there. Failures return `{ denied: 'out_of_range' | 'invalid_target' | 'no_target' | 'no_line_of_sight' }` — **cooldown is not consumed**.
- Without `targetId`: melee weapons fall back to nearest-living-enemy. Ranged weapons return `'no_target'`.
- `DungeonRoom` `attack` handler forwards `targetId`, builds the LoS obstacle list, and replies `attack_denied` per-client on denial. Broadcasts `projectile_fired` on successful ranged attacks.
- Selection is **client-side only**, lives on `DungeonScene._selectedEnemyId`. Not on `PlayerState`; other players don't see your reticle.
- Client controls: pointer-down hit-tests living enemies (hit → select, miss → clear); Tab cycles enemies sorted by distance. **Tab range is weapon-aware**: ranged weapons use `weapon.range.long`, else `MELEE_SELECT_RANGE_PX`. Selection auto-clears when the target dies or the floor changes.

## Kill Attribution (DEFERRED)
`PlayerState.kills` not implemented. `run_history.kills` always 0; column exists for future use. `_buildRunMeta` returns `kills: 0` literally. When attribution lands, increment in `CombatSystem` on enemy death.

## Reference Files (read before coding)
- `shared/types/player.js` and `shared/data/constants.js` (shapes + tuning)
- `server/state/PlayerState.js` — authoritative runtime schema
- `server/state/EnemyState.js`
- The specific file being modified; a structural reference file if creating something new
