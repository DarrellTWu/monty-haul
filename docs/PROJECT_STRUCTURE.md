---
status: shipped
updated: 2026-05-17
purpose: Canonical file-layout reference. Source of truth — CLAUDE.md and tech_spec.md link here, do not duplicate. Last bump: itemization refactor (ITEM_REGISTRY barrel + derived display) landed.
---

# Project Structure (Actual)

What exists today, by package. For target/planned architecture see `tech_spec.md`.

## Server (`server/`)

| File | Purpose |
|---|---|
| `index.js` | Express app + Colyseus on one Node `http.Server` (port 2567). Mounts `hubRouter` at `/hub`, wraps in `WebSocketTransport`. Startup: warns if `deadLetterCount() > 0`. |
| `rooms/DungeonRoom.js` | Colyseus room lifecycle + WebSocket message handlers + tick orchestration. Equip/unequip route through `shared/logic/equipment.js`; death loot via `applyDeathLoot` from `shared/logic/loot.js`. Container protocol (`open_container`/`close_container`/`take_item`/`take_gold`/`drop_item`) and `descend` (→ `_descendTo(toFloor)`). Floors loaded via `_loadFloor(n)` (clears MapSchemas guarded on `size>0`, repopulates from `FLOOR_REGISTRY`); `_descendTo` swaps floor for everyone, applies `_longRest`, then flags `pendingLevelUp=true` on alive players. `choose_level_up` handler resolves via `shared/logic/class-progression.js`. `move`/`attack` gated on `pendingLevelUp`. Run completion is scroll-only (`extract` consumable). Tracks `_playerIds`, `_extracted`, `_runStartedAt`, `_maxFloor`; `_buildRunMeta` feeds `commitExtract`/`commitDeath`. |
| `routes/hub.js` | Express router at `/hub`, CORS-enabled. 9 routes: `POST /login`, `GET /:playerId`, `POST /:playerId/raider/{add,remove,dump}`, `POST /:playerId/{buy,sell,craft}`, `POST /:playerId/rename`. All delegate to `playerStore`. Accepts `{itemId}` / `{recipeId}` / `{username}` only — pricing + recipe + validation resolved server-side. `/login` and `GET` return `username`. |
| `store/playerStore.js` | Async write-through cache backed by Supabase. In-memory `Map<playerId, state>` is fast path; miss → `loadPlayer`/`loadPlayerByUsername`. Every mutation modifies cached state then awaits `syncStashAndMeta`. Per-player mutation lock (`_withLock`). Server-authoritative pricing (`BUYABLE_PRICES`, `sellPrice()`, `RECIPE_REGISTRY`). `commitExtract`/`commitDeath` wrap `savePlayer` in try/catch; on persistence failure appends to dead-letter log before propagating. `renamePlayer` trims + ≤20 chars validated server-side. |
| `systems/CombatSystem.js` | Wraps `shared/logic/combat.js`. Computes `advantage = attacker.elevation===1 && target.elevation===0` at every `resolveAttack` call site. Dueling style reads from `getDerivedClassFeatures(player).fightingStyle` so multiclass passives activate. |
| `systems/MovementSystem.js` | `update(state, dt, bounds, geometry, enemyDefs)`: integrates velocity → `resolveWallCollision` (walls + locked doors + platform perimeter rects for elev-0 non-climbers) → `tryAutoClimb` → clamp to bounds. Player `canClimb` resolved at call time from `getDerivedClassFeatures` (OR across taken classes); enemy `canClimb` from `enemyDefs`. |
| `systems/AISystem.js` | `update(state, dt, enemyDefs, melee, geometry)`. Wall-sliding fallback (full → x-only → y-only → stop) gated by `circleOverlapsAny`. Elevation-aware pursuit retargets non-climbers to nearest step; room-aware pursuit retargets across rooms to nearest unlocked door. |
| `state/PlayerState.js` | Position, velocity, HP/AC, class (primary), equipment slots, inventory, hotbar, conditions, ability scores, rage tracking, `gold`, `elevation`. Level-up: `classLevels` (MapSchema), `levelUpHistory` (ArraySchema), `pendingLevelUp` boolean, cached `level` (mutated only by `applyClassLevel`). |
| `state/EnemyState.js` | Position, HP, type, `lootGold`/`lootItems`/`looted`, `lockedBy`, `elevation`. |
| `state/GameState.js` | Players + enemies + chests + traps + stairs (MapSchemas), `floor`, `doors` MapSchema. |
| `state/{ChestState,TrapState,StairState,DoorState}.js` | Per-entity schemas. `DoorState` carries `id, x, y, w, h, locked`. |
| `persistence/supabase.js` | Singleton client from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (server-only, bypasses RLS). |
| `persistence/playerLoad.js` | `loadPlayer(playerId)`, `loadPlayerByUsername(username)`. Aggregates `gear_stash` by `item_id`. SELECTs wrapped in `withRetry`. |
| `persistence/playerSync.js` | `createProfile(username, initialStash)` (un-retried, one-shot); `syncStashAndMeta(player)` (UPSERT by `(player_id, item_id)`, DELETE-NOT-IN, UPSERT meta by PK — UPSERT-first ordering); `renameUsername` (catches PG 23505 → `{ok:false, error:'username_taken'}`). All wrapped in `withRetry`. Requires migration 002 UNIQUE constraint. |
| `persistence/runCommit.js` | `insertRunHistory({...})` — one row per extract/death. Un-retried (telemetry — lose-row > duplicate-row). |
| `persistence/withRetry.js` | Generic 3-attempt 100/200/400 ms backoff HOF. Default predicate skips errors with 5-digit Postgres SQLSTATE. **Only wrap idempotent ops.** |
| `persistence/deadLetter.js` | Append-only JSONL at `server/.deadletter.jsonl` (gitignored; override with `MH_DEAD_LETTER_PATH`). `{kind, playerId, payload, error, ts}`. Operator-driven recovery. |
| `tests/` | 11 test files, see `tests/` row below. |

