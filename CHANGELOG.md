# Monty Haul — Development Changelog

Tracks completed work, decisions, open questions, and deferred todos by session.
Entries are newest-first within each session.

---

## Session 6 — 2026-05-16

### Completed

#### Ranged combat: shortbow + longbow with LoS and SRD disadvantage rules

Shortbow (1d6, range `ft(80)`/`ft(320)`) and longbow (1d8, range `ft(150)`/`ft(600)`) land on floor 1's starting chest. SPACE fires at the selected target through a fresh LoS gate; walls and locked doors block, platforms and unlocked doors don't. Long-range and ranged-into-melee disadvantage compose with high-ground advantage under SRD cancellation. Arrows are cosmetic-only — server resolves to-hit instantly and broadcasts a generic `projectile_fired` event with a `style` discriminator for forward-compat (bolts, thrown daggers, firebolts, magic missiles will all reuse the wire shape).

This ships the advantage/disadvantage tri-state refactor that `docs/advantage-architecture-plan.md` had been waiting on — the long-range disadvantage is exactly the second-source trigger the plan called out. Plan archived.

- `shared/data/constants.js` — `PX_PER_FOOT = 5` + `ft()` helper, `ADJACENT_FOE_PX` alias for the SRD 5-ft adjacency check.
- `shared/types/weapon.js` — explicit `kind: 'melee' | 'ranged'` discriminator, optional `range`, optional `thrown: { range, ability? }` sub-block for the future thrown-weapons sprint. **Not** `presence of range` — that would have collapsed on thrown weapons (handaxe, dagger already exist with `properties: ['thrown']`).
- `shared/data/weapons/melee.js` — every weapon gains `kind: 'melee'`. Drops its old `WEAPON_REGISTRY` export.
- `shared/data/weapons/ranged.js` (new) — `SHORTBOW`, `LONGBOW`. DEX-keyed, two-handed.
- `shared/data/weapons/index.js` (new) — unified `WEAPON_REGISTRY` barrel (melee ∪ ranged). Importers in `equipment.js`, `CombatSystem.js`, `DungeonRoom.js` migrated.
- `shared/logic/combat.js` — `resolveAttack` migrated to `sources: Array<{kind, reason}>`. New pure helper `resolveRollMode(sources)` applies the SRD binary cancellation. New `pickAttackMode(weapon, distance)` returns `'melee' | 'ranged' | 'thrown' | null` — single source of truth for the dispatch branch. Disadvantage path added: 2d20 keep lower; nat-1-if-either, nat-20-only-if-both. Result carries `rollMode` + `rollModeSources` so combat-log labels surface why (`d20:N [adv: a, b — high-ground]` or `[dis: a, b — long range, foe adjacent]`).
- `shared/logic/geometry.js` — `isLineBlocked` is no longer a stub. Liang-Barsky segment-vs-AABB sweep against caller-supplied obstacles. Caller filters (walls + locked-door rects only); platforms never block.
- `server/systems/CombatSystem.js` — `playerAttack(state, sessionId, enemyDefs, targetId, geometry)`. Dispatches via `pickAttackMode`. Ranged path: explicit target required (`denied: 'no_target'`), range gate, LoS gate (`denied: 'no_line_of_sight'`), source assembly (high-ground / long-range / foe-adjacent), single attack (no offhand, no MA), returns `projectile` descriptor. Rage damage bonus now correctly melee-only.
- `server/rooms/DungeonRoom.js` — `attack` handler builds the obstacle list once per attack (static walls + currently-locked-door rects), forwards `geometry: { obstacles }` to `playerAttack`, broadcasts `projectile_fired` on success.
- `shared/data/floors/floor1.js` — `'shortbow'` and `'longbow'` added to the starting chest.
- `client/src/scenes/DungeonScene.js` — Tab cycle range becomes weapon-aware via `weapon.kind === 'ranged' && weapon.range.long` (not "has range" — future-safe for thrown). `projectile_fired` listener tweens a dot from→to over 250 ms; misses overshoot 15%. `_renderProjectile(p)` switches on `style` for future visuals. New denial reasons surfaced in HUD log.
- `shared/tests/combat.test.js` — 30 → 46 tests. Existing high-ground cases migrated to `sources: [{ kind: 'advantage', reason: 'high-ground' }]`. New: disadvantage path (keep-lower, nat-1-if-either, nat-20-if-both), cancellation cases (1+1, 2+1, 2+0), `resolveRollMode` unit, `pickAttackMode` dispatch including forward `'thrown'` branch.
- `shared/tests/geometry.test.js` — 47 → 55 tests. `isLineBlocked` coverage (clear, crosses, misses, endpoint-inside, caller-filtered obstacles).
- `server/tests/ranged-combat.test.js` (new) — 25 cases. Bow happy path with projectile emission, no-target denial, out-of-range denial, LoS denial, long-range disadvantage label, foe-adjacent disadvantage label, advantage+disadvantage cancellation produces no label, melee regression.
- Plans archived: `docs/archive/ranged-combat-plan.md`, `docs/archive/advantage-architecture-plan.md`.

