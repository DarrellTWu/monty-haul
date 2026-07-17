---
status: shipped
updated: 2026-07-13
purpose: Canonical file-layout reference. Source of truth — CLAUDE.md and tech_spec.md link here, do not duplicate. Last bump: knockback & positioning (dynamic-combat Pillar 1) — shared/logic/knockback.js, climb fatigue, enemy def levels.
---

# Project Structure (Actual)

What exists today, by package. For target/planned architecture see `tech_spec.md`.

## Server (`server/`)

| File | Purpose |
|---|---|
| `index.js` | Express app + Colyseus on one Node `http.Server` (env `PORT`, default 2567). Boot-time `validateFloorData` gate (refuses to start on floor-data errors). Mounts `/healthz` + `hubRouter` at `/hub`, wraps in `WebSocketTransport`. Startup: warns if `deadLetterCount() > 0`; probes for migration 004 (`password_hash`) and warns loudly if missing. |
| `rooms/DungeonRoom.js` | Colyseus room lifecycle + WebSocket message handlers + tick orchestration. `maxClients = MAX_PLAYERS_PER_ROOM` (4); `options.private` → `setPrivate` party room (roomId = party code). `onAuth` verifies `options.token`; `onJoin` trusts only `client.auth.playerId`. Equip/unequip route through `shared/logic/equipment.js`; death loot via `applyDeathLoot`. Container protocol + `descend` (→ `_descendTo(toFloor)`). Floors loaded via `_loadFloor(n)`; `_descendTo` swaps floor for everyone, applies `_longRest`, then flags `pendingLevelUp=true` on alive players. `choose_level_up` handler resolves via `class-progression.js` incl. `trySubclassUnlock`. `_useAbility` dispatches hotbar abilities gated on `getGrantedFeatures`. Payload hardening: every handler destructures via `asObj()`, `move` rejects non-finite input, hotbar slots validate 0–9; `onUncaughtException` backstops handler/tick throws (see `agent-context/protocol.md` §Validation Discipline). Extraction sends per-client `extract_committed` when `commitExtract` settles. Stair/door unlocks evaluated per tick from `_unlockDefs` via `shared/logic/unlock.js`. Run completion is scroll-only. `_buildRunMeta` feeds `commitExtract`/`commitDeath` (incl. `player.kills`). |
| `auth/tokens.js` | HMAC-SHA256 session tokens (`issueToken`/`verifyToken`, 7-day TTL, `AUTH_TOKEN_SECRET` env — ephemeral + warning if unset) + `requireAuth` express middleware (401 bad token, 403 someone else's playerId). Single seam to swap for Supabase Auth later. |
| `auth/passwords.js` | scrypt password hashing (`hashPassword`/`verifyPassword`), self-describing stored format, timing-safe compare, never throws on malformed hashes. |
| `routes/hub.js` | Express router at `/hub`. CORS allowlist from `ALLOWED_ORIGINS` env (unset → wildcard for dev). `POST /login { username, password }` → `store.authenticate` → `{ token, ... }`; `router.use('/:playerId', requireAuth)` guards the other 8 routes. Accepts `{itemId}` / `{recipeId}` / `{username}` only — pricing + recipe + validation resolved server-side. |
| `store/playerStore.js` | Async write-through cache backed by Supabase. In-memory `Map<playerId, state>` is fast path; miss → `loadPlayer`/`loadPlayerByUsername`. `authenticate(username, password)` — validate username (shared `validateUsername`), register / legacy-adopt / verify; a 23505 registration race falls through to the existing-account path (see `agent-context/persistence.md`). Every mutation modifies cached state then awaits `syncStashAndMeta`. Per-player mutation lock (`_withLock`). Server-authoritative pricing. `commitExtract`/`commitDeath` dead-letter on persistence failure. |
| `systems/CombatSystem.js` | Wraps `shared/logic/combat.js`. Advantage/disadvantage sources assembled per call site (high-ground, reckless, patient-defense, long-range, foe-adjacent). Derived class features drive Dueling, `critRange` (Champion), Frenzy extra attack, Martial Arts bonus strike (any monk level), Sneak Attack (any rogue level — once per Attack event, first eligible hit main→offhand; eligibility via `sneakAttackEligibility`, incl. Skirmisher both-moving leg). Exports `applySecondWind` (1d10 + fighter class level), `applyActionSurge`, `applyFlurryOfBlows` (2 unarmed strikes, 1 ki; Open Hand stagger). Applies knockback at every melee hit site (both directions) via `shared/logic/knockback.js` — wall slams, ledge drops; `terrain` param plumbed from DungeonRoom/AISystem. Increments `player.kills` at every enemy-death site (incl. slam kills). |
| `systems/MovementSystem.js` | `update(state, dt, bounds, geometry, enemyDefs)`: integrates velocity → `resolveWallCollision` → `tryAutoClimb` → clamp to bounds. Speed = base + longstrider + Unarmored Movement (monk 2+, no armor/shield), ×2 while `'dash'` (Step of the Wind / Cunning Action), ×0.5 while `'climb_fatigue'`. Ticks `cunningActionCooldownMs` alongside the attack timer. Returns climb-fatigue events (underleveled perimeter-wall climbs) for DungeonRoom to convert into conditions. Player `canClimb` from `getDerivedClassFeatures`; enemy `canClimb` from `enemyDefs`. |
| `systems/AISystem.js` | `update(state, dt, enemyDefs, melee, geometry)`. Wall-sliding fallback (full → x-only → y-only → stop) gated by `circleOverlapsAny`. Elevation-aware pursuit retargets non-climbers to nearest step; room-aware pursuit retargets across rooms to nearest unlocked door. |
| `state/PlayerState.js` | Position, velocity, HP/AC, class (primary), equipment slots, inventory, hotbar, conditions, ability scores, rage tracking, `gold`, `kills`, `elevation`. Class resources: `secondWindAvailable`, `actionSurgeAvailable`, `kiPoints`/`kiMax`, `cunningActionCooldownMs`; condition mirrors incl. `patientDefenseRemainingMs`/`dashRemainingMs`/`climbFatigueRemainingMs`. Level-up: `classLevels` (MapSchema), `levelUpHistory` (ArraySchema), `subclasses` (MapSchema classId→subclassId), `pendingLevelUp` boolean, cached `level` (mutated only by `applyClassLevel`). |
| `state/EnemyState.js` | Position, HP, type, `lootGold`/`lootItems`/`looted`, `lockedBy`, `elevation`. |
| `state/GameState.js` | Players + enemies + chests + traps + stairs (MapSchemas), `floor`, `doors` MapSchema. |
| `state/{ChestState,TrapState,StairState,DoorState}.js` | Per-entity schemas. `DoorState` carries `id, x, y, w, h, locked`. |
| `persistence/supabase.js` | Singleton client from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (server-only, bypasses RLS). |
| `persistence/playerLoad.js` | `loadPlayer(playerId)`, `loadPlayerByUsername(username)`. Selects `password_hash` → `passwordHash`. Aggregates `gear_stash` by `item_id`. SELECTs wrapped in `withRetry`. |
| `persistence/playerSync.js` | `createProfile(username, initialStash, passwordHash)` (un-retried, one-shot); `syncStashAndMeta(player)` (UPSERT by `(player_id, item_id)`, DELETE-NOT-IN, UPSERT meta by PK — UPSERT-first ordering); `renameUsername` (catches PG 23505 → `{ok:false, error:'username_taken'}`); `updatePasswordHash`. All wrapped in `withRetry`. Requires migrations 002 + 004. |
| `persistence/runCommit.js` | `insertRunHistory({...})` — one row per extract/death. Un-retried (telemetry — lose-row > duplicate-row). |
| `persistence/withRetry.js` | Generic 3-attempt 100/200/400 ms backoff HOF. Default predicate skips errors with 5-digit Postgres SQLSTATE. **Only wrap idempotent ops.** |
| `persistence/deadLetter.js` | Append-only JSONL at `server/.deadletter.jsonl` (gitignored; override with `MH_DEAD_LETTER_PATH`). `{kind, playerId, payload, error, ts}`. Operator-driven recovery. |
| `tests/` | see Tests table below. |

**Not yet built:** `server/matchmaking/` (party rooms via private-room + join code are the Sprint C stopgap).

## Client (`client/src/`)

| File | Purpose |
|---|---|
| `main.js` | Phaser config + scene registration. HubScene auto-starts. |
| `scenes/HubScene.js` | Hub orchestrator (~250 LOC). Checks `localStorage.mh_player_id` → login screen if absent. Two-panel layout: left cycles Class/Stash/Shop/Craft sub-screens (rendered by panel modules under `ui/hub/`), right is the persistent Raider Config + Enter Dungeon. Owns cross-panel state (`_selectedClass`, `_abilityScores`, `_shopVendor`, `_craftBench`, `_leftView`) + refresh hooks (`_onPackChanged`, `_onPurchase`, `_onSold`, `_onCraft`, `_refreshRaider`, `_refreshVault`) that panels invoke after server mutations. |
| `ui/hub/` | Hub panel modules. Each exports a `render*Panel(scene)` (and `refresh*Panel(scene)` where relevant) function that builds gfx via the scene-level `_l`/`_r` trackers. Panel files: `LoginPanel.js`, `SettingsPanel.js` (two-mode menu/rename modal with its own keydown listener), `ClassPanel.js` (class select + 27-pt point-buy), `StashPanel.js`, `ShopPanel.js`, `CraftPanel.js`, `RaiderPanel.js` (right-side + Enter Dungeon submit). `hub-data.js` holds shared constants (`LP`/`RP` geometry, `ITEM_META`, `STASH_ORDER`, `STASH_SECTIONS`, `CLASS_DISPLAY`, `STAT_KEYS`, point-buy helpers). |
| `scenes/DungeonScene.js` | Gameplay rendering + input wiring. Receives `{class, abilityScores, mode, joinCode}` via `init(data)`; joins via quick/party/joincode routing with `token` (from `stash.getAuthToken()`) — identity is server-derived. Party rooms show a PARTY CODE banner. F-key dispatches to chest/corpse/stair via `_tryInteractNearby`. Floor geometry rendering (`drawRoom`, `drawDoorBand` from `rendering/RoomRenderer.js`). Entity render depth: ground=2, elevated=4. Per-entity `onRemove` handlers tear down gfx on floor change. |
| `rendering/RoomRenderer.js` | Pure floor-geometry painters: `drawRoom(scene, floor)` returns a Graphics with base ground + outer walls + platform tint + step strips + interior walls; `drawDoorBand(gfx, doorState)` paints/repaints a single door. Owns the `COLOR_*`/`WALL`/`STEP_STRIP_*` visual constants. |
| `scenes/HUDScene.js` | HP, condition rings (bless/longstrider/false-life/rage/patient-defense/dash/reckless), cooldown arc, ki counter, hotbar (labels from `ABILITY_REGISTRY`), combat log. |
| `scenes/InventoryScene.js` | Equipment slots, bag (with `× N` stacking display-only), hotbar assignment, live `GOLD N gp`. Character left column + bag scroll via shared `ui/ScrollViewport.js` helper. Loot mode replaces left column with container panel (`sendOpenContainer` on create, `sendCloseContainer` on shutdown). |
| `ui/ScrollViewport.js` | Shared vertical-scroll helper used by InventoryScene (character sheet + bag) and HubScene panels (Stash, Raider loadout). One mask + one offset + one wheel routing path per viewport. API: `track(gfx[, baseY])`, `clear`, `setContentHeight`, `setOverflowText`, `handleWheel`, `contains`, `lockDrag`/`unlockDrag` (carve out in-progress drags from reposition + clear mask), `refresh`, `destroy`. Content height computes lazily from tracked `baseY`s by default; callers with cheap exact counts (bag) call `setContentHeight`. `clear()` preserves `scrollOffset` for in-place rebuilds (bag); tab-style reset uses `destroy()` + fresh viewport (Stash/Raider). |
| `network/ColyseusClient.js` | `joinDungeon(opts)` / `createPartyDungeon(opts)` / `joinDungeonByCode(code, opts)` (forward `class`/`abilityScores`/`token`); container protocol senders; `sendDescend`; `sendChooseLevelUp(classId)`. |
| `ui/level-up/LevelUpModal.js` | Class-pick modal shown after descend while `pendingLevelUp` is true. Per-class cards show the NEXT level in that class (`Fighter 1 → 2`) with its features/grants + subclass hint at 3. Overlay on DungeonScene. `openLevelUpModal(scene, {player, eligibleClassIds, newTotalLevel})` returns `{ destroy }`. |
| `network/HubAPI.js` | Thin async fetch wrapper for `/hub` routes. Base URL from `VITE_COLYSEUS_URL` (`ws` → `http`). Attaches Bearer token via injected provider (`setTokenProvider`). Exports `login(username, password)`, `getState`, `addToRaider`, `removeFromRaider`, `dumpToStash`, `buy`, `sell`, `craft`, `rename`. Used exclusively by `store/stash.js`. |
| `store/stash.js` | Server-backed item store. `localStorage` persists `mh_player_id` + `mh_auth_token`. In-memory cache `{stash, gold, raiderPack}` populated by `initFromServer` — server wins. Sync reads + async mutations (all return `Promise<{ok, error?}>`; `renameUser` additionally returns `username`). `logout()` clears session + token locally. **All hub-side mutations route through this file.** |
| `input/InputHandler.js` | WASD/attack/hotbar key bindings. |

**Layout note:** UI helper modules now live under `client/src/ui/` (cross-panel helpers like `ScrollViewport.js`), `client/src/ui/hub/` (hub panels), `client/src/ui/level-up/` (descend-time level-up modal), and `client/src/rendering/` (gameplay rendering).

## Shared (`shared/`)

| File | Purpose |
|---|---|
| `data/constants.js` | Tuning constants (`ENTITY_RADIUS_PX=16`, `STEP_HALF_WIDTH_PX=24`, `PLATFORM_WALL_THICK_PX=2`, attack cooldowns, regen rates, etc). |
| `data/values.js` | `ITEM_GOLD_VALUE` map + `sellPrice(id)` helper (¼× value, floor, min 1 gp). Map is derived once at module load from `ITEM_REGISTRY[id].goldValue` — single source of truth lives on the def. |
| `data/shop.js` | `VENDOR_CATALOG` (keyed by vendor: potions, armor) + flat `BUYABLE_PRICES` for server gate. |
| `data/weapons/{melee,ranged,index}.js` | Weapon definitions. `melee.js` and `ranged.js` export per-weapon consts carrying `category: 'weapon'` and `type: 'melee' \| 'ranged'` (sub-discriminator). `index.js` is the unified barrel exporting `WEAPON_REGISTRY` (melee ∪ ranged, excluding `UNARMED`). Ranged carries `range: { normal, long }` in px (built via `ft()` helper). |
| `data/armor/armor.js` | `ARMOR_REGISTRY` + `computeAC`. Each def carries `category: 'armor'` and `type: 'light' \| 'medium' \| 'heavy'`. |
| `data/items/{consumables,shields,materials,emblems}.js` | Type-specific item registries. Every def carries `category` ∈ {`consumable`, `shield`, `material`, `emblem`}. `consumables.js` includes `extraction_scroll` (type `extract`). `emblems.js` — subclass-unlock bag items with `unlocks: { classId, subclassId }` (one basic emblem per class, seeded into starter loadouts). |
| `data/items/index.js` | `ITEM_REGISTRY` — frozen union of all six type-specific registries. `isKnownItem(id)`, `getItem(id)`, `CATEGORY_DISPLAY_ORDER`. The single thing display layers and the recipe/loot/floor validator look up by id. |
| `data/abilities.js` | `ABILITY_REGISTRY` — hotbar-bindable class abilities (id/label/hotbarShort/icon/note, `kiCost` marker). Server `assign_hotbar` whitelist + client label source. |
| `data/enemies/tier1.js` | Goblin, dog, skeleton + `ENEMY_REGISTRY` (type → stat block; used by `_loadFloor` and the boot validator). Each carries `canClimb: bool` and `level` (goblin/dog 1, skeleton 2 — knockback scaling). |
| `data/classes/{fighter,barbarian,monk,rogue,index}.js` | `CLASS_REGISTRY`. Each class carries `levels: { [n]: { features, grants } }` filled for 1–3, `subclasses` (Champion / Berserker / Open Hand / Skirmisher), `startingItemIds` (emblem), `gearlessLevelCap: 3`, `name`, passive flags `canClimb` (Monk, Rogue) / `unarmoredDefense` ('wis' Monk, 'con' Barbarian), Barbarian `rageUses`. |
| `data/loot/tier1.js` | `LOOT_TABLE_REGISTRY` keyed by enemy id. Entries support literal ids + `@pool_name` (currently `@potion_any`). |
| `data/crafting/benches.js` | `BENCH_REGISTRY` — six benches (forge, binder, artificer, apothecary, scriptorium, refinery). `status: 'open' \| 'planned'`. |
| `data/crafting/recipes.js` | `RECIPE_REGISTRY` + `recipesForBench(benchId)`. Currently: Tan Hide (forge), Bone Brew (apothecary). |
| `data/floors/{floor1,floor2,floor3,index}.js` | `FLOOR_REGISTRY`. Each floor: `{width, height, playerSpawn, enemies, chests, traps, stairs, walls, doors, platforms, rooms}`. Stairs/doors may carry `unlock: { kind }` (see `logic/unlock.js`). All floors tuned for combat testing — not final design. |
| `logic/combat.js` | `resolveAttack(...)` — accepts `sources: Array<{kind, reason}>` with SRD cancellation. `resolveRollMode(sources)` is the pure helper. `pickAttackMode(weapon, distance)` returns `'melee' \| 'ranged' \| 'thrown' \| null` — single source of truth for dispatch. `sneakAttackEligibility({weapon, rollMode, allyAdjacent, skirmish, attackerMoving, targetMoving})` → reason string or null. Result carries `rollMode`, `rollModeSources`, `advantageRolls: [kept, discarded]`. |
| `logic/loot.js` | Pure `rollLoot(table, rng?)` → `{gold, items}`; `applyDeathLoot(enemies, rolledSet, registry, onDrop?, rng?)` — idempotent fresh-death loot resolution used by `DungeonRoom._tick`. `@potion_any` pool filters out `type==='extract'`. |
| `logic/loot-window.js` | Pure container-lock protocol: `tryOpenContainer`, `tryCloseContainer`, `releaseLocksHeldBy`, `tickContainerLocks`, `tryTakeItem`, `tryTakeGold`, `tryDropItem`, `checkLootAccess`, `refreshSourceFlags`. |
| `logic/geometry.js` | Pure geometry: `resolveWallCollision`, `circleOverlapsAny`, `isLineBlocked` (Liang-Barsky segment-vs-AABB; caller filters obstacles), `tryAutoClimb`, `platformPerimeterRects`, `segmentIntersectsCircle`, `segmentPerimeterCrossing`, `pointInRect`. |
| `logic/character.js` | `validateAbilityScores(scores)` → `{ok}` or `{ok:false, error}`. Enforces six keys present, integer in `[SCORE_MIN, SCORE_MAX]`, point cost ≤ `POINT_BUY_BUDGET`. Used by HubScene (pre-submit) + DungeonRoom.onJoin (auth gate). `validateUsername(raw)` → `{ok, username}` (trim, non-empty, ≤ `USERNAME_MAX_LENGTH`, strings only) — one rule for login registration + rename (`playerStore.authenticate` / `renamePlayer`). |
| `logic/equipment.js` | `equipItem(player, {itemId, slot?})`, `unequipItem(player, {slot})`, `recomputeStats(player)`. Owns SRD slot routing (auto-detect armor/shield/weapon, two-handed handling, shield + main-hand interactions) and the derived-stat hook called after any score or equipment change. AC consults `getDerivedClassFeatures(player).unarmoredDefense` so multiclass passives activate. |
| `logic/class-progression.js` | Pure level-up + multiclass module. `applyClassLevel(player, classId)` is the only legal mutator of `classLevels` / `levelUpHistory` / `level` (invariant: `level === sum(classLevels.values)`); returns the new level's features + seeds resource pools. Helpers: `totalLevel`, `getClassLevel`, `getEligibleClassChoicesForLevelUp` (any class below cap 3), `getGrantedFeatures`, `getDerivedClassFeatures` (fightingStyle/unarmoredDefense/canClimb/dangerSense/unarmoredMovementFt/critRange/frenzy/openHandTechnique/skirmish), `getMaxLevelForClass`, `computeHpGainForLevel`, `getKiMax`, `getRageUsesMax`, `getSneakAttackDice`, `trySubclassUnlock`. |
| `logic/unlock.js` | Data-driven stair/door unlock conditions: `UNLOCK_KINDS` ('enemies_cleared', 'never'), `isValidUnlock`, `startsLocked`, `shouldUnlock(unlock, ctx)`. Fail-closed on unknown kinds. |
| `logic/knockback.js` | Pure knockback (dynamic-combat Pillar 1): `levelScale` (underlevel dissipation, floor 0.4), `computeKnockbackPx` (base + Barbarian bonus − Fighter resist), `resolveKnockback` (swept push vs obstacle rects + bounds, elevation via `tryAutoClimb`, wall-slam classification). |
| `logic/validate-floors.js` | `validateFloorData(floorRegistry, { enemyTypes, isKnownItem })` → error strings. Run at server boot; suite in `tests/floors.test.js`. |
| `logic/item-display.js` | Derived display layer over `ITEM_REGISTRY`. `getItemDisplay(id)`, `getArmorSlotDescription(def)`, `getStashOrder()`, `getStashSections()`. Six per-category formatters (weapon/armor/shield/consumable/material/emblem). All other display tables in client code reference these. |
| `logic/conditions.js` | `CONDITION_DEFS` table (mirror field + optional `onExpire`/`onExpireLog` per condition) + `applyCondition`, `tickConditions`, `clearPlayerConditions`. Pure timer bookkeeping; caller owns the `Map<\`${sessionId}_${conditionId}\`, ms>` and broadcasts the returned log strings. Used by `DungeonRoom._useConsumable`, `_activateRage`, `_tickConditions`, `_longRest`. |
| `types/{player,enemy,weapon}.js` | JSDoc `@typedef` shapes. |
| `tests/{combat,loot,geometry,character,equipment,conditions,items,class-progression,floors,knockback}.test.js` | Pure-logic unit tests + itemization/floor validators. |

**Not yet built:** `shared/data/gear/`, `shared/logic/ai.js` (still in `server/systems/AISystem.js`), `shared/logic/floor-generator.js`, `shared/logic/extraction.js`.

## Scripts (`scripts/`)

| File | Purpose |
|---|---|
| `run-tests.mjs` | Offline test runner (`npm run test:all`) — every suite below except the manual Supabase smokes. |
| `balance-sim.mjs` | Deterministic Monte Carlo balance harness: every class × level 1–3 loadout vs every tier-1 enemy at pack sizes 1–3 (death %, cycles-to-clear, hit rates). `node scripts/balance-sim.mjs [--seed N] [--trials N]`. Model notes in the file header. |

## Supabase (`supabase/migrations/`)

| File | Purpose |
|---|---|
| `001_initial_schema.sql` | `player_profiles`, `gear_stash`, `meta_progression`, `run_history`. Current-state schema (one row per `(player_id, item_id)` after migration 002). |
| `002_unique_stash.sql` | `UNIQUE (player_id, item_id)` on `gear_stash`. Required for UPSERT in `syncStashAndMeta`. |
| `003_enable_rls.sql` | Deny-all RLS on all tables (server uses the service key, which bypasses). |
| `004_password_auth.sql` | `player_profiles.password_hash` (NULL = legacy passwordless account). Required for login since Sprint D. |

## Tests (all passing)

| File | Count | Notes |
|---|---|---|
| `shared/tests/combat.test.js` | 59 | Advantage/disadvantage cancellation, `pickAttackMode` dispatch, expanded crit range (Champion 19 — crit-but-not-auto-hit), `resolveSave` advantage (Danger Sense), `sneakAttackEligibility` (weapon gate, three legs, disadvantage blocks, skirmish both-moving). |
| `shared/tests/loot.test.js` | 38 | Includes `applyDeathLoot` idempotency + drop-callback coverage. |
| `shared/tests/geometry.test.js` | 55 | AABB push-out, perimeter primitives, `tryAutoClimb`, `platformPerimeterRects`, `isLineBlocked`. |
| `shared/tests/character.test.js` | 16 | `validateAbilityScores` — shape, range, budget. `validateUsername` — trim, length bounds, non-string rejection. |
| `shared/tests/equipment.test.js` | 14 | `equipItem`/`unequipItem`/`recomputeStats` — slot routing, two-handed, AC recompute. |
| `shared/tests/conditions.test.js` | 18 | `applyCondition`/`tickConditions`/`clearPlayerConditions` — idempotency, mirror sync, expiry side effects, multi-player isolation. |
| `shared/tests/class-progression.test.js` | 32 | `applyClassLevel` invariant + resource seeding (action surge, ki, rage scaling), same-class eligibility + cap, derived features incl. subclass grants, `trySubclassUnlock` paths, `getSneakAttackDice` scaling + Skirmisher unlock, `getKnockbackProfile` + `getClimbLevel`. |
| `shared/tests/items.test.js` | 112 | Itemization validator — base shape, per-category fields (incl. emblem `unlocks` integrity), registry-key parity, disjoint namespaces, `getItemDisplay` completeness, reference integrity for chests/loot/vendors/recipes, recipe bench reference. |
| `shared/tests/floors.test.js` | 13 | Floor-data validator: shipping registry clean + named errors for broken fixtures; unlock-condition semantics. |
| `shared/tests/knockback.test.js` | 22 | `levelScale` bounds, `computeKnockbackPx` worked examples (barb bonus, underlevel dissipation, fighter resist), `resolveKnockback` geometry — pins/slams, thin-band no-tunneling, bounds pin, ledge drops, no-direction no-op. |
| `server/tests/container-lock.test.js` | 21 | |
| `server/tests/loot-flow.test.js` | 35 | |
| `server/tests/target-selection.test.js` | 17 | Explicit-target validation in `playerAttack` — fallback, override, out-of-range/invalid denials, cooldown preservation. |
| `server/tests/ranged-combat.test.js` | 25 | Ranged path: no-target denial, range gates, LoS, long-range + foe-adjacent disadvantage, advantage/disadvantage cancellation, projectile_fired emission, melee regression. |
| `server/tests/sneak-attack.test.js` | 17 | Sneak Attack through `playerAttack`: skirmish both/one-moving, ally-adjacent, high-ground advantage, weapon + class gates, once-per-event across main+offhand, offhand fishing, ranged skirmish, long-range disadvantage block. |
| `server/tests/knockback-combat.test.js` | 18 | Knockback through `playerAttack`/`enemyAttack`: base + barb-3 push distances, wall-slam bonus damage + log, killing blow doesn't push, ranged doesn't push, fighter+shield brace vs monk, climb-fatigue events (wall vs step, deficit duration, at-pace clean). |
| `server/tests/payload-hardening.test.js` | 14 | Boots the real DungeonRoom, spies on `onUncaughtException`, fires hostile payload shapes at every registered message type; NaN-move gate, pendingLevelUp lock on `use_hotbar`, hotbar slot validation. |
| `server/tests/level-up-flow.test.js` | 20 | Mirrors `choose_level_up` handler: pendingLevelUp gate, descend flips flag for alive only, unknown classId rejection, same-class re-level below cap + rejection at cap 3, multiclass HP+AC+history mutations, hotbar-full notify line, rage-pool init. |
| `server/tests/auth.test.js` | 20 | Token issue/verify/expiry/tamper, `requireAuth` 401/403/next, scrypt hash/verify + malformed-hash safety. |
| `server/tests/supabase-smoke.js` | 34 | Real dev Supabase. `process.loadEnvFile('server/.env')`. |
| `server/tests/concurrency-smoke.js` | 7 | N concurrent buys → no duplicate rows. |
| `server/tests/anti-cheat-smoke.js` | 25 | Buy/sell/craft rejection paths. |
| `server/tests/rename-smoke.js` | 31 | Real dev Supabase. Collision/validation/boundary/persistence. |
| `server/tests/run-history-smoke.js` | 19 | `commitExtract`/`commitDeath` row writes. |
| `server/tests/with-retry.test.js` | 17 | Pure unit, no Supabase. |
| `server/tests/dead-letter.test.js` | 18 | Pure unit, uses `MH_DEAD_LETTER_PATH`. |

## Known Limitations

- **Late-join into an in-progress room.** A quick-start crawler can land in a room mid-run; joiner spawns on the current floor and their `run_history.floors_reached` reflects that floor (not 1). Internally consistent with "deepest floor touched" semantics; private party rooms avoid strangers entirely. Resolves fully when matchmaking lands.
- **No session refresh/revocation.** 7-day token expiry; revocation only via `AUTH_TOKEN_SECRET` rotation. See `agent-context/persistence.md` §Known Limitations.
- **No retroactive subclass unlock.** Acquiring an emblem after taking class level 3 grants nothing until a future pass. See `agent-context/combat.md` §Subclass Unlock.
