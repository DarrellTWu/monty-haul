---
status: shipped
updated: 2026-07-13
purpose: Combat resolution (melee + ranged + advantage/disadvantage tri-state), knockback & positioning, target selection, class schema, levels 1–3 features, subclasses + emblem unlocks, loadout, ability scores, level-up / multiclass. Read when the task touches attacks, classes, or character creation.
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
- `levels: { [n]: { features, grants } }` — per-level progression table, filled for levels 1–3. `features` is the list of ability ids granted at level `n` (must exist in `ABILITY_REGISTRY`, `shared/data/abilities.js`; seeded onto the hotbar by the `choose_level_up` handler when `applyClassLevel` returns them). `grants` carries passive metadata: `fightingStyle`, `feat`, `dangerSense`, `ki`, `unarmoredMovementFt`, `rageUses` (absolute override), `sneakAttack` (Rogue 1 — display marker; the mechanic keys off rogue class level), `subclassChoice`.
- `subclasses: { [subclassId]: { id, name, grants } }` — subclasses reachable at `SUBCLASS_UNLOCK_LEVEL` (3). Subclass `grants`: `critRange` (Champion 19), `frenzy` (Berserker), `openHandTechnique` (Open Hand), `skirmish` (Skirmisher).
- `startingItemIds` — extra bag items for the free starter loadout (empty-raider-pack joins only). Each class seeds its basic subclass emblem here.
- `rageUses` — Barbarian resource pool at level 1; `levels[3].grants.rageUses = 3` overrides upward. Read through `getRageUsesMax(player)`; `_longRest` refills from it on descend.
- `gearlessLevelCap` — `3` for every MVP class. Read by `class-progression.getMaxLevelForClass`. Will become gear-dependent later.
- `canClimb: bool` — Monk true; Fighter/Barbarian false. **OR across all taken classes** via `getDerivedClassFeatures`. Read at call time by `MovementSystem`/`AISystem`. **Not synced.**

## Level 1–3 Features (current roster)

| Class | 1 | 2 | 3 |
|---|---|---|---|
| Fighter | Second Wind (heal 1d10 + fighter class level, 1/rest), Dueling | Action Surge (`applyActionSurge`: reset attack timer, 1/rest) | Champion via `champion_sigil` — crit on 19–20 (`attacker.critRange`; a 19 crits only if the total also hits — nat-20-only auto-hit preserved) |
| Barbarian | Rage (+2 melee dmg, resist physical, 30s), Unarmored Defense (CON) | Reckless Attack (hotbar **toggle**, `'reckless'` in `conditions` with no timer: adv on your melee attacks, foes gain adv on you; cleared on long rest), Danger Sense (advantage on DEX saves — wired into trap saves via `resolveSave({ advantage })`) | Berserker via `berserker_totem` — Frenzy: one extra main-weapon attack per Attack event while raging; rage pool 2 → 3 |
| Monk | Unarmored Defense (WIS), Martial Arts (bonus unarmed strike — gated on **any monk level**, not primary class) | Ki (`kiPoints`/`kiMax` = monk level, refilled on long rest) fueling Flurry of Blows (2 bonus unarmed strikes, `applyFlurryOfBlows`), Patient Defense (attackers disadv, timed condition), Step of the Wind (`'dash'` condition — ×2 speed in MovementSystem); Unarmored Movement +10 ft while no armor/shield | Way of the Open Hand via `open_hand_manual` — flurry hits stagger the target (`attackCooldownMs` pushed to `OPEN_HAND_STAGGER_MS`) |
| Rogue | Sneak Attack (passive — see §Sneak Attack below; gated on **any rogue level**) | Cunning Action (hotbar Dash: `'dash'` condition for `CUNNING_ACTION_DASH_MS`, lockout via synced `cunningActionCooldownMs` = `CUNNING_ACTION_COOLDOWN_MS`, ticked in MovementSystem, cleared by long rest; Disengage/Hide deferred — no AoO/stealth systems) | Skirmisher via `skirmisher_spurs` — Skirmish: Sneak Attack also eligible when attacker **and** target are both moving; Sneak Attack scales to 2d6 |

Ki abilities cost `KI_ABILITY_COST` (1). Tuning constants (`PATIENT_DEFENSE_DURATION_MS`, `STEP_OF_WIND_DURATION_MS`, `OPEN_HAND_STAGGER_MS`, `SUBCLASS_UNLOCK_LEVEL`, `CUNNING_ACTION_DASH_MS`, `CUNNING_ACTION_COOLDOWN_MS`, `SNEAK_ATTACK_DIE_SIDES`, `ALLY_ADJACENT_PX`) live in `shared/data/constants.js`.

## Subclass Unlock (emblem items)

`trySubclassUnlock(player, classId, carriedItemIds, itemRegistry)` in `class-progression.js` — called by the `choose_level_up` handler after `applyClassLevel`. Grants the subclass when: class level ≥ `SUBCLASS_UNLOCK_LEVEL`, no subclass yet for that class, and the player carries (bag or equipped slots) an `emblem`-category item whose `unlocks: { classId, subclassId }` matches. Result stored in `PlayerState.subclasses` (MapSchema classId → subclassId, synced). No retroactive unlock — acquiring the emblem after taking level 3 does nothing until a future pass (deliberate MVP cut). Emblems live in `shared/data/items/emblems.js`; each class's basic emblem is in its free starter loadout, so death → fresh character always re-seeds it, and extraction carries it through the raider pack.

