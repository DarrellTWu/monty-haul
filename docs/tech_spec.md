## MONTY HAUL'S DUNGEON CRAWL
## Technical Architecture & Project Structure
*v0.4 | Internal Reference | Beta Build Target*

---

# Current Implementation State
> **Read this before the rest of the spec.** The sections below describe the target architecture. This section describes what actually exists now.

**Active phase:** Server persistence shipped and hardened (last refreshed 2026-05-10). Phase 2 (Supabase backend) and Phase 3 (hardening: per-player mutation lock, server-authoritative pricing, run_history writes, retry/backoff, dead-letter queue, atomic-safe sync via UPSERT + DELETE-NOT-IN) are all complete and verified by 232 passing tests. The phase numbering in this section refers to `docs/server-persistence-plan.md` — it is independent of the broader Phase 0–5 build phases in Section 6 below. The hub (login + stash + shop + crafting scaffold), floor 1 → floor 2 progression via locked stair, and scroll-only extraction are in place. Cohort branches, procedural floor generation, conditions/AI module extraction, matchmaking, and subclasses are not yet built. Floors are hand-authored data in `shared/data/floors/`.

## Files That Exist Today

**server/**
- `index.js` — Express app + Colyseus server on the same Node `http.Server` (port 2567). Mounts `hubRouter` at `/hub`, wraps the server in `WebSocketTransport`. On startup, calls `deadLetterCount()` and logs a warning if any unflushed extract/death payloads exist.
- `rooms/DungeonRoom.js` — session lifecycle, all WebSocket message handling, equip/unequip/loot/hotbar/trap logic; rolls loot on enemy death; handles `open_container`, `close_container`, `take_item`, `take_gold`, `drop_item`, and `descend`. Floors loaded from `FLOOR_REGISTRY` via `_loadFloor(n)` (clears entity MapSchemas — guarded on size>0 to avoid an OPERATION.CLEAR patch poisoning initial state sync — and repopulates). Descend swaps the floor for everyone and applies `_longRest`. Run completion is scroll-only (`extract` consumable type). Tracks per-session `_playerIds`, `_extracted`, `_runStartedAt`, `_maxFloor`; `_buildRunMeta` feeds `commitExtract` and `commitDeath` for `run_history` writes.
- `routes/hub.js` — Express router at `/hub`. 8 routes: `POST /login`, `GET /:playerId`, `POST /:playerId/raider/add|remove|dump`, `POST /:playerId/buy|sell|craft`. CORS-enabled for Vite dev. All routes delegate to `playerStore` and accept `{ itemId }` / `{ recipeId }` only — pricing and recipe internals are resolved server-side.
- `store/playerStore.js` — async write-through cache backed by Supabase. In-memory `Map<playerId, state>` is the fast path; on miss, `loadPlayer` / `loadPlayerByUsername` populate from `gear_stash` + `meta_progression`. Every mutation modifies the cached state then `await`s `syncStashAndMeta`. Per-player mutation lock (`_withLock`) serializes concurrent mutations for the same playerId. Server-authoritative pricing reads `BUYABLE_PRICES`, `sellPrice()`, `RECIPE_REGISTRY` — client-supplied values rejected. Dungeon commit hooks (`commitExtract` / `commitDeath`) wrap `savePlayer` in try/catch; on persistence failure the payload is appended to the dead-letter log via `_safeAppendDeadLetter` before the error propagates.
- `persistence/supabase.js` — singleton Supabase client init from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (server-only, bypasses RLS).
- `persistence/playerLoad.js` — read-side: `loadPlayer(playerId)`, `loadPlayerByUsername(username)`. Aggregates `gear_stash` rows by `item_id`. All SELECTs wrapped in `withRetry`.
- `persistence/playerSync.js` — write-side: `createProfile(username, initialStash)` (one-shot at user creation, un-retried); `syncStashAndMeta(player)` (UPSERT current items by `(player_id, item_id)`, DELETE rows whose item_id is no longer present, UPSERT meta by PK). UPSERT-first ordering — a crash mid-sync leaves leftover ghost rows but never wipes items the player still owns. All three ops wrapped in `withRetry`. Requires the UNIQUE constraint from `supabase/migrations/002_unique_stash.sql`.
- `persistence/runCommit.js` — `insertRunHistory({...})` writes one row per extract / death to `run_history`. Un-retried (telemetry; losing a row is preferable to duplicating one). Called from `playerStore` inside the per-player lock; failure is logged but never invalidates the stash mutation.
- `persistence/withRetry.js` — generic 3-attempt 100/200/400ms exponential-backoff HOF. Default predicate skips errors carrying a 5-digit Postgres SQLSTATE.
- `persistence/deadLetter.js` — append-only JSONL log at `server/.deadletter.jsonl` (gitignored; override path with `MH_DEAD_LETTER_PATH` for tests). Format: `{ kind: 'extract' | 'death', playerId, payload, error, ts }`. Recovery is operator-driven.
- `systems/CombatSystem.js` — multiplayer wrapper around `shared/logic/combat.js`
- `systems/MovementSystem.js` — applies velocity to players and enemies each tick
- `systems/AISystem.js` — enemy state machine (idle → aggro → attack); not yet extracted to `shared/logic/ai.js`
- `state/` — PlayerState (incl. `gold`, `class`, ability scores, `equippedWeaponId`/`offhandId`/`equippedArmorId`, `inventory`, `hotbar`, condition fields), EnemyState (incl. `lootGold` / `lootItems` / `looted` / `lockedBy`), GameState (incl. `floor` / `stairs`), ChestState (incl. `lockedBy`), TrapState, StairState
- `tests/` — 10 test files (see Tests below)

**client/src/** (no `rendering/` or `ui/` subdirectories yet)
- `scenes/HubScene.js` — entry point; checks `localStorage.mh_player_id`, shows username login screen if absent. After login: two-panel layout — left cycles sub-screens (Class, Stash, Shop, Craft); right is Raider Config + Enter Dungeon. Class sub-screen has ability score customization panel (27-point point buy, scores 8–16, non-linear cost). All mutation call sites are async via `HubAPI`; UI uses `.then(ok => { if (ok) handler(); })`. Passes `{ class, abilityScores }` to DungeonScene (no items — server loads raider pack on join).
- `scenes/DungeonScene.js` — main gameplay: renders server state, wires input; receives `{ class, abilityScores }` via `init(data)` and passes `playerId` (from `stash.getPlayerId()`) to the server on join — server loads the raider pack. On extract/death, server commits stash + gold — no client-side stash mutations on run end. F-key dispatches to chest, corpse, or unlocked stair via `_tryInteractNearby`. Room dimensions + camera bounds redraw via `_applyFloorLayout` on `state.floor` change; per-entity `onRemove` handlers translate server-side CLEAR ops on descend into per-entity gfx destroy.
- `scenes/HUDScene.js` — overlay: HP, condition rings, cooldown arc, hotbar, combat log
- `scenes/InventoryScene.js` — equipment slots, bag, hotbar assignment UI; live `GOLD N gp` line; renders crafting materials. Bag stacks duplicate items with `× N` qty (display-only — server inventory stays flat). Loot mode replaces the left column with a loot panel for chests/corpses.
- `network/ColyseusClient.js` — `joinDungeon(opts)` forwards `{ class, playerId, abilityScores }` to server; loot container protocol + `sendDescend`
- `network/HubAPI.js` — thin async fetch wrapper for `/hub` routes. Derives base URL from `VITE_COLYSEUS_URL` (replaces `ws` → `http`). Exports: `login`, `getState`, `addToRaider`, `removeFromRaider`, `dumpToStash`, `buy`, `sell`, `craft`.
- `store/stash.js` — server-backed item store. `localStorage` used ONLY to persist `mh_player_id` across sessions. In-memory cache (`_cache = { stash, gold, raiderPack }`) populated by `initFromServer(playerId, state)` on login/load — server wins. Sync reads: `getStash`, `getRaiderPack`, `getRaiderPackFlat`, `getHubGold`, `getPlayerId`. Async mutations (call `HubAPI`, update cache, return `Promise<bool>`): `stashToRaider`, `raiderToStash`, `dumpRaiderPackToStash`, `buyItem`, `sellItem`, `craftRecipe`. ALL hub-side state mutations route through this file.
- `input/InputHandler.js` — WASD/attack/hotbar key bindings
- `main.js` — Phaser config and scene registration; HubScene is first (auto-starts)

**shared/**
- `data/constants.js`, `data/weapons/melee.js`, `data/armor/armor.js`
- `data/values.js` — canonical `ITEM_GOLD_VALUE` map and `sellPrice(id)` helper (1/4× value, floor, min 1 gp). Single source of truth.
- `data/shop.js` — `VENDOR_CATALOG` keyed by vendor (potions, armor); each entry `{ id, price }` computed from `ITEM_GOLD_VALUE`. Also exports `BUYABLE_PRICES` — a flat `{ itemId → price }` map used server-side to gate `/buy`.
- `data/items/consumables.js` (incl. `extraction_scroll`, type `extract` — run-control), `data/items/shields.js`, `data/items/materials.js`
- `data/enemies/tier1.js` (goblin, dog, skeleton)
- `data/floors/floor1.js` + `floor2.js` + `index.js` — `FLOOR_REGISTRY` keyed by floor number. Both floors' contents are tuned for combat testing — not final design.
- `data/loot/tier1.js` — LOOT_TABLE_REGISTRY keyed by enemy id; drop entries support literal item ids and `@pool_name` references.
- `data/classes/fighter.js`, `data/classes/barbarian.js`, `data/classes/monk.js`, `data/classes/index.js` — CLASS_REGISTRY pattern.
- `data/crafting/benches.js` — `BENCH_REGISTRY` of six benches; planned benches render a "coming soon" placeholder.
- `data/crafting/recipes.js` — `RECIPE_REGISTRY`; `recipesForBench(benchId)` helper. Seeds Tan Hide (Forge) and Bone Brew (Apothecary).
- `logic/combat.js` — full attack resolution (pure functions)
- `logic/loot.js` — pure `rollLoot(table, rng?)`; rng-injected for deterministic tests
- `logic/loot-window.js` — pure container-lock protocol
- `tests/combat.test.js`, `tests/loot.test.js`
- `types/player.js`, `types/enemy.js`, `types/weapon.js`

**supabase/migrations/**
- `001_initial_schema.sql` — `player_profiles`, `gear_stash`, `meta_progression`, `run_history`. Schema is current-state oriented (one row per `(player_id, item_id)` in gear_stash after migration 002).
- `002_unique_stash.sql` — adds `UNIQUE (player_id, item_id)` to `gear_stash`. Required for the UPSERT pattern in `syncStashAndMeta`.

## Tests (232 total, all passing)
- `shared/tests/combat.test.js` — 23
- `shared/tests/loot.test.js` — 33
- `server/tests/container-lock.test.js` — 21
- `server/tests/loot-flow.test.js` — 35
- `server/tests/supabase-smoke.js` — 34 (real dev Supabase: createProfile, sync, loaders, convergence, negative cases)
- `server/tests/concurrency-smoke.js` — 7 (20 concurrent buys → no duplicate rows)
- `server/tests/anti-cheat-smoke.js` — 25 (exploit attempts on buy/sell/craft routes)
- `server/tests/run-history-smoke.js` — 19 (commitExtract / commitDeath row writes)
- `server/tests/with-retry.test.js` — 17 (pure unit; no Supabase)
- `server/tests/dead-letter.test.js` — 18 (pure unit; uses `MH_DEAD_LETTER_PATH` to redirect to a temp file)

## Not Yet Built
`server/matchmaking/`, `client/rendering/`, `client/ui/`, `shared/data/subclasses/`, `shared/data/gear/`, `shared/logic/conditions.js` (condition timer code is still hand-rolled in DungeonRoom), `shared/logic/ai.js` (logic still in `server/systems/AISystem.js`), `shared/logic/floor-generator.js`, ranged weapons, floor generation beyond floors 1–2, cohort/branch maps, kill attribution (`run_history.kills` always 0 — column exists). Crafting scaffold exists (Forge + Apothecary open with one recipe each); Binder / Artificer / Scriptorium / Refinery are placeholder benches awaiting recipes.

## Known Limitations
- **Late-join into an in-progress room.** Single-room model lets a second crawler join while a first is mid-run; the joiner spawns on the current floor and their `run_history.floors_reached` reflects that floor (not 1). Internally consistent with "deepest floor touched" semantics; skews analytics that read it as "depth descended through this run." Resolves itself when matchmaking lands. See `docs/server-persistence-plan.md` (Known Limitations).
- **Username login is trust-on-first-use.** Anyone with a username can become that player. Real auth (Supabase Auth) is in `docs/server-persistence-plan.md` Migration Notes as future work.

---

# 1. Stack Overview
The beta is a browser-based, multiplayer-first game. No install required. The stack is chosen for agent legibility — every layer has dense, high-quality training data in Opus 4.6 — and for clean separation of concerns so that coding agents can work on individual modules without contaminating unrelated systems.

  ----------------- --------------------- --------------------------------------------------------------------------- ---------------------------
  **Layer**         **Technology**        **Purpose**                                                                 **Hosting**

  Game Client       Phaser 3 (JS)         2D rendering, input, scene management, camera                               Vercel / Cloudflare Pages

  Client Build      Vite                  Dev server, ES module bundling, asset pipeline, env switching               Local / CI

  Game Server       Colyseus (Node.js)    Authoritative multiplayer, room/instance management, real-time state sync   Railway / Fly.io

  Persistence       Supabase (Postgres)   Player accounts, auth, gear stash, meta-economy, run history                Supabase Cloud

  Asset Storage     Cloudflare R2         Sprites, audio, tilemaps — zero egress fees, CDN-fronted                  Cloudflare

  Version Control   Git / GitHub          Source, CI/CD trigger for Vercel and Railway auto-deploy                    GitHub
  ----------------- --------------------- --------------------------------------------------------------------------- ---------------------------


> **Why Phaser 3 over Godot / Unity WebGL**
> *Phaser 3 runs natively in the browser with no build export step, has the highest agent legibility of any 2D game framework (dense JS training data), and pairs naturally with Colyseus. Godot HTML5 exports have multiplayer friction. Unity WebGL builds are 30--100MB+, unsuitable for frictionless onboarding.*
# 2. System Architecture
## Data Flow
The client talks to two services. All real-time game state flows over WebSocket to the Colyseus game server. All persistent data flows over HTTPS REST to Supabase. The game server is the source of truth for in-run state. Supabase is the source of truth for everything that survives between runs.


> **Core Principle: Single Room, Geometry-Enforced Cohort Separation**
> *Each run is one Colyseus room containing all players for that run. On floors 1-3, cohorts are separated by physical map geometry — three distinct dungeon branches with solid walls between them and no connecting passages. Cross-cohort interaction is impossible because there is no path between branches, not because of a server-side broadcast filter. At floor 4, the map opens into a single continuous level with three entrances — one per branch. Players walk out of their branch and into the shared space naturally. No server event, no flag flip, no reconnection. The geometry does the work.*
## Request Routing
> \[Browser — Phaser 3 Client\]
| |                                                                     |
|                                                                        |
| |\-- WebSocket (real-time) \--\> \[Colyseus Game Server — Node.js\] |
|                                                                        |
| | |                                                                  |
|                                                                        |
| | |\-- Room: Run\_{id} (1 room, all 12 players)                      |
|                                                                        |
| | | |                                                               |
|                                                                        |
| | | |\-- Map: Branch A (floors 1-3, cohort A only)                  |
|                                                                        |
| | | |\-- Map: Branch B (floors 1-3, cohort B only)                  |
|                                                                        |
| | | |\-- Map: Branch C (floors 1-3, cohort C only)                  |
|                                                                        |
| | | |\-- Map: Floor 4+ (single continuous level,                    |
|                                                                        |
| | | | all cohorts converge here)                                    |
|                                                                        |
| | |                                                                  |
|                                                                        |
| | +\-- Supabase (server-side writes on extract/death)                 |
|                                                                        |
| |                                                                     |

> +\-- HTTPS REST (persistent) \--\> \[Supabase\]
| |                                                                     |
|                                                                        |
| |\-- auth.users (accounts, sessions)                                  |
|                                                                        |
| |\-- player_profiles (display name, preferences)                      |
|                                                                        |
| |\-- gear_stash (extracted equipment)                                 |
|                                                                        |
| |\-- meta_progression (hub unlocks, potion inventory)                 |

> +\-- run_history (completed/failed runs)
# 3. Project File Structure
The project is a monorepo with three top-level packages: client, server, and shared. The shared package is the most important architectural decision — it contains all data definitions, game logic, and balance tables that both client and server must agree on. Agents should always be directed to the correct package for their task.


> monty-haul/
> ├── client/ \# Phaser 3 browser client (Vite build)
> ├── server/ \# Colyseus game server (Node.js)
> ├── shared/ \# Shared logic & data (imported by both)
> ├── supabase/ \# DB migrations, stored in git, applied via CLI
| | └── migrations/ \# Versioned .sql files                            |

> ├── package.json \# Monorepo root (npm workspaces)
> └── README.md
**3.1 /shared — The Source of Truth**

Shared contains everything that must be consistent between client and server: type definitions, pure game logic, and all balance/tuning data. Nothing in shared has framework dependencies. Every module here is plain JavaScript that can be unit tested in isolation. Coding agents writing balance changes or combat logic should always work in shared, never in client or server directly.


> shared/
> ├── types/
| | ├── player.js \# Player state shape (HP, AC, level, class, gear slots)                  |
|                                                                                            |
| | ├── enemy.js \# Enemy state shape (HP, AC, type, AI state)                              |
|                                                                                            |
| | ├── item.js \# Item shape (id, rarity, type, effects, unlock data)                      |
|                                                                                            |
| | ├── room.js \# Room/instance state shape                                                |
|                                                                                            |
| | └── index.js \# Re-exports all types                                                    |
|                                                                                            |
| |                                                                                         |

> ├── data/ \# ALL balance & tuning data lives here
| | ├── classes/                                                                            |
|                                                                                            |
| | | ├── fighter.js \# Fighter base stats, level table, features by level                 |
|                                                                                            |
| | | ├── barbarian.js \# Barbarian base stats, rage table, features                       |
|                                                                                            |
| | | ├── rogue.js \# Rogue base stats, sneak attack table, features                       |
|                                                                                            |
| | | ├── monk.js \# Monk base stats, ki table, martial arts die                           |
|                                                                                            |
| | | └── index.js \# Class registry: { fighter, barbarian, rogue, monk }                  |
|                                                                                            |
| | |                                                                                      |
|                                                                                            |
| | ├── subclasses/                                                                         |
|                                                                                            |
| | | ├── champion.js \# Crit range, level 3/7/10/15/18 features                           |
|                                                                                            |
| | | ├── sharpshooter.js \# Ranged bonuses, movement-penalty tuning                       |
|                                                                                            |
| | | ├── berserker.js \# Frenzy attack, mindless rage at high level                       |
|                                                                                            |
| | | ├── zealot.js \# Zealous presence, rage beyond death HP threshold                    |
|                                                                                            |
| | | ├── swashbuckler.js \# Fancy footwork radius, rakish audacity conditions             |
|                                                                                            |
| | | ├── skirmisher.js \# Moving window definition (TBD), ranged bonuses                  |
|                                                                                            |
| | | ├── drunken-master.js \# Redirect attack, tipsy sway dodge chance                    |
|                                                                                            |
| | | ├── open-hand.js \# Flurry effects: trip DC, push distance, stun DC                  |
|                                                                                            |
| | | └── index.js \# Subclass registry                                                    |
|                                                                                            |
| | |                                                                                      |
|                                                                                            |
| | ├── weapons/                                                                            |
|                                                                                            |
| | | ├── melee.js \# All melee weapon stats (damage dice, type, properties)               |
|                                                                                            |
| | | ├── ranged.js \# All ranged weapon stats (damage dice, range bands)                  |
|                                                                                            |
| | | └── index.js \# Weapon registry                                                      |
|                                                                                            |
| | |                                                                                      |
|                                                                                            |
| | ├── armor/                                                                              |
|                                                                                            |
| | | └── armor.js \# All armor types (AC, stealth penalty, str req)                       |
|                                                                                            |
| | |                                                                                      |
|                                                                                            |
| | ├── enemies/                                                                            |
|                                                                                            |
| | | ├── tier1.js \# Floor 1-3 enemies (Goblin Scout, Skeleton, etc.)                     |
|                                                                                            |
| | | ├── tier2.js \# Floor 4-6 enemies (TBD)                                              |
|                                                                                            |
| | | ├── tier3.js \# Floor 7-9 enemies (TBD)                                              |
|                                                                                            |
| | | └── index.js \# Enemy registry                                                       |
|                                                                                            |
| | |                                                                                      |
|                                                                                            |
| | ├── consumables/                                                                        |
|                                                                                            |
| | | ├── potions.js \# All potion definitions, effects, floor availability                |
|                                                                                            |
| | | ├── wands.js \# Single-use wand definitions, spell effects                           |
|                                                                                            |
| | | ├── oils.js \# Oil/alchemical item definitions                                       |
|                                                                                            |
| | | └── index.js \# Consumable registry + floor drop tables                              |
|                                                                                            |
| | |                                                                                      |
|                                                                                            |
| | ├── gear/                                                                               |
|                                                                                            |
| | | ├── unlock-items.js \# Class unlock items (Hunter's Bow, etc.) definitions          |
|                                                                                            |
| | | ├── legendary.js \# Legendary challenge item definitions                             |
|                                                                                            |
| | | └── drop-tables.js \# Per-floor gear drop tables and rarity weights                  |
|                                                                                            |
| | |                                                                                      |
|                                                                                            |
| | └── constants.js \# Global tuning constants (attack cooldown, regen rate,               |
|                                                                                            |
| | \# ritual radius, lever spacing, HP multiplier, etc.)                                   |
|                                                                                            |
| |                                                                                         |

> ├── logic/
| | ├── combat.js \# Attack resolution: roll d20, compare AC, apply damage,                 |
|                                                                                            |
| | | \# crits, resistance, conditions. Pure function.                                     |
|                                                                                            |
| | ├── character.js \# Level-up logic, HP calc, proficiency bonus, stat mods               |
|                                                                                            |
| | ├── items.js \# Item equip/unequip effects, class unlock application                    |
|                                                                                            |
| | ├── conditions.js \# Condition application/removal/tick (poisoned, stunned,             |
|                                                                                            |
| | | \# restrained, frightened, invisible, haste, bless\...)                              |
|                                                                                            |
| | ├── ai.js \# Enemy AI state machine (patrol, aggro, attack, flee)                       |
|                                                                                            |
| | ├── loot.js \# Loot roll logic: pick item from drop table by floor/rarity               |
|                                                                                            |
| | ├── floor-generator.js \# Floor assembly: select room templates from tier pool,         |
|                                                                                            |
| | | \# connect them procedurally, place enemies/loot/portals.                            |
|                                                                                            |
| | | \# See Section 4 for generation strategy details.                                    |
|                                                                                            |
| | └── extraction.js \# Extraction validation, ritual timer logic, broadcast rules         |
|                                                                                            |
| |                                                                                         |

> ├── tests/
| | ├── combat.test.js \# Example test file — all shared/logic tests follow this pattern. |
|                                                                                            |
| | | \# Uses injected RNG for deterministic results.                                      |
|                                                                                            |
| | | \# Import from shared, no framework deps, run with: node tests/combat.test.js        |
|                                                                                            |
| | | \# (Or jest/vitest — whichever is adopted in Phase 1.)                             |
|                                                                                            |
| | └── README.md \# Test conventions: how to write, run, and structure tests.              |
|                                                                                            |
| |                                                                                         |

> └── index.js \# Top-level re-export for convenient imports
> **Type Safety Convention: JSDoc \@typedef (not TypeScript)**
> *The project uses plain JS throughout for agent legibility and build simplicity. To prevent agents from drifting on data shapes — a known failure mode — all files in shared/types/ must use JSDoc \@typedef annotations. Agents should be given these type files as context at the start of every session. Example: /\*\* \@typedef {{ id: string, hp: number, ac: number, class: string, conditions: string\[\] }} Player \*/ This gives structured shape references without requiring a TypeScript compile step. Do not introduce .ts files or tsconfig.json.*
**3.2 /server — Colyseus Game Server**