**Not yet built:** `server/matchmaking/`.

## Client (`client/src/`)

| File | Purpose |
|---|---|
| `main.js` | Phaser config + scene registration. HubScene auto-starts. |
| `scenes/HubScene.js` | Hub orchestrator (~250 LOC). Checks `localStorage.mh_player_id` → login screen if absent. Two-panel layout: left cycles Class/Stash/Shop/Craft sub-screens (rendered by panel modules under `ui/hub/`), right is the persistent Raider Config + Enter Dungeon. Owns cross-panel state (`_selectedClass`, `_abilityScores`, `_shopVendor`, `_craftBench`, `_leftView`) + refresh hooks (`_onPackChanged`, `_onPurchase`, `_onSold`, `_onCraft`, `_refreshRaider`, `_refreshVault`) that panels invoke after server mutations. |
| `ui/hub/` | Hub panel modules. Each exports a `render*Panel(scene)` (and `refresh*Panel(scene)` where relevant) function that builds gfx via the scene-level `_l`/`_r` trackers. Panel files: `LoginPanel.js`, `SettingsPanel.js` (two-mode menu/rename modal with its own keydown listener), `ClassPanel.js` (class select + 27-pt point-buy), `StashPanel.js`, `ShopPanel.js`, `CraftPanel.js`, `RaiderPanel.js` (right-side + Enter Dungeon submit). `hub-data.js` holds shared constants (`LP`/`RP` geometry, `ITEM_META`, `STASH_ORDER`, `STASH_SECTIONS`, `CLASS_DISPLAY`, `STAT_KEYS`, point-buy helpers). |
| `scenes/DungeonScene.js` | Gameplay rendering + input wiring. Receives `{class, abilityScores}` via `init(data)`; passes `playerId` (from `stash.getPlayerId()`) to server. F-key dispatches to chest/corpse/stair via `_tryInteractNearby`. Floor geometry rendering (`drawRoom`, `drawDoorBand` from `rendering/RoomRenderer.js`) paints platforms, steps, walls, doors. Entity render depth: ground=2, elevated=4. Per-entity `onRemove` handlers tear down gfx on floor change. |
| `rendering/RoomRenderer.js` | Pure floor-geometry painters: `drawRoom(scene, floor)` returns a Graphics with base ground + outer walls + platform tint + step strips + interior walls; `drawDoorBand(gfx, doorState)` paints/repaints a single door. Owns the `COLOR_*`/`WALL`/`STEP_STRIP_*` visual constants. |
| `scenes/HUDScene.js` | HP, condition rings, cooldown arc, hotbar, combat log. |
| `scenes/InventoryScene.js` | Equipment slots, bag (with `× N` stacking display-only), hotbar assignment, live `GOLD N gp`. Bag scrollable via `GeometryMask`. Loot mode replaces left column with container panel (`sendOpenContainer` on create, `sendCloseContainer` on shutdown). |
| `network/ColyseusClient.js` | `joinDungeon(opts)` (forwards `class`/`playerId`/`abilityScores`); container protocol senders; `sendDescend`; `sendChooseLevelUp(classId)`. |
| `ui/level-up/LevelUpModal.js` | Multiclass-pick modal shown after descend while `pendingLevelUp` is true. Overlay on DungeonScene (not its own scene). `openLevelUpModal(scene, {player, eligibleClassIds, newTotalLevel})` returns `{ destroy }`. |
| `network/HubAPI.js` | Thin async fetch wrapper for `/hub` routes. Base URL from `VITE_COLYSEUS_URL` (`ws` → `http`). Exports `login`, `getState`, `addToRaider`, `removeFromRaider`, `dumpToStash`, `buy`, `sell`, `craft`, `rename`. Used exclusively by `store/stash.js`. |
| `store/stash.js` | Server-backed item store. `localStorage` only persists `mh_player_id`. In-memory cache `{stash, gold, raiderPack}` populated by `initFromServer` — server wins. Sync reads + async mutations (all return `Promise<{ok, error?}>`; `renameUser` additionally returns `username`). `logout()` clears session locally. **All hub-side mutations route through this file.** |
| `input/InputHandler.js` | WASD/attack/hotbar key bindings. |

