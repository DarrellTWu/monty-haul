---
status: shipped
updated: 2026-05-14
purpose: Canonical file-layout reference. Source of truth — CLAUDE.md and tech_spec.md link here, do not duplicate.
---

# Project Structure (Actual)

What exists today, by package. For target/planned architecture see `tech_spec.md`.

## Server (`server/`)

| File | Purpose |
|---|---|
| `index.js` | Express app + Colyseus on one Node `http.Server` (port 2567). Mounts `hubRouter` at `/hub`, wraps in `WebSocketTransport`. Startup: warns if `deadLetterCount() > 0`. |
| `rooms/DungeonRoom.js` | Colyseus room lifecycle + all WebSocket message handlers + tick orchestration. Rolls loot on enemy death; handles container protocol (`open_container`/`close_container`/`take_item`/`take_gold`/`drop_item`) and `descend`. Floors loaded via `_loadFloor(n)` (clears MapSchemas guarded on `size>0`, repopulates from `FLOOR_REGISTRY`). Descend swaps floor for everyone and applies `_longRest`. Run completion is scroll-only (`extract` consumable). Tracks `_playerIds`, `_extracted`, `_runStartedAt`, `_maxFloor`; `_buildRunMeta` feeds `commitExtract`/`commitDeath`. |
| `routes/hub.js` | Express router at `/hub`, CORS-enabled. 9 routes: `POST /login`, `GET /:playerId`, `POST /:playerId/raider/{add,remove,dump}`, `POST /:playerId/{buy,sell,craft}`, `POST /:playerId/rename`. All delegate to `playerStore`. Accepts `{itemId}` / `{recipeId}` / `{username}` only — pricing + recipe + validation resolved server-side. `/login` and `GET` return `username`. |
| `store/playerStore.js` | Async write-through cache backed by Supabase. In-memory `Map<playerId, state>` is fast path; miss → `loadPlayer`/`loadPlayerByUsername`. Every mutation modifies cached state then awaits `syncStashAndMeta`. Per-player mutation lock (`_withLock`). Server-authoritative pricing (`BUYABLE_PRICES`, `sellPrice()`, `RECIPE_REGISTRY`). `commitExtract`/`commitDeath` wrap `savePlayer` in try/catch; on persistence failure appends to dead-letter log before propagating. `renamePlayer` trims + ≤20 chars validated server-side. |
| `systems/CombatSystem.js` | Wraps `shared/logic/combat.js`. Computes `advantage = attacker.elevation===1 && target.elevation===0` at every `resolveAttack` call site. |
| `systems/MovementSystem.js` | `update(state, dt, bounds, geometry, enemyDefs)`: integrates velocity → `resolveWallCollision` (walls + locked doors + platform perimeter rects for elev-0 non-climbers) → `tryAutoClimb` → clamp to bounds. `canClimb` resolved at call time from `CLASS_REGISTRY` / `enemyDefs`. |
| `systems/AISystem.js` | `update(state, dt, enemyDefs, melee, geometry)`. Wall-sliding fallback (full → x-only → y-only → stop) gated by `circleOverlapsAny`. Elevation-aware pursuit retargets non-climbers to nearest step; room-aware pursuit retargets across rooms to nearest unlocked door. |
| `state/PlayerState.js` | Position, velocity, HP/AC, class, equipment slots, inventory, hotbar, conditions, ability scores, rage tracking, `gold`, `elevation`. |
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
| `scenes/HubScene.js` | Entry point. Checks `localStorage.mh_player_id` → login screen if absent. Two-panel layout: left cycles Class/Stash/Shop/Craft sub-screens, right is Raider Config + Enter Dungeon. Class panel includes 27-pt point-buy. Top bar (username + ⚙) opens modal Settings panel (menu / rename modes). Logout clears session + `scene.restart({})`. |
| `scenes/DungeonScene.js` | Gameplay rendering + input wiring. Receives `{class, abilityScores}` via `init(data)`; passes `playerId` (from `stash.getPlayerId()`) to server. F-key dispatches to chest/corpse/stair via `_tryInteractNearby`. Geometry rendering (`_drawRoom`, `_drawDoorBand`) paints platforms, steps, walls, doors. Entity render depth: ground=2, elevated=4. Per-entity `onRemove` handlers tear down gfx on floor change. |
| `scenes/HUDScene.js` | HP, condition rings, cooldown arc, hotbar, combat log. |
| `scenes/InventoryScene.js` | Equipment slots, bag (with `× N` stacking display-only), hotbar assignment, live `GOLD N gp`. Bag scrollable via `GeometryMask`. Loot mode replaces left column with container panel (`sendOpenContainer` on create, `sendCloseContainer` on shutdown). |
| `network/ColyseusClient.js` | `joinDungeon(opts)` (forwards `class`/`playerId`/`abilityScores`); container protocol senders; `sendDescend`. |
| `network/HubAPI.js` | Thin async fetch wrapper for `/hub` routes. Base URL from `VITE_COLYSEUS_URL` (`ws` → `http`). Exports `login`, `getState`, `addToRaider`, `removeFromRaider`, `dumpToStash`, `buy`, `sell`, `craft`, `rename`. Used exclusively by `store/stash.js`. |
| `store/stash.js` | Server-backed item store. `localStorage` only persists `mh_player_id`. In-memory cache `{stash, gold, raiderPack}` populated by `initFromServer` — server wins. Sync reads + async mutations (return `Promise<bool>` except `renameUser` which returns full `{ok, username?, error?}`). `logout()` clears session locally. **All hub-side mutations route through this file.** |
| `input/InputHandler.js` | WASD/attack/hotbar key bindings. |