The server is the authoritative runtime. It imports shared logic and data to resolve all game state. It never contains balance data directly — all tuning values come from shared/data. Each run is a single Colyseus room. Zone partitioning is handled by the ZoneSystem — a server-side interest filter, not separate room instances.


> server/
> ├── rooms/
| | └── DungeonRoom.js \# Single Colyseus room for an entire run.                    |
|                                                                                     |
| | \# onCreate: load branch maps A/B/C + floor 4 map,                               |
|                                                                                     |
| | \# assign cohorts, spawn players in branches.                                    |
|                                                                                     |
| | \# onJoin: assign player to cohort, place in branch spawn.                       |
|                                                                                     |
| | \# onLeave: handle disconnect, drop loot if dead.                                |
|                                                                                     |
| | \# onDispose: cleanup when all players gone.                                     |
|                                                                                     |
| |                                                                                  |

> ├── state/
| | ├── GameState.js \# Colyseus \@Schema: full room state (players, enemies,        |
|                                                                                     |
| | | \# items, portals, levers, active maps)                                       |
|                                                                                     |
| | ├── PlayerState.js \# Colyseus \@Schema: per-player state (position, HP, class,  |
|                                                                                     |
| | | \# gear, conditions, cooldowns, cohortId, currentMap)                         |
|                                                                                     |
| | └── EnemyState.js \# Colyseus \@Schema: per-enemy state (position, HP, mapId)    |
|                                                                                     |
| |                                                                                  |