**Layout note:** UI helper modules now live under `client/src/ui/hub/` (panels), `client/src/ui/level-up/` (descend-time level-up modal), and `client/src/rendering/` (gameplay rendering).

## Shared (`shared/`)

| File | Purpose |
|---|---|
| `data/constants.js` | Tuning constants (`ENTITY_RADIUS_PX=16`, `STEP_HALF_WIDTH_PX=24`, `PLATFORM_WALL_THICK_PX=2`, attack cooldowns, regen rates, etc). |
| `data/values.js` | `ITEM_GOLD_VALUE` map + `sellPrice(id)` helper (¼× value, floor, min 1 gp). Map is derived once at module load from `ITEM_REGISTRY[id].goldValue` — single source of truth lives on the def. |
| `data/shop.js` | `VENDOR_CATALOG` (keyed by vendor: potions, armor) + flat `BUYABLE_PRICES` for server gate. |
| `data/weapons/{melee,ranged,index}.js` | Weapon definitions. `melee.js` and `ranged.js` export per-weapon consts carrying `category: 'weapon'` and `type: 'melee' \| 'ranged'` (sub-discriminator). `index.js` is the unified barrel exporting `WEAPON_REGISTRY` (melee ∪ ranged, excluding `UNARMED`). Ranged carries `range: { normal, long }` in px (built via `ft()` helper). |
| `data/armor/armor.js` | `ARMOR_REGISTRY` + `computeAC`. Each def carries `category: 'armor'` and `type: 'light' \| 'medium' \| 'heavy'`. |
| `data/items/{consumables,shields,materials}.js` | Type-specific item registries. Every def carries `category` ∈ {`consumable`, `shield`, `material`}. `consumables.js` includes `extraction_scroll` (type `extract`). |
| `data/items/index.js` | `ITEM_REGISTRY` — frozen union of all five type-specific registries. `isKnownItem(id)`, `getItem(id)`, `CATEGORY_DISPLAY_ORDER`. The single thing display layers and the recipe/loot/floor validator look up by id. |
| `data/enemies/tier1.js` | Goblin, dog, skeleton. Each carries `canClimb: bool` (goblin true, others false). |
| `data/classes/{fighter,barbarian,monk,index}.js` | `CLASS_REGISTRY`. Each class carries a `levels: { [n]: { features, grants } }` table (MVP fills only level 1), `gearlessLevelCap: 3`, `name` display label, plus passive flags `canClimb`/`unarmoredDefense` and the Barbarian `rageUses` resource pool. Old top-level `fightingStyle`/`classFeatures`/`feat` moved under `levels[1]`. |
| `data/loot/tier1.js` | `LOOT_TABLE_REGISTRY` keyed by enemy id. Entries support literal ids + `@pool_name` (currently `@potion_any`). |
| `data/crafting/benches.js` | `BENCH_REGISTRY` — six benches (forge, binder, artificer, apothecary, scriptorium, refinery). `status: 'open' \| 'planned'`. |
| `data/crafting/recipes.js` | `RECIPE_REGISTRY` + `recipesForBench(benchId)`. Currently: Tan Hide (forge), Bone Brew (apothecary). |
| `data/floors/{floor1,floor2,index}.js` | `FLOOR_REGISTRY`. Each floor: `{width, height, playerSpawn, enemies, chests, traps, stairs, walls, doors, platforms, rooms}`. Both floors tuned for combat testing — not final design. |
| `logic/combat.js` | `resolveAttack(...)` — accepts `sources: Array<{kind, reason}>` with SRD cancellation. `resolveRollMode(sources)` is the pure helper. `pickAttackMode(weapon, distance)` returns `'melee' \| 'ranged' \| 'thrown' \| null` — single source of truth for dispatch. Result carries `rollMode`, `rollModeSources`, `advantageRolls: [kept, discarded]`. |
| `logic/loot.js` | Pure `rollLoot(table, rng?)` → `{gold, items}`; `applyDeathLoot(enemies, rolledSet, registry, onDrop?, rng?)` — idempotent fresh-death loot resolution used by `DungeonRoom._tick`. `@potion_any` pool filters out `type==='extract'`. |
| `logic/loot-window.js` | Pure container-lock protocol: `tryOpenContainer`, `tryCloseContainer`, `releaseLocksHeldBy`, `tickContainerLocks`, `tryTakeItem`, `tryTakeGold`, `tryDropItem`, `checkLootAccess`, `refreshSourceFlags`. |
| `logic/geometry.js` | Pure geometry: `resolveWallCollision`, `circleOverlapsAny`, `isLineBlocked` (Liang-Barsky segment-vs-AABB; caller filters obstacles), `tryAutoClimb`, `platformPerimeterRects`, `segmentIntersectsCircle`, `segmentPerimeterCrossing`, `pointInRect`. |
| `logic/character.js` | `validateAbilityScores(scores)` → `{ok}` or `{ok:false, error}`. Enforces six keys present, integer in `[SCORE_MIN, SCORE_MAX]`, point cost ≤ `POINT_BUY_BUDGET`. Used by HubScene (pre-submit) + DungeonRoom.onJoin (auth gate). |
| `logic/equipment.js` | `equipItem(player, {itemId, slot?})`, `unequipItem(player, {slot})`, `recomputeStats(player)`. Owns SRD slot routing (auto-detect armor/shield/weapon, two-handed handling, shield + main-hand interactions) and the derived-stat hook called after any score or equipment change. AC consults `getDerivedClassFeatures(player).unarmoredDefense` so multiclass passives activate. |
| `logic/class-progression.js` | Pure level-up + multiclass module. `applyClassLevel(player, classId)` is the only legal mutator of `classLevels` / `levelUpHistory` / `level` (invariant: `level === sum(classLevels.values)`). Helpers: `totalLevel`, `getClassLevel`, `getEligibleClassChoicesForLevelUp`, `getGrantedFeatures`, `getDerivedClassFeatures` (fightingStyle/unarmoredDefense/canClimb), `getMaxLevelForClass`, `computeHpGainForLevel`. |
| `logic/item-display.js` | Derived display layer over `ITEM_REGISTRY`. `getItemDisplay(id)`, `getArmorSlotDescription(def)`, `getStashOrder()`, `getStashSections()`. Five per-category formatters (weapon/armor/shield/consumable/material). All other display tables in client code reference these. |
| `logic/conditions.js` | `CONDITION_DEFS` table (mirror field + optional `onExpire`/`onExpireLog` per condition) + `applyCondition`, `tickConditions`, `clearPlayerConditions`. Pure timer bookkeeping; caller owns the `Map<\`${sessionId}_${conditionId}\`, ms>` and broadcasts the returned log strings. Used by `DungeonRoom._useConsumable`, `_activateRage`, `_tickConditions`, `_longRest`. |
| `types/{player,enemy,weapon}.js` | JSDoc `@typedef` shapes. |
| `tests/{combat,loot,geometry,character,equipment,conditions,items,class-progression}.test.js` | Pure-logic unit tests + itemization validator. |