**Decisions of note:**
- **Weapon shape uses explicit `kind`, not "presence of `range`".** Thrown weapons (handaxe, dagger) already exist with `properties: ['thrown']`; adding `range` to them under a presence-check predicate would silently break the melee path. The explicit `kind` field plus optional `thrown: { range }` sub-block keeps the question explicit and reserves the future thrown-weapons sprint to a single new branch in `pickAttackMode`.
- **`arrow_fired` rejected in favour of `projectile_fired { style }`.** Every other flying thing (bolts, daggers, firebolts, magic missiles) will use this one wire shape. Locking in `arrow_fired` while there's exactly one caller would have meant rename-or-retrofit later.
- **"Ranged weapons require a target" is phrased per-weapon (on `kind: 'ranged'`), not as a global ranged-combat rule.** Future ranged things that target environment features (destructible barrels, levers), points on the floor (aoe anchors), or the caster itself (self-buffs) will set their own targetability rules on the weapon def — orthogonal to the v1 enemy-id `targetId` shape.

#### Target selection: click + Tab to designate attack targets

SPACE still attacks, but the target is now under player control. Click an enemy or Tab through nearby living enemies to designate which one SPACE hits; with no selection, the existing nearest-enemy fallback runs. Selection is client-side UI state — the server validates `targetId` on every attack and rejects out-of-range / invalid targets without consuming the attack cooldown, so the player keeps their action.

- `shared/data/constants.js` — `MELEE_SELECT_RANGE_PX = 160` (~2.5× hit range). Tab cycles enemies within this radius; click works on any rendered enemy.
- `server/systems/CombatSystem.js` — `playerAttack(state, sessionId, enemyDefs, targetId?)`. Explicit target validates exists/alive/in-range; failures return `{ denied: 'out_of_range' | 'invalid_target' }` with cooldown preserved.
- `server/rooms/DungeonRoom.js` — `attack` handler forwards `targetId`, replies `attack_denied` per-client on denial (not broadcast).
- `client/src/input/InputHandler.js` — Tab key added with `addCapture('TAB')` so the browser doesn't move focus. SPACE now fires `onAttack` callback so the scene can supply `targetId`.
- `client/src/scenes/DungeonScene.js` — `_selectedEnemyId` state, yellow selection ring per enemy, pointer-down hit-test (hit → select, miss → clear), Tab cycles by distance sorted ascending and wraps, auto-clears on death (per-frame) and floor change (via `onRemove`). `attack_denied` listener pipes "Target out of range." to HUD log.
- `server/tests/target-selection.test.js` — 17 cases: fallback path, explicit override, out-of-range/dead/nonexistent denials, cooldown gate.
- Plan archived: `docs/archive/target-selection-plan.md`.
- Docs: `protocol.md` (new `attack` payload + `attack_denied` message), `combat.md` (Target Selection section), `PROJECT_STRUCTURE.md` (new test row + corrected `conditions.test.js` count: 15 → 18).

**Decision:** Out-of-range explicit attacks fail loudly rather than falling back to nearest — preserves player intent, and forward-compatible with ranged weapons whose validation gate will be variable per-weapon. The `MELEE_SELECT_RANGE_PX` name signals where `weapon.selectRangePx` will hook in.

#### Conditions refactor → `shared/logic/conditions.js`

Extracted the hand-rolled condition-timer code from `DungeonRoom` into a pure module. The mapping `conditionId → mirror *RemainingMs field` is now defined once in `CONDITION_DEFS` instead of being re-encoded in `_useConsumable`, `_activateRage`, `_tickConditions`, and `_longRest`.

- `shared/logic/conditions.js` — `CONDITION_DEFS` + `applyCondition` / `tickConditions` / `clearPlayerConditions`. Caller owns the timer Map and broadcasts returned log strings; module is framework-free.
- `shared/tests/conditions.test.js` — 18 cases covering apply idempotency, tick decrement + expiry, multi-player isolation, false_life exhaustion, and clear semantics.
- `server/rooms/DungeonRoom.js` — ~40 LOC removed; `_tickConditions` is now a 2-line delegate. `TODO(deferred)` marker gone.
- Plan archived: `docs/archive/conditions-refactor-plan.md`.

#### Bugfix: bless potion now refreshes on re-use

Pre-refactor, a guard around the bless branch in `_useConsumable` made a second potion silently a no-op while still consuming the inventory item. The other timed potions (longstrider, false_life) already refreshed; this brings bless in line via `applyCondition`'s refresh-not-duplicate contract.

#### Bugfix: false_life condition clears when temp HP drained

Once damage absorbs the granted temp HP, the timer is immaterial — the HUD ring should go away. Added an optional `isExhausted(player)` predicate to `CONDITION_DEFS`; `tickConditions` treats exhaustion the same as timeout. `false_life` uses `p.tempHp <= 0`. Cleared within one server tick. Keeps the absorption sites (`CombatSystem.enemyAttack`, `DungeonRoom._checkTraps`) untouched — no plumbing of the timer Map into combat code.