> ├── systems/
| | ├── GameLoop.js \# Server tick — rate from SERVER_TICK_RATE_HZ\[playerCount\]. |
|                                                                                     |
| | | \# Calls movement, AI, combat, conditions each tick.                          |
|                                                                                     |
| | ├── ZoneSystem.js \# Cohort assignment and branch map routing.                   |
|                                                                                     |
| | | \# Assigns cohorts at lobby, maps cohortId to branch                          |
|                                                                                     |
| | | \# tilemap for floors 1-3. Floor 4+ uses shared map.                          |
|                                                                                     |
| | | \# Also handles interest management: only broadcast                           |
|                                                                                     |
| | | \# entity state to clients within proximity range.                            |
|                                                                                     |
| | | \# Isolation on floors 1-3 is the map, not this system.                       |
|                                                                                     |
| | ├── MovementSystem.js \# Validates player input vectors, applies collision       |
|                                                                                     |
| | ├── CombatSystem.js \# Wraps shared/logic/combat.js for multiplayer context      |
|                                                                                     |
| | ├── AISystem.js \# Wraps shared/logic/ai.js, manages enemy state machine         |
|                                                                                     |
| | ├── LootSystem.js \# Manages item drops, chest contents, first-chest guarantee   |
|                                                                                     |
| | ├── ExtractionSystem.js \# Portal ritual timer, broadcast, radius checks         |
|                                                                                     |
| | └── LeverSystem.js \# Lever state, crossing window timer, stairs unlock          |
|                                                                                     |
| |                                                                                  |