## Level-Up + Multiclass (`shared/logic/class-progression.js`)

Pure module — no framework or RNG deps. Owns the single mutation path for character level.

- `PlayerState.classLevels: MapSchema<string, number>` — per-class totals; source of truth for build state.
- `PlayerState.levelUpHistory: ArraySchema<string>` — ordered class ids; index `i` = class chosen at level `i+1`. `levelUpHistory[0]` is the **primary class** (used for starting equipment + save proficiencies only).
- `PlayerState.subclasses: MapSchema<string, string>` — classId → subclassId; written only by `trySubclassUnlock`.
- `PlayerState.pendingLevelUp: boolean` — true between descend and `choose_level_up`. While set, server drops `move` / `attack` / `use_hotbar` messages and client locks input + opens `LevelUpModal`.
- `PlayerState.level` — cached `sum(classLevels.values)`. Invariant: only `applyClassLevel` mutates this trio.

Flow:
1. `DungeonRoom.onJoin` calls `applyClassLevel(player, classId)` to seed level 1 — this initializes `classLevels`, `levelUpHistory`, `level`, and seeds feature-keyed resource pools (`rageUsesRemaining`, `secondWindAvailable`, `actionSurgeAvailable`, ki). HP for the join seed is then patched to `classDef.getStartingHp(conMod)` (max-die formula, level-1 only).
2. `_descendTo` runs `_longRest` on every alive player, then sets `pendingLevelUp = true`.
3. `choose_level_up { classId }` validates eligibility via `getEligibleClassChoicesForLevelUp` (any class below its per-class cap of 3 — continuing a taken class and multiclassing are both legal), calls `applyClassLevel` (returns the **new level's** features for hotbar seeding), calls `recomputeStats`, attempts `trySubclassUnlock` at class level 3, clears the flag, seeds new features onto the first empty hotbar slot (or emits a `combat_log` notice if none), and broadcasts the build summary.

Derived features (`getDerivedClassFeatures(player)`) — consult instead of `CLASS_REGISTRY[player.class].X` for any passive that should activate after multiclass. Stable shape; reads `classLevels` + `subclasses`:

| Field | Rule | Callsite |
|---|---|---|
| `fightingStyle` | First non-null `levels[n].grants.fightingStyle` across taken classes | `CombatSystem.playerAttack` (Dueling) |
| `unarmoredDefense` | First non-null `def.unarmoredDefense` across taken classes ('wis' Monk, 'con' Barbarian) | `equipment.recomputeStats` (AC) |
| `canClimb` | OR across all taken classes | `MovementSystem.update` |
| `dangerSense` | OR across `levels[n].grants.dangerSense` at reached levels | `DungeonRoom._checkTraps` (DEX save advantage) |
| `unarmoredMovementFt` | Max across `levels[n].grants.unarmoredMovementFt` | `MovementSystem.update` (speed, no armor/shield) |
| `critRange` | Min across taken subclasses' `grants.critRange`, default `DEFAULT_CRIT_RANGE` (20) | `playerToAttacker` → `resolveAttack` |
| `frenzy` | OR across taken subclasses | `CombatSystem.playerAttack` (extra attack while raging) |
| `openHandTechnique` | OR across taken subclasses | `applyFlurryOfBlows` (stagger on hit) |
| `skirmish` | OR across taken subclasses | `CombatSystem.playerAttack` (Sneak Attack both-moving leg) |

Resource-pool helpers: `getKiMax(player)` (= monk level at 2+, else 0) and `getRageUsesMax(player)` — used by both `applyClassLevel` (seed) and `_longRest` (refill). `getSneakAttackDice(player)` (= ⌈rogue level / 2⌉ d6, 0 without rogue levels) is read by `CombatSystem.playerAttack`.

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
  - **High-ground** advantage — any elevation differential: `attacker.elevation > target.elevation` (three tiers exist — summit vs ground grants the same single advantage as one step up). Player main/offhand/MA and enemy attacks all check this. Asymmetric: no reverse disadvantage. See `agent-context/geometry-elevation.md`.
  - **Reckless** advantage — melee attacks while `'reckless'` is in the player's conditions (Barbarian 2 toggle); enemy attacks against a reckless player also gain advantage.
  - **Patient-defense** disadvantage — enemy attacks against a player with the `'patient_defense'` condition (Monk ki ability).
  - **Long-range** disadvantage — ranged attacks where distance > `weapon.range.normal` and ≤ `weapon.range.long`.
  - **Foe-adjacent** disadvantage — ranged attacks with any living non-target enemy within `ADJACENT_FOE_PX` of the attacker.
- Combat log renders `d20:N [adv: a, b — high-ground]` or `d20:N [dis: a, b — long range, foe adjacent]`. Cancelled sources don't appear.

## Sneak Attack (Rogue)

Once per Attack event, the **first eligible hit** — main hand, else offhand (the SRD once-per-turn rule; offhand fishing after a main-hand miss works) — adds `getSneakAttackDice(player)` d6 (⌈rogue level/2⌉; dice count doubled on crit). Damage is added before `applyDamage`, so resistances/DR apply to the total. Log tag: `(sneak +N — reason)`.

Eligibility is the pure helper `sneakAttackEligibility(...)` in `shared/logic/combat.js`; `CombatSystem.playerAttack` assembles the context. Requires a **finesse or ranged** weapon, then the first leg that applies wins:

1. `advantage` — the resolved `rollMode` is advantage (post-cancellation).
2. `ally adjacent` — another living **player** within `ALLY_ADJACENT_PX` of the target, and no disadvantage.
3. `skirmish` — Skirmisher subclass only: attacker and target are **both moving** (`vx`/`vy` non-zero at resolution tick), and no disadvantage. Works in melee and at range; long-range disadvantage therefore blocks it. Moving-window spec + 1–10 design: `docs/design/skirmisher-progression.md`.

Frenzy and Martial Arts bonus attacks never carry sneak dice (once-per-event is consumed by main/offhand, and MA is unarmed anyway).

## Knockback & Positioning (dynamic-combat Pillar 1)

Every **melee** hit shoves the target away along the attacker→target line (ranged never pushes; the killing blow doesn't push — corpses stay lootable where they fell). Full design + tuning rationale: `docs/design/dynamic-combat.md`.

- **Pure core**: `shared/logic/knockback.js` — `levelScale` (underlevel dissipation, floor `UNDERLEVEL_SCALE_FLOOR` 0.4), `computeKnockbackPx` (base `KNOCKBACK_BASE_PX` 20 scaled by attacker-total vs target level, + Barbarian bonus, − Fighter resist), `resolveKnockback` (swept push in `KNOCKBACK_STEP_PX` sub-steps — no tunneling through 2 px perimeter bands; elevation re-derived via `tryAutoClimb`; slam classification).
- **Class profile**: `getKnockbackProfile(player, hasShield)` in `class-progression.js` — Barbarian `+20 px`/level push; Fighter `25%`/level resist `+25%` with shield (requires ≥1 Fighter level), capped 95% (Fighter 3 + shield hits the cap — "next to immovable"). Enemies contribute only their def `level` (goblin/dog 1, skeleton 2 — required on new stat blocks). Base push 40 px.
- **Wall slam**: push pinned to ≤ `WALL_SLAM_BLOCKED_RATIO` (0.5) of intended (min intended 12 px) → bonus damage `floor(finalDamage × 0.5)` min 1, respects temp HP on players, can kill (attacker credited). Walls, locked doors, arena bounds, and platform side-walls (for elev-0 targets) all slam.
- **Ledge drop**: elevated target pushed across the platform edge → elevation 0 → the attacker's subsequent hits get the existing high-ground advantage. Knockback never pushes anyone *up* a platform wall (perimeters are obstacles for every elev-0 target regardless of `canClimb`).
- **Integration**: `CombatSystem._applyKnockbackToEnemy` fires at every melee hit site (main, offhand, frenzy, MA, flurry); `enemyAttack` shoves players symmetrically. Each hit in a multi-hit event pushes independently. `terrain` (`{walls, platforms, bounds}`) flows from `DungeonRoom._terrain()` into `playerAttack` (`geometry.terrain`), `applyFlurryOfBlows` (4th arg), and via `AISystem` into `enemyAttack` (5th arg). **No terrain → pushes still resolve, nothing slams** (how plain combat fixtures stay simple).
- **Climb fatigue** (Monk scaling): see `geometry-elevation.md` §Elevation Transitions — `climb_fatigue` condition (mirror `climbFatigueRemainingMs`, HUD ring `CLB`), event emitted by `MovementSystem`, applied by `DungeonRoom._tick`.
- Log surface: hit lines gain ` — slammed into the wall (+N)`, ` — knocked off the ledge!`, ` — killed!`/` — down!` suffixes.
- **Body blocking**: living same-elevation entities can't overlap — `separateCircles` (geometry.js) runs as a pairwise pass at the end of `MovementSystem.update`, with wall re-resolution + bounds clamp for displaced entities. Corpses don't block; cross-elevation pairs pass freely; spawn stacks unstack. Knockback itself resolves against rects only — a push landing on another body is separated next tick.

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

## Kill Attribution (shipped 2026-07-13)
`PlayerState.kills` (synced) increments at every enemy-death site in `CombatSystem` (main hand, offhand, frenzy, martial arts, flurry) and flows into `run_history.kills` via `_buildRunMeta`. Traps and other non-attack deaths don't attribute (no such death paths exist for enemies today).

## Reference Files (read before coding)
- `shared/types/player.js` and `shared/data/constants.js` (shapes + tuning)
- `server/state/PlayerState.js` — authoritative runtime schema
- `server/state/EnemyState.js`
- The specific file being modified; a structural reference file if creating something new