**Not yet built:** `shared/data/subclasses/`, `shared/data/gear/`, `shared/logic/ai.js` (still in `server/systems/AISystem.js`), `shared/logic/floor-generator.js`, `shared/logic/extraction.js`.

## Supabase (`supabase/migrations/`)

| File | Purpose |
|---|---|
| `001_initial_schema.sql` | `player_profiles`, `gear_stash`, `meta_progression`, `run_history`. Current-state schema (one row per `(player_id, item_id)` after migration 002). |
| `002_unique_stash.sql` | `UNIQUE (player_id, item_id)` on `gear_stash`. Required for UPSERT in `syncStashAndMeta`. |

## Tests (all passing)

| File | Count | Notes |
|---|---|---|
| `shared/tests/combat.test.js` | 46 | Adds advantage/disadvantage cancellation + `pickAttackMode` dispatch (including forward thrown branch). |
| `shared/tests/loot.test.js` | 38 | Includes `applyDeathLoot` idempotency + drop-callback coverage. |
| `shared/tests/geometry.test.js` | 55 | AABB push-out, perimeter primitives, `tryAutoClimb`, `platformPerimeterRects`, `isLineBlocked`. |
| `shared/tests/character.test.js` | 10 | `validateAbilityScores` — shape, range, budget. |
| `shared/tests/equipment.test.js` | 14 | `equipItem`/`unequipItem`/`recomputeStats` — slot routing, two-handed, AC recompute. |
| `shared/tests/conditions.test.js` | 18 | `applyCondition`/`tickConditions`/`clearPlayerConditions` — idempotency, mirror sync, expiry side effects, multi-player isolation. |
| `shared/tests/class-progression.test.js` | 13 | `applyClassLevel` invariant + per-class resource init, eligibility filter, HP-per-level formula, `getGrantedFeatures` / `getDerivedClassFeatures` across multiclass combos. |
| `shared/tests/items.test.js` | 99 | Itemization validator — base shape, per-category fields, registry-key parity, disjoint namespaces, `getItemDisplay` completeness, reference integrity for chests/loot/vendors/recipes, recipe bench reference. |
| `server/tests/container-lock.test.js` | 21 | |
| `server/tests/loot-flow.test.js` | 35 | |
| `server/tests/target-selection.test.js` | 17 | Explicit-target validation in `playerAttack` — fallback, override, out-of-range/invalid denials, cooldown preservation. |
| `server/tests/ranged-combat.test.js` | 25 | Ranged path: no-target denial, range gates, LoS, long-range + foe-adjacent disadvantage, advantage/disadvantage cancellation, projectile_fired emission, melee regression. |
| `server/tests/level-up-flow.test.js` | 19 | Mirrors `choose_level_up` handler: pendingLevelUp gate, descend flips flag for alive only, ineligible/unknown classId rejection, multiclass HP+AC+history mutations, repeat-call drop, hotbar-full notify line, rage-pool init on first Barbarian level. |
| `server/tests/supabase-smoke.js` | 34 | Real dev Supabase. `process.loadEnvFile('server/.env')`. |
| `server/tests/concurrency-smoke.js` | 7 | N concurrent buys → no duplicate rows. |
| `server/tests/anti-cheat-smoke.js` | 25 | Buy/sell/craft rejection paths. |
| `server/tests/rename-smoke.js` | 31 | Real dev Supabase. Collision/validation/boundary/persistence. |
| `server/tests/run-history-smoke.js` | 19 | `commitExtract`/`commitDeath` row writes. |
| `server/tests/with-retry.test.js` | 17 | Pure unit, no Supabase. |
| `server/tests/dead-letter.test.js` | 18 | Pure unit, uses `MH_DEAD_LETTER_PATH`. |

## Known Limitations

- **Late-join into an in-progress room.** Single-room model lets a second crawler join while a first is mid-run; joiner spawns on the current floor and their `run_history.floors_reached` reflects that floor (not 1). Internally consistent with "deepest floor touched" semantics. Resolves itself when matchmaking lands.
- **Username login is trust-on-first-use.** Anyone with a username can become that player. Real auth is future work.
- **`run_history.kills` always 0.** Column exists; attribution deferred. See `agent-context/combat.md`.
- **`isLineBlocked` is a stub.** Returns false until LoS/ranged combat lands.