> ├── persistence/
| | ├── supabase.js \# Supabase client init (server-side)                            |
|                                                                                     |
| | ├── runCommit.js \# Write extracted loot to gear_stash on successful extract     |
|                                                                                     |
| | └── playerLoad.js \# Load player stash/progression on room join                  |
|                                                                                     |
| |                                                                                  |

> ├── matchmaking/
| | └── Matchmaker.js \# Queue management: fill lobby to 12, assign cohorts A/B/C,   |
|                                                                                     |
| | \# spin up DungeonRoom when lobby is full.                                       |
|                                                                                     |
| | \# For floor 7+ merges (post-beta): coordinate two                               |
|                                                                                     |
| | \# 12-player rooms into a shared 24-player room.                                 |
|                                                                                     |
| |                                                                                  |

> └── index.js \# Server entry point, Colyseus app init, room registration
**3.3 /client — Phaser 3 Browser Client**

The client is responsible for rendering, input capture, and UI only. It imports shared types to interpret server state but never runs combat logic itself. All game state comes from Colyseus state sync. Agents working on client code should never touch shared/logic — only rendering, animation, and UI.


> **Critical: Do Not Use Phaser.Physics for Movement or Collision**
> *Phaser 3 ships with Arcade and Matter physics engines. Do not use them. Movement positions come from the authoritative server — the client renders where the server says entities are. Collision is resolved server-side in MovementSystem.js. If an agent reaches for Phaser.Physics, Phaser.Physics.Arcade, or this.physics when implementing movement or collision, reject it. Phaser is the renderer. The server is the physics engine. Using Phaser's physics would create a second, client-side source of truth for positions that will conflict with server state and is not possible to keep in sync.*
> client/
> ├── src/
| | ├── main.js \# Phaser game config, scene registration, boot                         |
|                                                                                        |
| | |                                                                                  |
|                                                                                        |
| | ├── scenes/  \# BUILT: DungeonScene, HUDScene, InventoryScene. Rest are planned.  |
|                                                                                        |
| | | ├── DungeonScene.js \# Main gameplay scene: renders server state, sends input    |
|                                                                                        |
| | | ├── HUDScene.js \# Overlay: HP bar, condition rings, cooldown arc, hotbar, combat log |
|                                                                                        |
| | | ├── InventoryScene.js \# Equipment slots (weapon/offhand/armor), bag, hotbar assignment |
|                                                                                        |
| | | \# --- planned, not yet built ---                                                 |
|                                                                                        |
| | | ├── BootScene.js \# Asset preload, auth check, redirect to hub or login          |
|                                                                                        |
| | | ├── LoginScene.js \# Supabase auth UI (email/password, OAuth)                    |
|                                                                                        |
| | | ├── HubScene.js \# Persistent hub: stash, shop, class select, queue              |
|                                                                                        |
| | | └── ResultsScene.js \# Floor complete / death screen with loot summary           |
|                                                                                        |
| | |                                                                                  |
|                                                                                        |
| | ├── network/                                                                        |
|                                                                                        |
| | | ├── ColyseusClient.js \# Colyseus client init, room join/leave, message handlers |
|                                                                                        |
| | | └── SupabaseClient.js \# Supabase browser client, auth helpers, REST calls       |
|                                                                                        |
| | |                                                                                  |
|                                                                                        |
| | ├── rendering/                                                                      |
|                                                                                        |
| | | ├── PlayerRenderer.js \# Draw player entity, facing indicator, condition fx      |
|                                                                                        |
| | | ├── EnemyRenderer.js \# Draw enemy entities, health bars, aggro indicator        |
|                                                                                        |
| | | ├── DungeonRenderer.js \# Draw room walls, floors, doors from tilemap data       |
|                                                                                        |
| | | ├── ItemRenderer.js \# Draw dropped items, chests (open/closed), stairs          |
|                                                                                        |
| | | ├── PortalRenderer.js \# Draw extraction portal, ritual radius, timer arc        |
|                                                                                        |
| | | └── EffectsRenderer.js \# Draw hit flashes, damage numbers, condition particles  |
|                                                                                        |
| | |                                                                                  |
|                                                                                        |
| | ├── ui/                                                                             |
|                                                                                        |
| | | ├── HealthBar.js \# Reusable HP bar component                                    |
|                                                                                        |
| | | ├── CooldownArc.js \# Attack cooldown arc around player                          |
|                                                                                        |
| | | ├── CombatLog.js \# Scrolling combat log (last 4 lines)                          |
|                                                                                        |
| | | ├── ItemTooltip.js \# Item card popup on hover/inspect                           |
|                                                                                        |
| | | ├── Notification.js \# Centered narrative tooltips (chest open, floor enter)     |
|                                                                                        |
| | | └── MiniMap.js \# Optional: room minimap for dungeon navigation                  |
|                                                                                        |
| | |                                                                                  |
|                                                                                        |
| | ├── input/                                                                          |
|                                                                                        |
| | | └── InputHandler.js \# WASD/arrow movement, attack, item use keybinds.           |
|                                                                                        |
| | | \# Sends input to server. Never resolves outcomes locally.                       |
|                                                                                        |
| | |                                                                                  |
|                                                                                        |
| | └── assets/ \# Source assets — committed to git                                   |
|                                                                                        |
| | ├── sprites/                                                                        |
|                                                                                        |
| | | ├── characters/ \# Player class sprites (fighter.png, barbarian.png\...)         |
|                                                                                        |
| | | ├── enemies/ \# Enemy sprites by tier (goblin-scout.png, skeleton.png\...)       |
|                                                                                        |
| | | ├── items/ \# Item icons for UI (potion-healing.png, sword-rare.png\...)         |
|                                                                                        |
| | | ├── environment/ \# Walls, floors, doors, chests, portals, levers                |
|                                                                                        |
| | | └── effects/ \# Hit flashes, condition particles, ritual glow                    |
|                                                                                        |
| | ├── tilemaps/ \# Tiled .json tilemap files for each room template                   |
|                                                                                        |
| | ├── audio/                                                                          |
|                                                                                        |
| | | ├── sfx/ \# Attack, hit, footstep, chest open, portal activation                 |
|                                                                                        |
| | | ├── ambient/ \# Dungeon ambience per tier                                        |
|                                                                                        |
| | | └── music/ \# Combat and exploration tracks                                      |
|                                                                                        |
| | └── fonts/ \# Web fonts (committed, not CDN-loaded)                                 |
|                                                                                        |
| |                                                                                     |