**Not yet built:** `client/rendering/`, `client/ui/` subdirectories (currently flat).

## Shared (`shared/`)

| File | Purpose |
|---|---|
| `data/constants.js` | Tuning constants (`ENTITY_RADIUS_PX=16`, `STEP_HALF_WIDTH_PX=24`, `PLATFORM_WALL_THICK_PX=2`, attack cooldowns, regen rates, etc). |
| `data/values.js` | Canonical `ITEM_GOLD_VALUE` map + `sellPrice(id)` helper (¼× value, floor, min 1 gp). Single source of truth. |
| `data/shop.js` | `VENDOR_CATALOG` (keyed by vendor: potions, armor) + flat `BUYABLE_PRICES` for server gate. |
| `data/weapons/melee.js`, `data/armor/armor.js` | Weapon + armor definitions. |
| `data/items/{consumables,shields,materials}.js` | Item registries. `consumables.js` includes `extraction_scroll` (type `extract`). |
| `data/enemies/tier1.js` | Goblin, dog, skeleton. Each carries `canClimb: bool` (goblin true, others false). |
| `data/classes/{fighter,barbarian,monk,index}.js` | `CLASS_REGISTRY`. Each class carries `canClimb: bool` (monk true, fighter/barbarian false). |
| `data/loot/tier1.js` | `LOOT_TABLE_REGISTRY` keyed by enemy id. Entries support literal ids + `@pool_name` (currently `@potion_any`). |
| `data/crafting/benches.js` | `BENCH_REGISTRY` — six benches (forge, binder, artificer, apothecary, scriptorium, refinery). `status: 'open' \| 'planned'`. |
| `data/crafting/recipes.js` | `RECIPE_REGISTRY` + `recipesForBench(benchId)`. Currently: Tan Hide (forge), Bone Brew (apothecary). |
| `data/floors/{floor1,floor2,index}.js` | `FLOOR_REGISTRY`. Each floor: `{width, height, playerSpawn, enemies, chests, traps, stairs, walls, doors, platforms, rooms}`. Both floors tuned for combat testing — not final design. |
| `logic/combat.js` | `resolveAttack(...)` — full attack resolution. Accepts optional `advantage: boolean`; returns `advantageRolls: [a, b]` when active. |
| `logic/loot.js` | Pure `rollLoot(table, rng?)` → `{gold, items}`. `@potion_any` pool filters out `type==='extract'`. |
| `logic/loot-window.js` | Pure container-lock protocol: `tryOpenContainer`, `tryCloseContainer`, `releaseLocksHeldBy`, `tickContainerLocks`, `tryTakeItem`, `tryTakeGold`, `tryDropItem`, `checkLootAccess`, `refreshSourceFlags`. |
| `logic/geometry.js` | Pure geometry: `resolveWallCollision`, `circleOverlapsAny`, `isLineBlocked` (stub), `tryAutoClimb`, `platformPerimeterRects`, `segmentIntersectsCircle`, `segmentPerimeterCrossing`, `pointInRect`. |
| `types/{player,enemy,weapon}.js` | JSDoc `@typedef` shapes. |
| `tests/{combat,loot,geometry}.test.js` | Pure-logic unit tests. |

**Not yet built:** `shared/data/subclasses/`, `shared/data/gear/`, `shared/logic/conditions.js` (timer code hand-rolled in DungeonRoom), `shared/logic/ai.js` (still in `server/systems/AISystem.js`), `shared/logic/floor-generator.js`, `shared/logic/character.js`, `shared/logic/items.js`, `shared/logic/extraction.js`.

## Supabase (`supabase/migrations/`)

| File | Purpose |
|---|---|
| `001_initial_schema.sql` | `player_profiles`, `gear_stash`, `meta_progression`, `run_history`. Current-state schema (one row per `(player_id, item_id)` after migration 002). |
| `002_unique_stash.sql` | `UNIQUE (player_id, item_id)` on `gear_stash`. Required for UPSERT in `syncStashAndMeta`. |

## Tests (263 total, all passing)

| File | Count | Notes |
|---|---|---|
| `shared/tests/combat.test.js` | 23 | |
| `shared/tests/loot.test.js` | 33 | |
| `shared/tests/geometry.test.js` | 47 | AABB push-out, perimeter primitives, `tryAutoClimb`, `platformPerimeterRects`. |
| `server/tests/container-lock.test.js` | 21 | |
| `server/tests/loot-flow.test.js` | 35 | |
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
- **`shared/logic/conditions.js` not built.** Timer code hand-rolled in `DungeonRoom`.