### Docs

- `CLAUDE.md`, `docs/README.md`, `docs/DOC_PRINCIPLES.md`, `docs/PROJECT_STRUCTURE.md` — dropped the `shared/logic/conditions.js — not built` deferred-item references; added the module + test to the structure tables.

---

## Session 5 — 2026-04-15

### Completed

#### Enemy roster expansion: Dog and Skeleton (new stat block files)

Refactored `shared/data/enemies/tier1.js` from a monolithic object to a re-export barrel. Each enemy now lives in its own file for per-enemy tuning isolation.

- `shared/data/enemies/goblin.js` — Full SRD Goblin stat block with engine values; `speed: 120` (tuned down from SRD 150 for feel)
- `shared/data/enemies/dog.js` — SRD Mastiff analog; `speed: 200` (kept at full SRD speed — the speed differential is the defining gameplay trait); Pack Tactics TODO noted
- `shared/data/enemies/skeleton.js` — SRD Skeleton with DR 5/bludgeoning instead of SRD vulnerability; makes Mace a meaningful counter-pick and exercises the `damageReduction` system
- `shared/data/enemies/tier1.js` — Now re-exports `GOBLIN`, `DOG`, `SKELETON` from the three individual files
- `server/rooms/DungeonRoom.js` — Spawns Dog at (1300,300) and Skeleton at (300,900); each at a separate corner from the two Goblins

**Decision:** DR 5/bludgeoning chosen over SRD vulnerability (double damage) because the DR system was already implemented and provides more nuanced player decision-making (mace always better vs. skeleton, not just "double damage on bludgeoning"). The vulnerability path is still a TODO in `applyDamage`.

#### Chest loot system and expanded SRD equipment rules

**Chest looting:**
- `server/state/ChestState.js` — Schema with `id`, `x`, `y`, `open`, `items: ArraySchema<string>`
- `server/rooms/DungeonRoom.js` — `loot` message handler; range-checked (`CHEST_LOOT_RANGE_PX`); pushes item ids to `player.inventory`; marks chest open. Chest spawns at (880,600) with `shield`, `dagger`, `greataxe`, `mace`, `half_plate`, `healing_potion`, `bless_potion`

**New weapons:**
- `shared/data/weapons/melee.js` — Added `DAGGER` (1d4 piercing, finesse+light+thrown) and `MACE` (1d6 bludgeoning, simple; `bludgeoning` type bypasses skeleton DR)

**Shield and offhand slot:**
- `server/rooms/DungeonRoom.js` — `equip` message handler extended; offhand slot accepts one-handed weapons OR shields; two-handed weapons blocked in offhand
- `shared/data/items/shields.js` — `SHIELD_REGISTRY` with shield `+2 AC`; used by `_recomputeAC`
- `server/systems/CombatSystem.js` — `applyDueling` applies Dueling style +2 damage unless offhand holds a weapon (not shield); `getEffectiveWeapon` upgrades longsword to 1d10 when no offhand equipped (versatile rule)

**Armor in bag:**
- Half Plate (`AC 15 + DEX capped at +2`) added as chest loot; equippable via armor slot

**Consumables:**
- `shared/data/items/consumables.js` — `CONSUMABLE_REGISTRY` with `healing_potion` (2d4+2) and `bless_potion` (+1d4 to attack rolls, 60s duration)
- `server/rooms/DungeonRoom.js` — `_useConsumable` handler; `use_hotbar` message triggers it

#### Trap system

- `server/state/TrapState.js` — Schema with `id`, `x`, `y`, `cooldownMs`
- `server/rooms/DungeonRoom.js` — Spike trap spawns at (1380,160); `_checkTraps` per tick; DEX save vs. DC 15 (`resolveSave`); full damage on fail, half on success; `TRAP_COOLDOWN_MS` prevents re-triggering immediately; combat log message with save result

#### Combat log (HUD)

- `client/src/scenes/HUDScene.js` — 8-line scrolling text log in bottom-right; `addLog(message)` method called by `DungeonScene` on `combat_log` broadcast
- `server/rooms/DungeonRoom.js` — Broadcasts `combat_log` for: player attacks, enemy attacks, Second Wind, consumable use, trap triggers
- `server/systems/CombatSystem.js` — `rollStr` helper formats d20 breakdown (`d20:14 +2p +3str = 19 vs AC 15`) for both player and enemy attacks; `_damageTag` appends `(resisted)`, `(DR -5 = 3 dealt)`, `CRIT!` as applicable

#### Hotbar system

- `server/state/PlayerState.js` — `hotbar: ArraySchema<string>` (10 slots); `conditions: ArraySchema<string>`; `blessRemainingMs: number`
- `server/rooms/DungeonRoom.js` — `assign_hotbar` message handler (validates id is `second_wind` or a known consumable); `use_hotbar` message handler; hotbar slot cleared after consumable is consumed
- `client/src/scenes/InventoryScene.js` — Hotbar row at panel bottom; drag abilities/items onto numbered slots [1-0]; `sendAssignHotbar`; labels update from server state