> ├── vite.config.js \# Vite config: base URL switches local vs R2 CDN
> ├── .env.development \# VITE_ASSET_BASE_URL=http://localhost:5173/assets
| | \# VITE_COLYSEUS_URL=ws://localhost:2567                                            |

> ├── .env.production \# VITE_ASSET_BASE_URL=https://assets.montyhaulgame.com
| | \# VITE_COLYSEUS_URL=wss://server.montyhaulgame.com                                 |

> └── index.html \# Entry point, Phaser canvas mount
**3.4 Asset Pipeline — Local to Production**

During development, Vite's dev server serves assets locally from client/src/assets/. On production build, Vite outputs processed assets to client/dist/assets/. A deployment step then syncs the dist/assets/ directory to Cloudflare R2 using the Wrangler CLI. Phaser's asset loader reads the base URL from the environment variable, so no code changes are needed between local and production.


> LOCAL DEVELOPMENT
> vite dev \# Serves assets at localhost:5173/assets/
> Phaser loads: VITE_ASSET_BASE_URL + '/sprites/characters/fighter.png'
> PRODUCTION BUILD & DEPLOY
> vite build \# Outputs to client/dist/
> wrangler r2 object put \# Syncs dist/assets/ → R2 bucket
> monty-haul-assets/ \# (via npx wrangler or CI step)
> Vercel deploys client/dist/ \# Serves index.html + JS bundles
> Phaser loads: https://assets.montyhaulgame.com/sprites/characters/fighter.png
> GIT STRATEGY FOR ASSETS
> Source assets (client/src/assets/) → committed to git
> Built/processed assets (client/dist/) → .gitignored
> R2 is populated by CI on every merge to main, not from git
> **Why Cloudflare R2 over S3 or git-hosted assets**
> *R2 has zero egress fees — AWS S3 charges per GB served, which accumulates quickly for a game loading sprites on every session. R2 also sits behind Cloudflare's CDN automatically, meaning assets are served from edge nodes close to each player. Source assets stay in git for version control; R2 is the runtime delivery layer only.*
> **Wrangler CLI — one additional install**
> *The Wrangler CLI (npm install -g wrangler) is required to deploy assets to R2. It's free and part of Cloudflare's toolchain. Authenticate once with 'wrangler login'. This is the only additional install beyond Node.js needed to complete the asset pipeline.*
# 4. Key Module Details
**shared/data/constants.js — The Tuning File**

This is the single most important file for rapid iteration. Every numeric value that affects game feel lives here. Coding agents making balance changes should edit this file first, not hunt through logic modules. It is imported by both client (for display purposes) and server (for authoritative resolution).


> // shared/data/constants.js
> // ─────────────────────────────────────────────────────────────────
> // SERVER TICK RATE
> // 20Hz is correct for this genre — 3-second attack cooldowns mean 60Hz
> // is wasted resolution. 20Hz with client-side interpolation is standard
> // for 2D top-down games. Tier 4 at 48 players may need to drop further.
> export const SERVER_TICK_RATE_HZ = {
> tier1: 20, // Floors 1-3 — 4 players, comfortable headroom
> tier2: 20, // Floors 4-6 — 12 players, still comfortable
> tier3: 15, // Floors 7-9 — 24 players, reduce proactively
> tier4: 10, // Floor 10 — 48 players, minimum viable authority
> };
> // SURVIVAL
> export const HP_MULTIPLIER = 2.0; // Base HP × this value at run start
> export const OOC_REGEN_RATE = 2; // HP per second out of combat
> export const OOC_REGEN_DELAY_MS = 3000; // Ms after last hit before regen starts
> export const COMBAT_DETECTION_RADIUS = 200; // Px — enemy within this = in combat
> // COMBAT
> export const ATTACK_COOLDOWN_MS = 3000; // Player attack cooldown
> export const MELEE_ATTACK_RANGE_PX = 25; // Melee hit radius
> export const CRIT_MULTIPLIER = 2; // Dice multiplier on natural 20
> // MOVEMENT
> export const BASE_SPEED_PX_PER_SEC = 150; // 30ft at 5px/ft
> export const DASH_SPEED_MULTIPLIER = 2.0; // Speed when Dashing
> // EXTRACTION
> export const RITUAL_DURATION_MS = 60000; // 60 seconds to complete ritual
> export const RITUAL_RADIUS_PX = 120; // Must stay within this of portal
> // LEVER MECHANIC
> export const LEVER_RESET_MS = 4000; // First lever resets after this ms
> // Calibrate to exceed max crossing time
> // META
> export const BANK_SLOTS_PER_RUN = 2; // Mid-run banking limit
> export const LONG_REST_ON_LEVEL_UP = true; // Full restore on each floor
> **Why 20Hz and not 60Hz**
> *Node.js is single-threaded. At Tier 4 (48 players + 50+ enemies + dozens of active conditions), Colyseus state serialization at 60Hz will saturate the event loop before any gameplay logic becomes a bottleneck. 20Hz server authority with client-side interpolation is the genre standard for 2D top-down games — Hades, Nuclear Throne, and similar titles all run server authority at this rate or lower. The per-tier values above should be tuned empirically during load testing, not assumed to be final.*
**shared/logic/combat.js — Pure Combat Resolution**

All attack resolution logic. Takes inputs, returns outcomes. No side effects, no framework dependencies, fully unit testable. The server calls this; the client only uses it to display predicted outcomes (optional — can be removed for full authoritative simplicity).


> // shared/logic/combat.js
> // ─────────────────────────────────────────────────────────────────
> // resolveAttack({ attacker, target, weapon, conditions })
> // Returns: { hit: bool, crit: bool, damage: int, roll: int }
> // applyDamage({ target, damage, damageType })
> // Returns: { newHP: int, overkill: int }
> // Applies resistance/vulnerability from target.conditions
> // rollDice(count, sides) — e.g. rollDice(2, 6) → 2d6 result
> // getModifier(score) — ability score → modifier
> // getProficiencyBonus(level) — character level → proficiency bonus
> // MULTI-ATTACK CONVENTION:
> // resolveAttack always resolves a single attack. It does not handle
> // multi-roll internally and never returns an array.
> // Multi-attack (Extra Attack, Flurry of Blows, Reckless Attack) is the
> // caller's responsibility: CombatSystem.js calls resolveAttack N times
> // per action, where N comes from the character's class feature data
> // (e.g. shared/data/classes/fighter.js attacksPerAction at level 5).
> // All results are collected by CombatSystem and broadcast together.
> // All functions are pure: same inputs always produce same category of output.
> // Randomness is injected via an optional rng parameter for deterministic testing.
**shared/data/constants.js Relationship to Subclass Files**

Subclass-specific tuning values live in their own file in shared/data/subclasses/, not in constants.js. Constants.js is for global system values. Subclass files own their own numbers. Example:


> // shared/data/subclasses/champion.js
> export const CHAMPION = {
> name: 'Champion',
> class: 'fighter',
> features: {
> 3: { improvedCritical: { critRange: 19 } }, // Crit on 19-20
> 7: { remarkableAthlete: true },
> 10: { additionalFightingStyle: true },
> 15: { superiorCritical: { critRange: 18 } }, // Crit on 18-20
> }
> };
> // shared/data/subclasses/skirmisher.js (original subclass)
> export const SKIRMISHER = {
> name: 'Skirmisher',
> class: 'rogue',
> status: 'DESIGN_TBD', // Moving window not yet defined
> features: {
> 3: {
> rangedMovementBonus: {
> attackBonus: 1, // TBD — placeholder
> damageBonus: 1, // TBD — placeholder
> movingWindowMs: null, // TBD — requires design spec
> }
> }
> }
> };
**shared/logic/floor-generator.js — Floor Assembly**

The GDD describes procedurally generated dungeons. The approach for the beta is room-template assembly: a pool of hand-authored room templates per tier, selected and connected procedurally each run. This gives authorial control at the room level (enemies, loot, and special feature placement are hand-designed) while keeping runs non-identical. Pure random generation is deferred — it introduces too many edge cases (unreachable areas, broken lever placement, portal in spawn room) to be worth the complexity at beta.


> // shared/logic/floor-generator.js
> // ─────────────────────────────────────────────────────────────────
> // generateFloor({ tier, floorNumber, seed })
> // Returns: FloorLayout — { rooms: Room\[\], connections: Edge\[\],
> // spawnRoomId, exitRoomId, portalRoomId, leverRoomIds }
> //
> // APPROACH: Room-template assembly
> // 1. Select N room templates from the tier's template pool (seeded random)
> // 2. Connect them in a graph — linear spine + optional branches
> // 3. Assign required features: spawn, exit/stairs, portal, lever pair
> // 4. Required features are placed in templates that have designated
> // feature slots — not dropped into arbitrary rooms
> //
> // TEMPLATE STRUCTURE (in client/src/assets/tilemaps/)
> // Each template is a Tiled .json file with named object layers:
> // - 'spawn_points' — valid player spawn positions
> // - 'enemy_spawns' — enemy type + position (type set by generator)
> // - 'loot_spawns' — chest/item drop positions
> // - 'feature_slots' — where portals, levers, stairs can be placed
> //
> // STATUS: Stub — full implementation is Phase 2.5 alongside instance handoff.
> // For Phase 1-2, floors are single hand-authored tilemaps (no generation).
> **Why not full procedural generation at beta?**
> *Lever placement, portal positioning, and line-of-sight for enemy AI are all sensitive to room geometry. A fully procedural generator must solve all three correctly to produce playable floors. Room-template assembly sidesteps this by letting designers author valid geometry once, then letting the generator compose known-good rooms. Full procedural generation is a post-beta optimization once the constraints are well understood.*
**server/systems/ZoneSystem.js — Cohort Branch Management**