#### Inventory UI overhaul

Full equipment panel redesign with:
- Weapon, Offhand, Armor slots — click to equip-here or unequip; drop zone highlight on drag-over
- Bag items — single-click selects (then click slot to equip there); double-click auto-equips; drag to slot
- Saving throws panel (left column); Class Features with draggable Second Wind ability
- Blocked-item graying (SRD constraint enforcement: two-handed + offhand, shield + two-handed)
- Hotbar row with drag-to-assign

#### Bless condition HUD ring

- `client/src/scenes/HUDScene.js` — Bless ring immediately left of the attack ring; drain arc over `conditionDurationMs` (60s); hidden when inactive; timer countdown label

#### Two-Weapon Fighting (TWF)

- `server/systems/CombatSystem.js` — Offhand attack fires after main attack when a light weapon is in the offhand; ability mod removed from offhand damage if positive (SRD rule); separate log line for offhand attack

#### Longstrider and False Life potions

Two new timed-condition consumables added to the chest loot table alongside the existing healing and bless potions.

**Longstrider Potion** (`longstrider_potion`):
- SRD Longstrider: +10 ft speed for 1 hour. Tuned here to 2 minutes.
- Grants condition `'longstrider'` for 120s; `MovementSystem` adds `LONGSTRIDER_SPEED_BONUS_PX = 50` to player speed while active.
- `server/state/PlayerState.js` — `longstriderRemainingMs` synced each tick for HUD ring.
- `server/systems/MovementSystem.js` — reads `player.conditions` to apply bonus; imported `LONGSTRIDER_SPEED_BONUS_PX` from constants.
- `shared/data/constants.js` — `LONGSTRIDER_SPEED_BONUS_PX = 50` (10 ft × 5 px/ft).

**False Life Potion** (`false_life_potion`):
- SRD False Life: 1d4+4 temporary HP, tuned to 2-minute duration.
- Grants `tempHp` (rolled on use; re-applying replaces current value). `tempHp` absorbs damage before regular HP in both `enemyAttack` and trap damage handlers.
- When the condition expires, `tempHp` is zeroed.
- `server/state/PlayerState.js` — `falseLifeRemainingMs` and `tempHp` synced each tick.
- `server/systems/CombatSystem.js` — `enemyAttack` absorbs `finalDamage` through `tempHp` before reducing `hp`.
- `server/rooms/DungeonRoom.js` — trap damage handler also absorbs through `tempHp` first.

**Files changed:**
- `shared/data/items/consumables.js` — added `LONGSTRIDER_POTION`, `FALSE_LIFE_POTION`; both in `CONSUMABLE_REGISTRY`
- `shared/data/constants.js` — `LONGSTRIDER_SPEED_BONUS_PX`
- `server/state/PlayerState.js` — three new schema fields
- `server/systems/MovementSystem.js` — longstrider speed check
- `server/systems/CombatSystem.js` — temp HP absorption in `enemyAttack`
- `server/rooms/DungeonRoom.js` — chest loot, `_useConsumable` handlers, `_tickConditions` expiry, trap damage
- `client/src/scenes/InventoryScene.js` — `CONSUMABLE_DISPLAY` entries for bag/hotbar rendering

#### Hotbar HUD display and condition ring system

**Hotbar display (right of attack ring):**
- 10 compact slots starting at x = 671 (ATK right edge + 14px gap), centered on the ring row (CY = 668).
- Each slot: dark background, `[N]` key label top-left, short item name center-bottom.
- Empty slots show `—` in dim color; bound slots show short name in gold (`ffdd88`).
- Short names: `Heal Pot`, `Bless`, `Stride`, `F.Life`, `2nd Wind`.

**Condition ring system (left of attack ring):**
- Replaced the old per-condition `_drawBlessRing` with a unified `_updateConditionRing` helper that takes `{ gfx, label, timerLabel, cx, remainingMs, durationMs, color, dimColor, timerText }`. Dim track always drawn; active arc drains clockwise over duration; leading dot on arc end.
- Three condition rings, left to right: `THP` (False Life, mint `#55eebb`) · `SPD` (Longstrider, cyan `#44ddff`) · `BLS` (Bless, purple `#aa55ff`) · ATK ring.
- False Life ring timer label shows current `tempHp` as `Nhp` rather than seconds — more actionable information.

**File changed:** `client/src/scenes/HUDScene.js`

---

### Bug fixes (2026-04-15)

#### Enemy names not appearing in combat log

**Problem:** `_spawnEnemy` set `enemy.type = def.type`, but no enemy definition file has a `type` field (they have `id`). Schema defaulted to `''`, causing every log line to read `"enemy → Fighter"` instead of `"goblin → Fighter"`.