ZoneSystem manages cohort awareness within the single room — specifically, which map areas each player has access to and which entities the server needs to track relative to each player. Critically, cross-cohort isolation on floors 1-3 is enforced by map geometry, not by server-side broadcast filtering. Branches A, B, and C are physically separate tilemap areas with no connecting passages. A player in Branch A cannot reach Branch B because there is no path — not because the server is suppressing their view of it.


> // server/systems/ZoneSystem.js
> // ─────────────────────────────────────────────────────────────────
> // Primary responsibility: cohort assignment and map area ownership.
> // Secondary responsibility: interest management — only send state
> // updates to clients for entities within reasonable proximity.
> // (Interest management is a performance optimisation, not the
> // mechanism of cohort separation. Separation is the map.)
| // Each player has a cohortId assigned at lobby: 'A' | 'B' | 'C'    |

> // Each cohort spawns into its own branch of the floors 1-3 map.
> // Branch exits (stairs to floor 4) lead into the shared floor 4 map.
> // Once a player is on floor 4+, cohortId is retained for tracking
> // purposes (run history, analytics) but has no gameplay effect.
> // Key methods:
> // assignCohort(playerId, cohortId) — called on room join
> // getSpawnPoint(cohortId, floorNumber) — returns spawn coords for branch
> // getBranchMap(cohortId, floorNumber) — returns tilemap for branch
> // Floors 1-3: returns cohort-specific branch map
> // Floor 4+: returns the shared continuous map (same for all cohorts)
> // What ZoneSystem does NOT do:
> // - Filter state broadcasts based on cohort (geometry does this)
> // - Prevent cross-cohort attacks (walls do this)
> // - Track a 'partition dissolved' event (there is no such event)
> // Players simply walk out of their branch into the shared floor.
> **Why geometry is better than a broadcast filter**
> *A broadcast filter approach requires the server to track partition state per player, fire a 'merge event' at the right moment, and send a full state snapshot of newly-visible players at transition. Geometry-enforced separation requires none of this — players in Branch A simply never get close enough to Branch B players to receive their state updates under normal interest management. The floor 4 map has three entrances; players walk in and start receiving each other's updates as they come within range, exactly as they would with any two players approaching each other.*
# 5. Database Schema (Supabase)

> **Status note (2026-05-10).** The schema below is the original design sketch. The schema that actually ships is simpler and lives in `supabase/migrations/001_initial_schema.sql` + `supabase/migrations/002_unique_stash.sql` — see those files for the canonical column list. Notable deltas from the sketch: `gear_stash` does not yet carry `rarity`; `meta_progression` uses `raider_pack JSONB` and no longer separates `hub_potions` / `unlocked_options`; `run_history` uses a single `class TEXT` column (no multiclass support yet) and omits `items_banked` and `deaths`. The sketch remains useful as a forward-looking target — most additions are non-breaking column adds when the corresponding features land.

Minimal schema for beta. Designed to be extended. All tables have row-level security — players can only read/write their own rows. The server bypasses RLS using the service role key for trusted writes (extraction commits, run results).


> \-- auth.users (managed by Supabase Auth)
> \-- Player profile (1:1 with auth.users)
> CREATE TABLE player_profiles (
> id UUID PRIMARY KEY REFERENCES auth.users,
> display_name TEXT NOT NULL,
> created_at TIMESTAMPTZ DEFAULT now()
> );
> \-- Persistent gear stash (items extracted from runs OR committed via mid-run banking)
> \-- Mid-run banking note: the 2-slot banking limit is enforced in Colyseus room state
> \-- (banked_count per player, tracked in PlayerState.js). When a player banks an item
> \-- the server writes it here immediately — same commit path as extraction, just mid-run.
> \-- No separate table needed; the distinction is captured in acquired_via below.
> CREATE TABLE gear_stash (
> id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
> player_id UUID REFERENCES player_profiles NOT NULL,
> item_id TEXT NOT NULL, \-- references shared/data item registry key
| rarity TEXT NOT NULL, \-- common | uncommon | rare | legendary                           |

> quantity INT DEFAULT 1, \-- for stackable consumables
| acquired_via TEXT DEFAULT 'extract', \-- 'extract' | 'bank' | 'craft' | 'shop' |

> acquired_at TIMESTAMPTZ DEFAULT now()
> );
> \-- Meta-progression (hub unlocks, potion inventory, gold)
> \-- unlocked_options uses JSONB for beta simplicity. If crafting recipes grow into
> \-- their own economy with materials and unlock trees, extract to a crafting_recipes
> \-- table. Flag for post-beta schema review.
> CREATE TABLE meta_progression (
> player_id UUID PRIMARY KEY REFERENCES player_profiles,
> gold INT DEFAULT 0,
> hub_potions JSONB DEFAULT '{}', \-- { potion_id: quantity }
> unlocked_options JSONB DEFAULT '\[\]', \-- \[ subclass_id, prestige_id, recipe_id\... \]
> updated_at TIMESTAMPTZ DEFAULT now()
> );
> \-- Run history (one row per completed or failed run)
> \-- classes_played replaces single 'class' TEXT to support multiclass runs.
> \-- e.g. \[{ class: 'fighter', levels: 3 }, { class: 'rogue', levels: 3 }\]
> CREATE TABLE run_history (
> id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
> player_id UUID REFERENCES player_profiles NOT NULL,
> classes_played JSONB NOT NULL, \-- \[{ class, subclass, levels }\] — supports multiclass
> floors_reached INT NOT NULL,
> extracted BOOLEAN DEFAULT false,
> gold_extracted INT DEFAULT 0,
> items_extracted JSONB DEFAULT '\[\]',
> items_banked INT DEFAULT 0, \-- count of mid-run bank commits this run
> kills INT DEFAULT 0,
> deaths INT DEFAULT 0,
> run_duration_s INT,
> completed_at TIMESTAMPTZ DEFAULT now()
> );
> \-- NOTE: No mid_run_state table needed.
> \-- The cohort/zone model keeps all players in one room for the full run.
> \-- Banking state (slots used, items pending) lives in Colyseus PlayerState during the run.
> **Future Schema Extension: Crafting**
> *The GDD describes crafting recipes as a meta-progression unlock. For beta, recipe IDs are stored in meta_progression.unlocked_options JSONB alongside subclass and prestige unlocks. If crafting grows into its own economy with material types, recipe trees, and yield tables, extract to dedicated tables: crafting_recipes (recipe definitions) and crafting_materials (player material inventory). This is a post-beta concern — don't build it until the crafting system is designed.*
# 6. Build Phases

> **Status note (2026-05-10).** The phase table below is the original build-out plan. The project actually evolved through a different sequence: a single-room single-player prototype on Phaser + Vite came first; multiplayer joined that prototype next (Colyseus DungeonRoom, shared room, no cohorts yet); then the server-persistence track began, documented separately in `docs/server-persistence-plan.md` (its own Phase 1 = in-memory store, Phase 2 = Supabase backend, Phase 3 = hardening). Cohort branches, the floor 4 convergence map, and the full 12-player loop described below are not yet built — they remain the long-range target. Treat this table as design intent, not status.

  ----------- --------------------------- -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------------------
  **Phase**   **Scope**                   **Key Deliverable**                                                                                                                                                                                **Multiplayer?**

  Phase 0     Vertical slice (complete)   Single HTML file prototype, Fighter only, 1 floor. Combat resolution should be written as a standalone module — not inline — so it migrates directly into shared/logic/combat.js in Phase 1.   No

  Phase 1     Beta Foundation             Phaser 3 + Vite, Supabase schema, R2 asset pipeline, persistent account, single-player. First task: migrate Phase 0 combat module into shared/logic/combat.js rather than rewriting.               No

  Phase 2     Multiplayer Core            Colyseus DungeonRoom, 12-player lobby, 3 cohorts of 4, branch map layout, floors 1-3 in separate branches, extraction portal                                                                       Yes — cohort isolated

  Phase 3     Convergence & Full Loop     Floor 4 continuous map with three branch entrances, floors 4-6, lever mechanic, full 12-player shared space, complete beta loop                                                                    Yes — full

  Phase 4     Content Build-Out           Full Wave 1 class roster, consumable tables, itemization system, hub economy                                                                                                                       Yes — full

  Phase 5     Wave 2 + Scale              Ranger, Paladin, spell slots, prestige classes. Post-beta: floor 7+ cross-room merges for 24/48 players                                                                                            Yes — full
  ----------- --------------------------- -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------------------

# 7. Coding Agent Workflow Guide
This section defines how to work effectively with Opus 4.6 coding agents on this codebase. These conventions are as important as the architecture itself — agent-driven development has specific failure modes that the structure above is designed to prevent.

## The Golden Rules
-   One agent session, one module. Never ask an agent to touch multiple systems in one session. 'Add Zealot Barbarian subclass' is correct scope. 'Add Zealot and fix extraction portal' is not.

-   Balance changes go in shared/data only. Agents should never hardcode stats in logic or rendering files. If a number might need tuning, it lives in constants.js or the relevant data file.

-   New game logic goes in shared/logic. If the agent writes combat logic in server/systems or rendering logic in shared, it's in the wrong place.

-   Server never trusts the client. If an agent writes server code that accepts damage values or loot assignments from the client, reject it.

-   Always provide the relevant shared/types file as context. Agents drift on data shapes without it. Paste the relevant type definition at the start of every session.

## Task Scoping Templates
Use these patterns when prompting agents. The more precisely scoped the task, the better the output.


> **Template: Add a subclass**
> *"Create shared/data/subclasses/zealot.js for the Zealot Barbarian subclass. Use the existing berserker.js as a structural reference. The Zealot features at levels 3, 6, and 10 are \[paste SRD features\]. Tuning values should use named constants — add any new constants to shared/data/constants.js with a comment explaining each. Do not modify any other files."*
> **Template: Add a consumable**
> *"Add the Potion of Heroism to shared/data/consumables/potions.js. Effect: grants 10 temporary HP and the Bless condition (+1d4 to attack rolls and saving throws) for 60 seconds. Available on floors 2-3. Rarity: uncommon. The Bless condition should be added to shared/logic/conditions.js if it doesn't exist. Do not modify drop tables — those are a separate task."*
> **Template: Tune a balance value**
> *"In shared/data/constants.js, adjust ATTACK_COOLDOWN_MS from 3000 to 2500. In shared/data/subclasses/champion.js, adjust the level 3 crit range from 19 to 18 as a test. Explain what gameplay impact you expect from each change. Do not modify any logic files."*
## Context to Always Include
At the start of any agent session involving game logic, paste the following files as context:

-   shared/types/player.js and shared/types/item.js — data shapes the agent will work with

-   shared/data/constants.js — so the agent knows what tuning values already exist

-   The specific data or logic file being modified

-   Any relevant subclass or item file being used as a structural reference

## Known Agent Failure Modes
  ------------------------------------------------------ -------------------------------------------------------------------------------------------------------
  **Failure Mode**                                       **Prevention**

  Hardcoding numbers in logic files                      Always ask for named constants; review output for bare numbers

  Writing combat logic in the server instead of shared   Scope tasks to one package; reject PRs that put logic in wrong layer

  Using Phaser.Physics for movement or collision         Explicit callout in Section 3.3; reject any code referencing Phaser.Physics or this.physics

  Client state drift from server                         Never ask agent to 'add state management to the client' — state comes from Colyseus only

  Inventing new type shapes                              Always provide the types/ files as context; tell agent to extend, not replace

  Over-engineering in one session                        Hard cap: one module per session; if agent starts touching unrelated files, stop and rescope

  Rewriting Phase 0 prototype instead of migrating       Phase 1 first task is explicitly to migrate combat.js — brief agent on this before any Phase 1 work
  ------------------------------------------------------ -------------------------------------------------------------------------------------------------------

## Post-Task Validation Checklist
After every agent session, run through this checklist before accepting the output. These questions catch the most common drift patterns at end-of-session rather than during code review.


> **Validation Checklist — run after every agent task**
> *1. Does the new/modified file import only from shared/? (No reaching into server/ or client/ from the wrong package.) 2. Does it export in the same pattern as the reference file provided? (Named exports, same module shape.) 3. Are all numeric values named constants? (No bare numbers — check for literals like 3000, 0.5, 25.) 4. If a new constant was added, is it in constants.js or the relevant subclass/item file — not inline? 5. Does it add anything unexpected to server/ or client/ packages? (New files outside the scoped module are a red flag.) 6. If it touches shared/types/, does it extend the existing shape rather than replacing it? 7. If the task involved a new condition or status effect, is it registered in shared/logic/conditions.js? 8. Does the agent's explanation of what it changed match what the diff actually shows?*
## Test File Conventions
The shared/tests/ directory contains all unit tests for shared/logic modules. Tests are plain JavaScript — no framework required to run them, though a test runner (jest or vitest) can be adopted in Phase 1. The injected RNG pattern in combat.js is the model for all testable randomness: pass a deterministic function in tests, use Math.random in production.


> **Template: Ask an agent to write a test**
> *"Write a test for the resolveAttack function in shared/logic/combat.js. Place it in shared/tests/combat.test.js. Use the existing test file structure as a reference. Test at minimum: a hit against a low-AC target, a miss against a high-AC target, a natural 20 crit, and damage resistance halving. Use a seeded RNG injected via the rng parameter — do not use Math.random in tests. The test file should be runnable with: node shared/tests/combat.test.js"*
*Monty Haul's Dungeon Crawl | Technical Architecture v0.4 | Internal Reference | Status section refreshed 2026-05-10*