**Fix:** Changed `enemy.type = def.type` to `enemy.type = def.id` in `server/rooms/DungeonRoom.js`.

#### Bless potion shows no bonus in combat log

**Problem:** `resolveAttack` computed `conditionBonus` (the Bless 1d4) and added it to `result.roll`, but never returned it. `rollStr` only showed `d20 + prof + ability`, so the math appeared inconsistent (totals didn't add up) and the bonus was invisible.

**Fix:** Added `conditionBonus` to all return paths in `resolveAttack` (`shared/logic/combat.js`). Updated `rollStr` in `CombatSystem.js` to append `+Nbls` when non-zero, producing e.g. `d20:14 +2p +3str +3bls = 22`.

**Files changed:** `shared/logic/combat.js`, `server/systems/CombatSystem.js`

#### Cannot drag items out of equipment slots

**Problem:** Equipment slot zones were registered as drop targets but were not set as draggable, so Phaser never fired `drag` events on them. Equipped items had no drag-out path.

**Fix:** Each slot zone (`_weaponZone`, `_offhandZone`, `_armorZone`) now calls `this.input.setDraggable(zone)`. Added `drag` / `dragend` handlers: during drag the slot's visual button follows the pointer; on `dragend`, if the zone was actually dragged, `sendUnequip(slot)` is called (returning the item to the bag). Click-to-equip/unequip is guarded by a `dragging` flag so it only fires on true clicks.

**File changed:** `client/src/scenes/InventoryScene.js`

---

## Session 4 — 2026-04-12

### Completed

#### SRD correctness: armor-derived AC and weapon damage display

**Problem 1 — Magic-number AC:** `FIGHTER.baseAC = 16` had no armor data behind it.
**Fix:** Created `shared/data/armor/armor.js` with all SRD armor definitions and `computeAC(armorDef, dexMod, hasShield)`. Added `startingArmorId: 'chain_mail'` to `FIGHTER`. Server now calls `computeAC(ARMOR_REGISTRY['chain_mail'], dexMod)` on join to derive `player.ac = 16`.

**Decision:** Chain Mail (heavy armor, baseAC 16, STR 13 requirement) is the SRD item that produces AC 16 with no DEX contribution. Heavy armor was chosen over medium + shield (Breastplate 14 + DEX +2 + shield = 18 would be too high) or half-plate because it matches a starting fighter loadout and the exact AC value of 16.

**Problem 2 — Weapon damage label:** `WEAPON_DISPLAY.longsword.detail` was `'1d8+3 slashing'`, presenting the STR modifier as if it were a weapon property.
**Fix:** Changed to `'1d8 slashing'`. The STR modifier is now computed from `FIGHTER_SCORES.STR` in `_refresh()` and appended as a separate label (`+3 STR`) on the equipped weapon button.

**Files changed:**
- `shared/data/armor/armor.js` — new file; all SRD armors + `computeAC` + `ARMOR_REGISTRY`
- `shared/data/classes/fighter.js` — removed `baseAC: 16`, added `startingArmorId: 'chain_mail'`
- `server/state/PlayerState.js` — added `equippedArmorId: 'string'` to schema
- `server/rooms/DungeonRoom.js` — imports `ARMOR_REGISTRY` + `computeAC`; computes AC on join; sets `player.equippedArmorId`
- `client/src/scenes/InventoryScene.js` — fixed weapon detail string; STR modifier displayed separately; armor row added to equipment panel reading from `player.equippedArmorId`

---

## Session 3 — 2026-04-11

### Completed

#### Playable room: Fighter vs. two Goblins

Built the full server-authoritative game loop to prove out the engine.

**Server:**
- `server/state/PlayerState.js` / `EnemyState.js` / `GameState.js` — Colyseus `@Schema` classes using `createRequire` + `defineTypes` pattern (required because `colyseus` and `@colyseus/schema` are CJS builds that Node.js ESM named-export synthesis cannot analyze statically)
- `server/systems/MovementSystem.js` — applies player velocity (normalized direction × `BASE_SPEED_PX_PER_SEC`) and enemy velocity (px/sec stored directly in `vx/vy`) to positions each tick; clamps to room bounds
- `server/systems/AISystem.js` — idle→aggro transition on `COMBAT_DETECTION_RADIUS`; moves toward nearest player at `def.speed` px/sec; triggers `enemyAttack` when within `MELEE_HIT_RANGE_PX`
- `server/systems/CombatSystem.js` — `playerAttack` reads weapon from `WEAPON_REGISTRY[player.equippedWeaponId]`; `enemyAttack` constructs weapon-shaped object from enemy def fields; both call `resolveAttack` + `applyDamage` from `shared/logic/combat.js`
- `server/rooms/DungeonRoom.js` — full `onCreate`/`onJoin`/`onLeave`; spawns fighter at (800,600) and two goblins at (300,300) and (1300,900); handles `move`, `stop`, `attack`, `equip`, `unequip` messages; `setSimulationInterval` ticks at `SERVER_TICK_RATE_HZ.tier1`

**Client:**
- `client/src/network/ColyseusClient.js` — singleton module; `joinDungeon()`, `sendMove()`, `sendStop()`, `sendAttack()`, `sendEquip()`, `sendUnequip()`, `getRoom()`
- `client/src/input/InputHandler.js` — WASD + arrows → move, Space → attack (keydown only), Tab → `onTabDown` callback; `this.enabled` flag suppresses move/attack while inventory is open; Tab fires through disabled state
- `client/src/scenes/DungeonScene.js` — async `create()`, joins room, renders players and enemies as colored circles (`Phaser.add.arc`) with `Graphics` HP bars; camera follows own player (gold tint); launches `HUDScene`; `_toggleInventory()` manages `InventoryScene`
- `client/src/scenes/HUDScene.js` — fixed-camera overlay; attack timer ring (circumference drawn clockwise over 3-second cooldown); color shifts orange → yellow → lime → green as ready; "ATK" label and countdown/READY text
- `client/src/scenes/InventoryScene.js` — Tab to open/close; left panel: name, level, HP, AC, ability scores; right panel: weapon slot (click = unequip) + bag (click = equip); refreshes from server state each frame

**Decisions:**
- Placeholder graphics (colored circles) used throughout; sprite replacement will be a separate pass
- Placeholder room (bordered rectangle); tilemap system (pre-built rooms + procedural combination) is a future task
- Enemy velocity stored as px/sec in `vx/vy` so `MovementSystem` applies it uniformly; player velocity stored as normalized direction and scaled in `MovementSystem`
- `vite.config.js` updated with `server: { fs: { allow: ['..'] } }` so client scenes can import from `shared/` via relative paths

**Known deferred issue:**
- Canvas appears blurry on high-DPI displays because Phaser does not set `devicePixelRatio` on the canvas by default. Fix: set `resolution: window.devicePixelRatio` in Phaser config and update scale mode accordingly. Deferred until more UI/graphics are in place.

---

#### Weapon and armor data

- `shared/data/weapons/melee.js` — `LONGSWORD`, `SHORTSWORD`, `HANDAXE`, `GREATAXE`, `UNARMED`; `damageBonus: 0` on all (ability modifier added at call site in `resolveAttack`, not baked into weapon)
- `shared/data/enemies/tier1.js` — `GOBLIN` (hp 7, ac 15, flat attackBonus 4)
- `shared/data/classes/fighter.js` — `FIGHTER` with base ability scores, `getStartingHp(conMod)`, proficiency via `getProficiencyBonus(level)` in `combat.js`

---

## Session 2 — 2026-04-10

### Completed

#### `shared/logic/combat.js` — Pure combat resolution
Implemented the full attack resolution module as specified in tech_spec.md §4 and gdd.md §3.

**Functions:**
- `rollDice(count, sides, rng)` — NdX roller; rng-injected for deterministic testing
- `getModifier(abilityScore)` — Standard SRD formula: `Math.floor((score - 10) / 2)`
- `getProficiencyBonus(level)` — Standard SRD table: `Math.floor((level - 1) / 4) + 2`
- `resolveAttack({ attacker, target, weapon, conditions, rng })` — Full d20 attack resolution
- `applyDamage({ target, damage, damageType })` — Resistance, minimum-1, overkill

**Decisions made:**
- **Natural 1 early return:** On a natural 1, the function returns immediately before consuming rng for condition bonuses (e.g., Bless d4). This avoids burning rng values on an already-resolved result. `roll` returns the raw d20 (1), not a computed total.
- **Crit mechanics:** Crit doubles the dice count via `CRIT_MULTIPLIER` (e.g., 1d8 becomes 2d8). Flat bonuses — ability modifier, enhancement, damageBonus — apply once regardless of crit. This matches SRD standard and is the most common real-table interpretation.
- **Minimum-1 in `applyDamage`, not `resolveAttack`:** `resolveAttack` returns raw damage. This lets callers distinguish "low roll" (e.g., 0 from a tiny weapon + negative modifier) from "resistance floored to 0". Both are clamped to 1 by `applyDamage`.
- **Enemy vs. player attacker detection:** Presence of `attacker.abilityScores` determines which code path runs. Players compute attack bonus from ability scores + proficiency + enhancement; enemies use a pre-computed flat `attackBonus`. No separate function or type guard needed.
- **`conditions` parameter vs. `attacker.conditions`:** The explicit `conditions` param is the canonical source for a given resolution call and overrides `attacker.conditions`. If omitted, falls back to `attacker.conditions`. This lets the caller override conditions for hypothetical calculations without mutating player state.
- **`weapon` for enemy attacks:** Not resolved in this session. Enemies carry `damageDice`/`damageBonus`/`damageType` directly. If `weapon` is null/undefined, `resolveAttack` falls back to reading those fields from `attacker`. The CombatSystem.js caller can also construct a weapon-shaped object from enemy fields — both paths work.

**TODOs left in code:**
- Vulnerability (double damage) — not in scope for Wave 1 enemies; `// TODO` comment in `applyDamage`
- Further condition attack bonuses (Guidance, Bardic Inspiration) — `// TODO` in `resolveAttack`
- Enemy attack normalization convention — `// TODO` comment at top of file for CombatSystem.js author

---

#### `shared/data/constants.js`
Created with all values from tech_spec.md §4. Constants included:
`SERVER_TICK_RATE_HZ`, `HP_MULTIPLIER`, `OOC_REGEN_RATE`, `OOC_REGEN_DELAY_MS`,
`COMBAT_DETECTION_RADIUS`, `ATTACK_COOLDOWN_MS`, `MELEE_ATTACK_RANGE_PX`,
`CRIT_MULTIPLIER`, `BASE_SPEED_PX_PER_SEC`, `DASH_SPEED_MULTIPLIER`,
`RITUAL_DURATION_MS`, `RITUAL_RADIUS_PX`, `LEVER_RESET_MS`,
`BANK_SLOTS_PER_RUN`, `LONG_REST_ON_LEVEL_UP`.

---

#### `shared/types/` — JSDoc typedefs
Three new type files, scoped to only the fields `combat.js` reads:

- **`player.js`** — `AbilityScores` + `Player` (id, hp, maxHp, ac, abilityScores, level, conditions, weaponSlot)
- **`enemy.js`** — `Enemy` (id, hp, maxHp, ac, attackBonus, damageDice, damageBonus, damageType, resistances)
- **`weapon.js`** — `DiceDef` + `Weapon` (id, damageDice, damageBonus, damageType, enhancement, attackAbility, properties)

`DiceDef` is `{ count: number, sides: number }` — explicit struct rather than a string like `"2d6"` so `rollDice` can consume it directly without parsing.

`attackAbility: 'str' | 'dex'` on Weapon tells `resolveAttack` which ability score to pull from `attacker.abilityScores`. This side-steps finesse logic for now — the caller is responsible for setting the correct value per weapon instance.

---

#### `shared/tests/combat.test.js` — 23 tests, all passing
Test runner: plain `node:assert/strict`, no framework. Run with `node shared/tests/combat.test.js`.

**RNG approach:** A `seq(...vals)` helper builds a sequence-rng from explicit float values. Each float maps to a die result via `Math.floor(rng() * sides) + 1`. A `die(n, sides)` helper computes the correct float for a target result. The `seq` rng throws if exhausted, catching under-specified tests.

**Test coverage:**
| Scenario | Tested via |
|---|---|
| Clear hit, low-AC target | `resolveAttack` |
| Clear miss, high-AC target | `resolveAttack` |
| Natural 1 auto-miss (despite math suggesting hit) | `resolveAttack` |
| Natural 20 auto-hit (despite unhittable AC) + crit double-dice | `resolveAttack` |
| Enhancement applies to attack roll and damage | `resolveAttack` |
| Bless condition via explicit `conditions` param | `resolveAttack` |
| Bless condition via `attacker.conditions` fallback | `resolveAttack` |
| Standard damage application | `applyDamage` |
| Resistance halves damage (floor) | `applyDamage` |
| Resistance does not apply to non-matching type | `applyDamage` |
| Minimum 1 damage (resistance floors 1-damage hit to 0) | `applyDamage` |
| Overkill calculated correctly | `applyDamage` |
| Exact-HP kill: newHP=0, overkill=0 | `applyDamage` |
| `getModifier` at key score values (10, 16, 8, 1) | utility |
| `getProficiencyBonus` at key level breakpoints (1, 4, 5, 17) | utility |
| `rollDice` boundary values and multi-die sums | utility |

---

#### Root `package.json` — test script added
```json
"test": "node shared/tests/combat.test.js"
```

---

## Session 1 — 2026-04-10

### Completed

#### Monorepo dependency setup
- `client/package.json` — added `phaser@^3.87.0`, `vite@^6.0.0` (dev); set `"type": "module"`
- `server/package.json` — added `colyseus@^0.15.0`, `@supabase/supabase-js@^2.0.0`; set `"type": "module"`
- `shared/package.json` — set `"type": "module"`, no runtime dependencies
- Root `package.json` — added `dev` (Vite) and `server` (Colyseus) scripts

All packages changed to `"type": "module"` (ES modules) per CLAUDE.md code style rules.

**Decision:** `@supabase/supabase-js` was installed in `server` only. The task explicitly deferred Supabase connection setup, and the client-side Supabase client (`network/SupabaseClient.js`) is a future task. The package can be added to `client` when that module is implemented.

---

#### `client/vite.config.js`
Standard Vite config, port 5173. No custom `define` block needed — Vite auto-exposes all `VITE_`-prefixed env vars to client code as `import.meta.env.*`.

---

#### `client/.env.development` and `client/.env.production`
Created with values from tech_spec.md §3.3:
- Dev: `VITE_ASSET_BASE_URL=http://localhost:5173/assets`, `VITE_COLYSEUS_URL=ws://localhost:2567`
- Prod: `VITE_ASSET_BASE_URL=https://assets.montyhaulgame.com`, `VITE_COLYSEUS_URL=wss://server.montyhaulgame.com`

These values are placeholders for the production URLs — the actual domain will need to be confirmed when Railway/Fly.io and Cloudflare R2 are provisioned.

---

#### `client/index.html`
Minimal HTML entry point. Canvas centering is delegated to Phaser's scale manager (`CENTER_BOTH`) rather than CSS flexbox, so the body only needs `width/height: 100%` and `overflow: hidden`.

---

#### `client/src/main.js` — Phaser boot
Initial: 800×600, `Phaser.AUTO`, empty scene.
Updated (same session): 1280×720, `Phaser.Scale.FIT`, `Phaser.Scale.CENTER_BOTH`. Canvas scales to fill the browser window while preserving 16:9 aspect ratio.

**Decision:** `backgroundColor: '#1a1a2e'` (dark navy) used as placeholder until art direction is confirmed for the dungeon boot screen.

---

#### `server/rooms/DungeonRoom.js`
Bare `Room` subclass with empty `onCreate`, `onJoin`, `onLeave`, `onDispose` lifecycle hooks. No state schema attached yet — that is `server/state/GameState.js` (future task).

---

#### `server/index.js`
Colyseus `Server` instance, registers `'dungeon'` room, listens on port 2567.

**Decision:** Used `colyseus@^0.15.0` (the meta-package). The 0.15.x API exposes `Server` directly from `'colyseus'` and provides a `gameServer.listen(port)` method returning a Promise. No separate `http.createServer()` call is required at this entry-point level.

---

## Open Questions & Future Decisions Needed

### Combat system
- **Advantage/Disadvantage:** Not yet implemented. Reckless Attack (Barbarian), Help action, and several conditions grant advantage (roll 2d20, take higher) or disadvantage (take lower). `resolveAttack` will need an `advantage` / `disadvantage` boolean parameter. Design question: when both apply simultaneously, they cancel out (SRD rule) — confirm this is the intended behavior before implementing.
- **Saving throws:** The SRD uses saving throws for many conditions (Stunned, Frightened, etc.). No saving throw function exists yet. Likely a thin wrapper over `rollDice(1, 20)` + ability mod + proficiency (if proficient) vs. a DC. Implement when the first condition that requires it (e.g., Wand of Entangle → Restrained) is added.
- **Sneak Attack:** Rogue's core feature. Requires knowing whether an ally is adjacent to the target OR whether the attacker has advantage. Neither adjacency nor advantage is tracked in combat.js yet. Will need positional data passed in, or a pre-computed `sneakAttackEligible` boolean from MovementSystem.
- **Vulnerability:** `applyDamage` has a `// TODO` for double-damage vulnerability. No Wave 1 enemies or items use it, but it should be added before Wave 2 (Paladin Divine Smite interacts with undead vulnerability to radiant).
- **Unarmed strikes:** `weaponSlot: null` is valid on Player, but `resolveAttack` currently requires a weapon for player attackers. Monks need unarmed strike support. Simplest path: synthesize a `weapon`-shaped object from class data (1+STR mod bludgeoning, no enhancement) at call site in CombatSystem.

### Server
- **`GameState.js` / `PlayerState.js` / `EnemyState.js`:** Colyseus `@Schema` classes for authoritative state sync. These are the next server-side task before any gameplay logic can be tested end-to-end.
- **`CombatSystem.js`:** The multiplayer wrapper that calls `resolveAttack` and broadcasts results. Needs to handle multi-attack (call `resolveAttack` N times), collect results, and apply them to `GameState`. Depends on `GameState` existing first.
- **Colyseus version:** Using `colyseus@^0.15.0`. If the project upgrades to a future major version, the `Room` import and `Server` API may change.

### Client
- **`BootScene.js`:** First real scene needed — asset preload and auth check. Depends on Supabase client setup and at least one sprite asset existing.
- **`ColyseusClient.js`:** Network layer connecting the client to the server. Until this exists, `client/src/main.js` cannot receive game state.
- **Supabase client in `client`:** `@supabase/supabase-js` is not yet installed in the `client` workspace. Add it when `network/SupabaseClient.js` is implemented.

### Infrastructure
- **Production URLs:** `VITE_ASSET_BASE_URL` and `VITE_COLYSEUS_URL` in `.env.production` are placeholders. Finalize when Railway/Fly.io (server) and Cloudflare R2 + CDN (assets) are provisioned.
- **`.gitignore`:** Not yet created. At minimum: `node_modules/`, `client/dist/`, `.env.local`, `.env.*.local`.
- **CI/CD:** Not yet configured. The tech spec mentions Vercel auto-deploy for client and Railway auto-deploy for server on merge to `main`. GitHub Actions or platform-native CI needed.
- **Wrangler CLI:** Required for R2 asset deployment (`npx wrangler r2 object put`). Not yet installed or configured.
