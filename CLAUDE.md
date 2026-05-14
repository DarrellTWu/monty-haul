# General Good Code Practices

## General Coding Principle: Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.

## General Coding Principle: Simplicity First
Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## General Coding Principle: Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

## General Coding Principle: Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" → "Write tests for invalid inputs, then make them pass"
"Fix the bug" → "Write a test that reproduces it, then make it pass"
"Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

# Monty Haul's Dungeon Crawl

2D PvPvE dungeon-crawl extraction roguelike. Browser-based, multiplayer-first.
D&D 5e SRD mechanics adapted for real-time play.

## Tech Stack
- Client: Phaser 3 (JS) + Vite
- Server: Colyseus (Node.js) — authoritative, single room per run
- Persistence: Supabase (Postgres)
- Assets: Cloudflare R2
- Language: Plain JS with JSDoc @typedef for type safety. No TypeScript.
- Monorepo: npm workspaces (client, server, shared)

## Architecture Rules
- shared/ is the source of truth. All game logic and balance data lives here.
- Server never trusts client. Clients send inputs only; server resolves outcomes.
- No Phaser.Physics. Client renders positions from server state only.
- All tuning values are named constants in shared/data/constants.js or subclass files.
- One module per agent session. Never touch unrelated files.

## Key Commands
- `npm start` — starts both server and client together (via concurrently). Server is launched with `--env-file=server/.env` so `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` load automatically.
- `npm run dev` — starts Vite dev server (client) only
- `npm run server` — starts Colyseus server only (also passes `--env-file=server/.env`)
- `node shared/tests/combat.test.js` — run combat tests
- `node shared/tests/loot.test.js` — run loot tests
- `node server/tests/supabase-smoke.js` — round-trip a temp player through Supabase to validate the persistence layer (requires `server/.env`)

## Current File Structure (Actual)
Many files in docs/tech_spec.md are planned, not yet built. What actually exists:

**Server**
- `index.js` — entry point; creates an Express app, mounts `hubRouter` at `/hub`, wraps it in a Node `http.Server`, then passes that to Colyseus via `WebSocketTransport`. Single process serves both HTTP hub routes and WebSocket game rooms on port 2567. On startup, logs a warning if the dead-letter queue is non-empty (Phase 3 #6).
- `rooms/DungeonRoom.js` — message routing + equip/loot/hotbar/trap logic; rolls loot on enemy death; handles `open_container`, `close_container`, `take_item`, `take_gold`, `drop_item`, and `descend` (loot_corpse / loot removed in favour of container protocol). Floors are loaded from `FLOOR_REGISTRY` via `_loadFloor(n)` (clears entity maps + repopulates from floor data); player position + long rest applied on descend. Run completes only via Scroll of Extraction (`extract` consumable type) — no auto-complete on enemies-dead. `onJoin` loads raider pack from `playerStore` using `options.playerId`; tracks `_playerIds` (sessionId → playerId), `_extracted` (Set of sessionIds that used a scroll), `_runStartedAt` (sessionId → ms timestamp at join, for `run_history.run_duration_s`), and `_maxFloor` (sessionId → highest floor reached, bumped on `descend` for every active session). `_buildRunMeta(sessionId, player)` returns `{ classId, floorsReached, kills: 0, runDurationS }` consumed by both `commitExtract` (after scroll consumption) and `commitDeath` (in `onLeave` for any player not in `_extracted`). Kills tracking is deferred — always 0. **Late-join caveat (not in scope yet):** the single-room model lets a second crawler join while a first is mid-run; the joiner spawns on whatever floor the room is currently on, and their `floors_reached` reflects that floor (not 1). This is internally consistent but skews if you read `run_history` as "depth descended through." Resolves itself once matchmaking lands and rooms are fresh-per-party — see `docs/server-persistence-plan.md`.
- `systems/` — CombatSystem.js, MovementSystem.js, AISystem.js (called from tick loop). **CombatSystem** computes `advantage = attacker.elevation === 1 && target.elevation === 0` at every `resolveAttack` call site (player main + offhand + monk MA, enemy attack) and passes it through; combat log renders `d20:N [adv: a, b]` when advantage was used. **MovementSystem.update(state, dt, bounds, geometry, enemyDefs)**: integrates velocity, calls `resolveWallCollision` against walls + locked doors (+ platform perimeter rects for elev-0 non-climbers), then `tryAutoClimb` to apply elevation transitions, then clamps to bounds. `canClimb` resolved at call time from `CLASS_REGISTRY` (players) and `enemyDefs` (enemies). **AISystem.update(state, dt, enemyDefs, melee, geometry)**: wall-sliding fallback (full → x-only → y-only → stop) gated by `circleOverlapsAny`. Elevation-aware pursuit retargets non-climbers to the nearest step when chasing an elevated target; room-aware pursuit retargets to the nearest unlocked door when target is across a walled room.
- `state/` — PlayerState (incl. `elevation`), EnemyState (incl. `lockedBy`, `elevation`), GameState (incl. `floor`, `stairs` map, `doors` map), ChestState (incl. `lockedBy`), TrapState, StairState, DoorState (`id, x, y, w, h, locked` — server-authoritative lock state).
- `store/playerStore.js` — async write-through cache backed by Supabase (Phase 2). In-memory `Map<playerId, state>` is the fast path; on miss, `loadPlayer`/`loadPlayerByUsername` populate from `gear_stash` + `meta_progression`. Every mutation modifies the cached state then `await`s `syncStashAndMeta` to persist. ALL exports are async: `getOrCreate(username)`, `getPlayer(playerId)`, `savePlayer(state)`, hub mutations (`stashToRaider`, `raiderToStash`, `dumpToStash`, `buyItem`, `sellItem`, `craftRecipe`, `renamePlayer`), and dungeon hooks (`commitExtract`, `commitDeath`). All mutations return `{ ok, stash, gold, raiderPack }`. New players (no DB row) get `INITIAL_STASH` seeded via `createProfile` on first `getOrCreate`. **Per-player mutation lock** (`_withLock`) serializes concurrent mutations for the same `playerId` so `syncStashAndMeta`'s DELETE+INSERT can't interleave; other players still mutate in parallel. **Server-authoritative pricing**: `buyItem(playerId, itemId)` reads `BUYABLE_PRICES` from `shared/data/shop.js`; `sellItem(playerId, itemId)` reads `sellPrice()`; `craftRecipe(playerId, recipeId)` reads `RECIPE_REGISTRY`. Client-supplied prices and recipe internals are no longer accepted. **Run history**: `commitExtract` and `commitDeath` accept `{ classId, floorsReached, kills, runDurationS }` and call `insertRunHistory` inside the same per-player lock; insert failure is logged but never invalidates the stash mutation. If `classId` is absent (legacy callers / tests) the row insert is skipped. **Dead-letter (Phase 3 #6)**: when `savePlayer` throws after withRetry exhausts (sustained Supabase outage), the payload is appended to the dead-letter log via `appendDeadLetter` BEFORE the error propagates so a server crash before the next mutation doesn't silently lose the run. `DungeonRoom` surfaces a "save failed" combat-log line on extract; death path logs only. **Rename** (Hub Settings): `renamePlayer(playerId, newUsername)` trims + validates non-empty and ≤20 chars server-side (never trust client), then dispatches to `renameUsername`; on success evicts the old `_byUsername` entry and registers the new one. A no-op rename (current name) is a fast-path success. UNIQUE conflict surfaces as `{ ok: false, error: 'username_taken' }` from the persistence layer.
- `routes/hub.js` — Express router mounted at `/hub`. CORS-enabled for Vite dev. 9 routes: `POST /login`, `GET /:playerId`, `POST /:playerId/raider/add|remove|dump`, `POST /:playerId/buy|sell|craft`, `POST /:playerId/rename`. Each route is wrapped in an `asyncRoute` helper that catches throws (e.g. Supabase outage) and returns 500. All delegate to `playerStore` and return updated state slices. `/buy` and `/sell` accept `{ itemId }` only; `/craft` accepts `{ recipeId }` only — pricing and recipe data are resolved server-side. `/rename` accepts `{ username }` and returns `{ ok, username }` on success or `{ ok: false, error }` with HTTP 400 on collision (`'username_taken'`) / invalid input (`'invalid_username'`) / unknown player. **Login/state include `username`**: `POST /login` and `GET /:playerId` both return `username` in the response payload so the client can display it in the hub top bar.
- `persistence/` — Supabase plumbing for Phase 2 server persistence:
  - `supabase.js` — singleton client init from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (throws if either missing). Uses the secret API key — bypasses RLS, server-only.
  - `withRetry.js` — generic async retry HOF. Defaults: 3 attempts, 100/200/400ms exponential backoff. Default predicate retries transport-layer errors but skips errors carrying a 5-digit Postgres SQLSTATE `code` (UNIQUE/FK/etc. — retrying won't help). Domain-agnostic — no Supabase dependency. **Only wrap idempotent ops** (SELECT, DELETE, UPSERT-by-PK). Wrapping a bare INSERT can produce duplicate rows on a post-commit blip + retry, unless a UNIQUE constraint absorbs the duplicate.
  - `playerLoad.js` — read-side: `loadPlayer(playerId)`, `loadPlayerByUsername(username)`. Aggregates `gear_stash` rows by `item_id`. Returns null for unknown ids. All SELECTs wrapped in `withRetry`.
  - `playerSync.js` — write-side: `createProfile(username, initialStash)` (inserts profile + seeds gear_stash + creates meta_progression row — un-retried, one-shot at user creation); `syncStashAndMeta(player)` (UPSERT current items by `(player_id, item_id)`, DELETE rows whose item_id is no longer present, UPSERT meta_progression by PK). UPSERT-first ordering means a crash mid-sync leaves leftover ghost rows but never wipes items the player still owns. All three ops idempotent and wrapped in `withRetry`. Requires the UNIQUE constraint added by `supabase/migrations/002_unique_stash.sql`. `renameUsername(playerId, newUsername)` — UPDATE `player_profiles.username` wrapped in `withRetry`; catches Postgres 23505 (UNIQUE violation on the existing `player_profiles.username` index) and returns `{ ok: false, error: 'username_taken' }` instead of throwing. All other errors re-thrown.
  - `runCommit.js` — `insertRunHistory({ playerId, classId, floorsReached, extracted, goldExtracted, itemsExtracted, kills, runDurationS })` writes one row to `run_history`. Called by `playerStore.commitExtract` / `commitDeath`. Throws on Supabase error; the caller wraps in try/catch so a telemetry failure never invalidates the preceding stash mutation. Un-retried — losing a telemetry row is preferable to duplicating one.
  - `deadLetter.js` — append-only JSONL log at `server/.deadletter.jsonl` (gitignored; override path with `MH_DEAD_LETTER_PATH` for tests). Exports `appendDeadLetter(record)`, `readDeadLetter()`, `deadLetterCount()`. `playerStore.commitExtract` and `commitDeath` write a record here when `savePlayer` throws after `withRetry` exhausts. Format: `{ kind: 'extract' \| 'death', playerId, payload, error, ts }`. Recovery is operator-driven — no auto-replay (commit hooks aren't idempotent without an idempotency key). Server `index.js` logs a startup warning if the file is non-empty.
- `matchmaking/` — not yet built

**Client** (no `rendering/` or `ui/` subdirectories)
- `scenes/HubScene.js` — entry point (auto-starts); checks localStorage for `mh_player_id` — shows username login screen if absent, otherwise loads state from server via `HubAPI.getState`. Two-panel layout: left cycles sub-screens (Class, Stash, Shop, Craft), right is persistent Raider Config + Enter Dungeon; screen-level VAULT display (top-right) shows hub gold; passes `{ class, abilityScores }` to DungeonScene (no items — server loads raider pack on join); auto-opens Stash tab when `init({ view: 'stash' })`. Sub-state: `_shopVendor` (`'potions' | 'armor'`), `_craftBench` (one of the six BENCH_REGISTRY ids), `_abilityScores` (point-buy allocation, initialized from class defaults on class select). Class sub-screen includes ability score customization panel (27-pt point buy, scores 8–16, non-linear cost via `POINT_COST`). Stash rows expose `[ Sell N gp ]`; raider panel shows `[ Dump All to Stash ]` when pack non-empty. All mutation call sites use `.then(ok => { if (ok) handler(); })` pattern. **Top bar** (`_topObjs`, rebuilt via `_buildTopBar`): clickable username + ⚙ icon at top-left, persistent across sub-tab switches; either click opens the settings panel. Refreshed on rename so the displayed name reflects current server state. **Settings panel** (modal overlay): full-screen backdrop with `.setInteractive()` swallows clicks under the panel and closes on backdrop click; a `panelHit` rect inside the panel blocks clicks from bubbling. Two modes tracked in `_settingsMode`: `'menu'` shows DEBUG MODE row (locked `[ ON ]`, dim `[ OFF ]` — placeholder; future hook: toggling OFF + entering the dungeon should route through the intended end-user gameplay path instead of today's testing/debug floor), `[ Rename ]`, `[ Log Out ]`; `'rename'` swaps the menu body for an outlined input box + `[ Save ]` / `[ Cancel ]` + status text. Mode swap re-renders only the body (`_settingsBodyObjs`); chrome (title, "Logged in as", Close) persists. Title swaps to `SETTINGS  ›  RENAME` (yellow) in rename mode. Single `_settingsKeyHandler` on `window`: Escape is mode-aware (rename→menu, menu→close); Enter submits; Backspace/printable edit the rename buffer (capped at 20 chars to mirror server validation). Rename success: `_setRenameStatus('Saved ✓')` + `_buildTopBar()` + 600ms `delayedCall` to `_closeSettings`. **Logout** (`_doLogout`): closes panel, calls `logout()` from `store/stash.js` (clears `_username`, `_playerId`, cache; removes `mh_player_id` from localStorage), then `this.scene.restart({})` — the `{}` explicitly clears any prior `init({ view: 'stash' })` so login lands on the Class tab, not Stash.
- `scenes/DungeonScene.js` — gameplay rendering, input wiring; receives `{ class, abilityScores }` via `init(data)` and passes `playerId` (from `stash.getPlayerId()`) to the server on join — server loads the raider pack; detects run complete/death, shows run summary overlay; server commits stash + gold on extract/death — no client-side stash mutations on run end; F-key triggers `_tryInteractNearby` which dispatches to chest, corpse, or unlocked stair; lootable corpses render dim gold with an "F: Loot" hint; stairs render as a brown box (orange when unlocked) with "F: Descend"; room dimensions + camera bounds redraw on `state.floor` change; per-entity `onRemove` handlers tear down old-floor gfx when the server clears MapSchemas during descend. **Geometry rendering** (M4 of geometry sprint): `_drawRoom(floor)` paints platforms (lighter ground `0x3a3a4f`), step transition strips (two-tone gradient at each step), and walls (dark `0x111118` with `0x4a4a5a` border) directly into the room graphics object. Doors are tracked via `state.doors.onAdd/onRemove` into `_doorGfx`; redrawn each tick (`_drawDoorBand`) — unlocked = lighter band, locked = wall-color band (locked path untested; currently no runtime door mutation source). Entity render depth uses `elevation`: ground entities at depth 2, elevated at depth 4 — keeps an elevated goblin layered above the platform tint rather than blending in.
- `scenes/HUDScene.js` — conditions, cooldown rings, hotbar overlay
- `scenes/InventoryScene.js` — equipment slots, bag, hotbar assignment UI; shows live `GOLD N gp` line under HP/AC; renders materials (skeleton_bone, wolf_pelt) in the bag. Bag groups duplicate items into a single row with `× N` qty (display-only — server inventory stays flat); fixed-height scrollable viewport clipped by a shared `GeometryMask`, reachable via mouse wheel; mask cleared on drag-start, restored on drag-end. Double-click routes by item type: weapons/armor → `sendEquip`, consumables → `sendAssignHotbar` to first free slot, materials → no-op. **Loot mode**: launched by DungeonScene with `{ lootSource: { kind, id } }`; replaces the left character-sheet column with a loot panel showing container gold and items; `[→ Drop]` buttons push bag items into the container; `sendOpenContainer` on create, `sendCloseContainer` on shutdown. `_lootHandshakeSeen` prevents premature auto-close before the server confirms the lock.
- `network/ColyseusClient.js` — `joinDungeon(opts)` forwards opts (incl. `class`, `playerId`, `abilityScores`) to server; loot container protocol: `sendOpenContainer`, `sendCloseContainer`, `sendTakeItem`, `sendTakeGold`, `sendDropItem`; `sendDescend` (stairs)
- `network/HubAPI.js` — thin async fetch wrapper for the `/hub` HTTP routes. Derives base URL from `VITE_COLYSEUS_URL` (replaces `ws` → `http`). Exports: `login(username)`, `getState(playerId)`, `addToRaider`, `removeFromRaider`, `dumpToStash`, `buy`, `sell`, `craft`, `rename(playerId, username)`. Used exclusively by `store/stash.js`.
- `input/InputHandler.js`
- `store/stash.js` — server-backed item store. `localStorage` used only to persist `mh_player_id` across sessions. In-memory cache (`_cache = { stash, gold, raiderPack }`) populated by `initFromServer(playerId, state)` on login/load — server wins. Module-level `_username` also populated by `initFromServer` from the server payload. Sync reads: `getStash`, `getRaiderPack`, `getRaiderPackFlat`, `getHubGold`, `getPlayerId`, `getUsername`. Async mutations (call `HubAPI`, update cache, return `Promise<bool>`): `stashToRaider`, `raiderToStash`, `dumpRaiderPackToStash`, `buyItem`, `sellItem`, `craftRecipe`. **`renameUser(newUsername)`** returns the full server result `{ ok, username?, error? }` (not a bool — the UI distinguishes `username_taken` from `invalid_username` from a network failure). On success, updates `_username` from the canonical server value. **`logout()`** clears `_username`, `_playerId`, and the in-memory cache, then removes `mh_player_id` from localStorage; no server call needed (sessions are stateless between runs). ALL hub-side state mutations route through this file — single migration point for Phase 2.

**Shared**
- `data/` — constants.js (incl. `ENTITY_RADIUS_PX = 16`, `STEP_HALF_WIDTH_PX = 24`, `PLATFORM_WALL_THICK_PX = 2`), values.js (ITEM_GOLD_VALUE + sellPrice), shop.js (VENDOR_CATALOG), weapons/melee.js, armor/armor.js, items/(consumables+shields+materials), enemies/tier1.js (enemy defs now carry `canClimb: bool` — goblin true, dog/skeleton false), classes/fighter.js, classes/barbarian.js, classes/monk.js (class defs now carry `canClimb: bool` — monk true, fighter/barbarian false), classes/index.js (CLASS_REGISTRY), loot/tier1.js (LOOT_TABLE_REGISTRY), crafting/benches.js (BENCH_REGISTRY), crafting/recipes.js (RECIPE_REGISTRY + recipesForBench), floors/floor1.js + floor2.js + index.js (FLOOR_REGISTRY — floor data now declares `walls, doors, platforms, rooms` arrays alongside enemies/chests/traps/stairs).
- `logic/combat.js` — full attack resolution. `resolveAttack` accepts optional `advantage: boolean`; when true rolls 2d20 and keeps the higher (natural 1 / natural 20 / hit threshold use the kept die). Returns `advantageRolls: [a, b]` for the kept + discarded dice when advantage was active.
- `logic/loot.js` — pure `rollLoot(table, rng?)` returning `{ gold, items }`; supports literal item ids and `@pool` references. The `@potion_any` pool filters out consumables with `type === 'extract'` (Scroll of Extraction is run-control, not loot).
- `logic/loot-window.js` — pure container-lock protocol: `tryOpenContainer`, `tryCloseContainer`, `releaseLocksHeldBy`, `tickContainerLocks`, `tryTakeItem`, `tryTakeGold`, `tryDropItem`, `checkLootAccess`, `refreshSourceFlags`. Imported by both DungeonRoom and server tests. No framework deps.
- `logic/geometry.js` — pure geometry helpers for the dungeon geometry system: `resolveWallCollision`, `circleOverlapsAny`, `isLineBlocked` (stub, returns false until LoS/ranged system lands), `tryAutoClimb` (perimeter-crossing → elevation transition), `platformPerimeterRects` (4 edges × 2 segments split at step positions, with gaps), plus `segmentIntersectsCircle`, `segmentPerimeterCrossing`, `pointInRect` primitives. No framework deps.
- `tests/combat.test.js`, `tests/loot.test.js`, `tests/geometry.test.js`
- `types/` — player.js, enemy.js, weapon.js

**Server tests** (in `server/tests/`, run with `node server/tests/<file>`)
- `shared/tests/geometry.test.js` — 47 pure unit tests for `shared/logic/geometry.js`: AABB push-out, `circleOverlapsAny`, `isLineBlocked` stub, segment-vs-circle and segment-vs-perimeter primitives, `pointInRect`, `tryAutoClimb` (perimeter inward/outward + defensive no-op cases), `platformPerimeterRects` (8 segments, step gaps at declared positions, no-steps fallback).
- `server/tests/container-lock.test.js` — 21 tests for `tryOpenContainer`, `tryCloseContainer`, `releaseLocksHeldBy`, `tickContainerLocks`
- `server/tests/loot-flow.test.js` — 35 tests for `tryTakeItem`, `tryTakeGold`, `tryDropItem`, hotbar-cleanup, and lock gate enforcement
- `server/tests/supabase-smoke.js` — 34 tests against the real dev Supabase project: createProfile, syncStashAndMeta (add/modify/remove/empty/full-replacement), convergence assertions for the UPSERT + DELETE-NOT-IN sync model, loaders, negative cases. Inserts a temp row keyed by username; cleans up afterward. Loads env via `process.loadEnvFile('server/.env')` so it can be invoked directly without npm scripts.
- `server/tests/concurrency-smoke.js` — 7 tests; fires N concurrent `buyItem` calls against one player and asserts the per-player mutation lock prevents duplicate `gear_stash` rows.
- `server/tests/anti-cheat-smoke.js` — 25 tests; covers `/buy` `/sell` `/craft` rejection paths (unknown id, material id buy, unknown recipe id) and asserts gold + stash are unchanged after rejection.
- `server/tests/rename-smoke.js` — 31 tests against the real dev Supabase project; covers happy-path rename, no-op rename, collision via UNIQUE (`username_taken`), invalid input (empty / whitespace-only / null / undefined / 21 chars), boundary at 20 chars exact, trim of surrounding whitespace, not-found playerId, `_byUsername` cache eviction, and persistence (re-login under the new name returns the same playerId). Creates two temp players keyed by a random 6-char base36 tag (constrained ≤20 chars to fit the rename validator); cleans up afterward.
- `server/tests/run-history-smoke.js` — 19 tests; drives `commitExtract` and `commitDeath` end-to-end, asserts each writes one correctly-shaped row to `run_history`. Verifies the legacy no-metadata `commitDeath` call is a no-op for run_history.
- `server/tests/with-retry.test.js` — 17 pure unit tests for the `withRetry` HOF (no Supabase, no env). Covers success-first-try, fails-then-succeeds, exhausted attempts, custom predicates, default Postgres-error skip, and exponential backoff timing.
- `server/tests/dead-letter.test.js` — 18 pure unit tests for the dead-letter helpers (no Supabase, no env). Uses `MH_DEAD_LETTER_PATH` to redirect to a temp file. Covers missing file, single + multiple appends, ordering, ts insertion, nested-payload round-trip, empty-file edge case.
- `data/subclasses/`, `logic/conditions.js`, `logic/ai.js` — not yet built

## Agent Task Context
Before any game logic task, read these files:
- `shared/types/player.js` and `shared/data/constants.js` (data shapes and tuning)
- `server/state/PlayerState.js` — authoritative runtime schema. Key fields:
  - `x, y, vx, vy` — position and velocity
  - `hp, maxHp, ac, level, alive`
  - `class` — class id string (e.g. `'fighter'`); set on join from join options
  - `equippedWeaponId, offhandId, equippedArmorId` — equipment slots ('' = empty)
  - `inventory` — ArraySchema of item id strings
  - `hotbar` — ArraySchema[10] of ability/consumable ids or ''
  - `conditions` — ArraySchema of active condition id strings
  - `secondWindAvailable, blessRemainingMs, longstriderRemainingMs, falseLifeRemainingMs, tempHp`
  - `rageRemainingMs, rageUsesRemaining` — Barbarian rage tracking (synced for HUD ring + inventory)
  - `gold` — run-scope wallet; committed to hub gold via `playerStore.commitExtract` on extract, lost on death/disconnect
  - `str, dex, con, int, wis, cha` — ability scores; set on join from client point-buy selection (validated server-side); fall back to `classDef.baseAbilityScores` if invalid. Mutable during run (potions, ASIs). Call `_recomputeStats(player)` after any change to keep derived values (AC, etc.) in sync.
  - `elevation` — 0 = ground, 1 = elevated (on a platform). Synced. Seeded on join + descend by `DungeonRoom._spawnElevation(x, y)`; mutated each tick by `MovementSystem.tryAutoClimb` when an entity's movement segment crosses a platform perimeter. Schema is a number to allow future multi-level stacking (out of scope this sprint).
- `server/state/EnemyState.js` — synced enemy schema. Loot fields:
  - `lootGold, lootItems, looted` — populated on first tick after death from `LOOT_TABLE_REGISTRY[type]` via `rollLoot`; `looted` is true when gold===0 and lootItems is empty (bidirectional — can flip back if items are dropped in)
  - `lockedBy` — sessionId of the player currently holding the loot-window lock ('' = free); cleared automatically by `tickContainerLocks` when player goes out of range/dies or by `releaseLocksHeldBy` on disconnect
  - `elevation` — same semantics as PlayerState.elevation. Seeded by `_loadFloor` from each enemy's spawn position vs the floor's platform rects.
- The specific file being modified
- A structural reference file if creating something new

## Class Definition Schema
Each class file exports a const with these fields (see fighter.js / monk.js as reference):
- `id` — string key matching CLASS_REGISTRY entry
- `hitDie` — e.g. 10 for fighter, 8 for monk
- `baseAbilityScores` — `{ str, dex, con, int, wis, cha }` — used for attack rolls, saves, and AC
- `getStartingHp(conMod)` — function returning starting HP
- `startingWeaponId`, `startingArmorId` — item ids ('' = none)
- `unarmoredDefense` — optional string key into baseAbilityScores (e.g. `'wis'` for monk). When set and player has no armor and no shield, AC = 10 + DEX mod + [stat] mod. Handled in DungeonRoom `onJoin` and `_recomputeStats`.
- `saveProficiencies` — array of ability keys
- `fightingStyle` — string or null; passed to CombatSystem for Dueling bonus etc.
- `classFeatures` — array of ability ids seeded into hotbar slots 0–N on join (e.g. `['rage']`)
- `rageUses` — optional number of rage uses (Barbarian only for now)
- `feat` — starting feat id string

## Loadout Model
`DungeonRoom.onJoin` branches on `options.items.length`:
- **Empty** → class default weapon/armor equipped, bag empty (free starter loadout)
- **Non-empty** → no class defaults; items go to bag, server auto-equips first weapon/armor/shield, auto-assigns consumables to hotbar

Class default gear extracted at run-end enters the raider pack normally and triggers the non-empty branch on the next run.

## Client-Server Message Protocol
All messages handled in `DungeonRoom.js` onCreate.

**Client → Server**
- `move` `{ dx, dy }` — normalized movement direction (-1..1 each axis)
- `stop` — zero player velocity
- `attack` — attempt melee attack
- `equip` `{ itemId, slot? }` — slot: `'weapon'|'offhand'|'armor'` or omit for auto-detect
- `unequip` `{ slot }` — slot: `'weapon'|'offhand'|'armor'`
- `open_container` `{ sourceKind, sourceId }` — claim loot-window lock on a chest (`sourceKind='chest'`) or corpse (`sourceKind='corpse'`); server replies `container_lock_denied` if already locked by another player
- `close_container` `{ sourceKind, sourceId }` — release the lock; no-op if caller doesn't hold it
- `take_item` `{ sourceKind, sourceId, itemIndex }` — move item at index from container into player inventory; validates lock, range, index bounds
- `take_gold` `{ sourceId }` — transfer all gold from a corpse to the player; validates lock and range
- `drop_item` `{ sourceKind, sourceId, inventoryIndex }` — move item at inventory index into the container; validates lock and range; clears hotbar binding if last copy of that item
- `descend` `{ stairId }` — descend the named stair (server validates exists, !locked, in range; swaps floor for everyone in the room)
- `assign_hotbar` `{ itemId, slot }` — bind ability/consumable id to hotbar index 0–9
- `use_hotbar` `{ slot }` — activate hotbar slot 0–9. Consumable types: `healing`, `bless`, `longstrider`, `false_life`, `extract` (sets `state.phase = 'complete'`, ending the run)

**Server → Client**
- `combat_log` `{ message }` — text line pushed to the HUD combat log
- `container_lock_denied` `{ sourceKind, sourceId, holder }` — sent when `open_container` is rejected; InventoryScene shows a HUD log line and closes

## Loot System
- Tables live in `shared/data/loot/tier1.js` keyed by enemy id (LOOT_TABLE_REGISTRY).
- Each table: `{ gold: { dice, bonus } | null, drops: [{ itemId, chance, qty }] }`.
- `itemId` accepts literal ids OR `@pool_name` references resolved by `shared/logic/loot.js` (currently only `@potion_any` → CONSUMABLE_REGISTRY). Add new pools to the POOLS map in loot.js.
- DungeonRoom._tick calls `_rollLootForFreshDeaths()` each tick — idempotent via `_lootRolled` Set guard. Enemies with no table drop nothing silently.
- All numeric tuning (dice, chances, gold ranges) lives in the table file, not in logic.

## Dungeon Geometry (walls, doors, platforms, rooms, steps)
Implemented in the geometry sprint (see `docs/geometry-sprint-plan.md` for the full design).

- **Floor data shape** — alongside `enemies/chests/traps/stairs`, each floor declares `walls`, `doors`, `platforms`, and `rooms` arrays. Walls + platforms are static (server stashes refs in `_floorWalls` / `_floorPlatforms`). Doors are populated into `state.doors` (synced MapSchema) so runtime lock state can mutate. Rooms are AI-navigation hints (stashed in `_floorRooms`); each room has `{ id, x, y, w, h, doors: [doorId...] }` and the rect is the room *interior* (not the wall band).
- **Platform model** — platforms are visual ground at elevation 1 plus a perimeter wall band with gaps at each step location. `platformPerimeterRects(platform)` generates 8 thin wall segments (4 edges × 2 halves, split at the step positions declared in `platform.steps`). For an elev-0 non-climber, the perimeter rects are obstacles (block movement except through step gaps). For climbers and all elev-1 entities, perimeter rects are NOT in the obstacle list — they pass through freely. **There is no step circle** — the original radius-based model was replaced because it caused oscillation when wall push-back trapped entities inside the circle. Steps are simply gaps in the perimeter wall now (`STEP_HALF_WIDTH_PX = 24`, total gap = 48 px).
- **Elevation transitions** — `tryAutoClimb(entity, platforms)` reads the entity's movement segment and translates any inward perimeter crossing into elev 0 → 1, any outward into elev 1 → 0. The wall list itself gates *who* can cross (non-climbers blocked except at step gaps), so once an entity has crossed the perimeter the elevation toggle is unconditional.
- **`canClimb`** — class-level flag (Monk = true; Fighter/Barbarian = false) and enemy-def-level flag (Goblin = true; Dog/Skeleton = false). Read at call time from `CLASS_REGISTRY` / `enemyDefs`; **not synced**. Long-term: replace with a per-character skill/feat.
- **AI navigation** — `selectTargetPosition` in `AISystem.js` has two routing layers: (1) walled-room routing — if target is inside a room and enemy isn't (or vice versa), retarget to the nearest *unlocked* door (read live from `state.doors`); (2) elevation routing — non-climbers chasing an elevated target retarget to the nearest step on the platform containing that target. Climbers always pursue directly. Wall-sliding fallback (`applySlidingVelocity`) handles corridors and 90° turns; concave corners still trap (accepted V1).
- **High-ground combat advantage** — `resolveAttack` accepts `advantage: boolean` (rolls 2d20, keeps higher). `CombatSystem` computes it as `attacker.elevation === 1 && target.elevation === 0` at every call site. Asymmetric — no reverse disadvantage. Combat log shows `d20:N [adv: a, b]` when active.
- **Visuals** — placeholders, no tiles yet. Base ground `0x2a2a3a`, platform ground `0x3a3a4f`, step transition strips two-tone (`0x36364a` / `0x30303d`), walls `0x111118` with `0x4a4a5a` border, unlocked doors `0x4a4a5a` band, locked doors render identical to walls. Entity render depth: elev 0 = 2, elev 1 = 4 (HP bar = entity depth + 1).
- **Known V1 limitations** (see geometry-sprint-plan §"Open Questions"): no fall damage on walk-off; no door interaction UX (all doors unlocked this sprint); locked-door branch in collision/render is untested; AI gets stuck on concave corners; `isLineBlocked` is a stub; multi-level stacking (>1) out of scope; `canClimb` is a class flag, not yet a skill.

## Floor System
- Floors are declarative data in `shared/data/floors/` keyed by floor number in `FLOOR_REGISTRY`. Each floor: `{ width, height, playerSpawn, enemies[], chests[], traps[], stairs[], walls[], doors[], platforms[], rooms[] }`. Add a new floor by adding a file + registry entry — no logic changes.
- Server `_loadFloor(n)` clears the entity MapSchemas (guarded on `size > 0` to avoid an `OPERATION.CLEAR` patch poisoning the initial sync — see commit `f2a8d12`) and repopulates from the floor data; sets `state.floor = n` and updates `_bounds` for MovementSystem. Initial onCreate calls `_loadFloor(1)`.
- Stairs with `lockedUntilAllEnemiesDead: true` start `locked = true`; flip on the first tick where every enemy is dead, broadcast a "Stair to Floor N unlocked" log line. Floors with no stairs (e.g. floor 2) are exit-only via Scroll of Extraction.
- Descend (`descend { stairId }`) calls `_loadFloor(toFloor)`, teleports all players to the new spawn, and applies `_longRest`: HP → maxHp, tempHp 0, Second Wind refreshed, rage uses reset to class default, all timed conditions dropped (rage, bless, longstrider, false_life). Broadcasts a long-rest combat-log line.
- Client (`DungeonScene`) detects `state.floor` change in `state.onChange` → `_applyFloorLayout` redraws the room background and resets camera bounds. Per-entity `onRemove` handlers translate the server's CLEAR ops into per-entity gfx destroy. Floor 2 contents (1, 2, 4, 6, 8, 10 enemies per arm × 3 arms; entry chest with scroll + 10× each potion) are tuned for combat testing — not final design.

## Hub Economy & Crafting
- **Pricing source of truth**: `shared/data/values.js` exports `ITEM_GOLD_VALUE` (SRD prices for weapons/armor/potions, nominal values for materials) and `sellPrice(id)` (1/4× value, floor, min 1 gp). Both shop buy prices and stash sell prices read from this map — single source, no drift.
- **Shop**: `VENDOR_CATALOG` in `shared/data/shop.js` is keyed by vendor (`potions`, `armor`); each entry is `{ id, price }` computed from `ITEM_GOLD_VALUE`. The same file also exports `BUYABLE_PRICES` — a flat `{ itemId → price }` map derived from every vendor's entries, used server-side to gate `/buy`. Add a new buyable item by editing the id arrays in shop.js; the server picks it up automatically.
- **Crafting benches**: `BENCH_REGISTRY` in `shared/data/crafting/benches.js` defines all six benches with `status: 'open' | 'planned'`. Planned benches render a "Coming soon" placeholder. Six benches: forge, binder, artificer, apothecary, scriptorium, refinery.
- **Recipes**: `RECIPE_REGISTRY` in `shared/data/crafting/recipes.js` is keyed by recipe id. Shape: `{ id, label, bench, inputs: [{ id, qty }], output: { id, qty } }`. `recipesForBench(benchId)` filters by bench. New recipes are pure data — no logic to write.
- **Stash mutations** (`client/src/store/stash.js` → `server/routes/hub.js` → `server/store/playerStore.js`): `buyItem(id)`, `sellItem(id)`, `craftRecipe(recipeId)`, `dumpRaiderPackToStash()`. All async, return `Promise<bool>`. Client sends ids only; server resolves canonical prices from `BUYABLE_PRICES` / `sellPrice()` and recipe internals from `RECIPE_REGISTRY`. Per-player mutation lock in `playerStore` serializes concurrent same-player writes.

## Hub Settings: Debug Mode Toggle
The settings panel in `HubScene.js` (`_renderMenuBody`) shows a DEBUG MODE row with `[ ON ]` (yellow, locked) and `[ OFF ]` (dim, non-interactive). This toggle is the **routing hook** for which dungeon `[ Enter Dungeon ]` loads:
- **ON** (current behavior) → today's testing/tuning dungeon — Floor 1 + Floor 2 from `FLOOR_REGISTRY`, full loot, all classes unlocked, tuned for combat testing (not final design).
- **OFF** (future, not yet built) → intended end-user gameplay — production dungeon with matchmaking, fresh-party rooms, production loot tuning, intended difficulty curve.

The production gameplay path doesn't exist yet, which is why OFF is locked. When it lands: make `[ OFF ]` interactive, persist the toggle state (likely in `client/src/store/stash.js` so it survives reloads), and branch on it inside `_buildRaiderPanel`'s `[ Enter Dungeon ]` `pointerdown` handler before `this.scene.start('DungeonScene', ...)` — the join options or the target scene/floor differ between the two paths.

## Reference Docs (read when relevant to the task)
- docs/tech_spec.md — Full technical architecture, file structure, module details
- docs/gdd.md — Game design document, combat system, class roster, items
- docs/gdd_crafting.md — Conceptual crafting & itemization GDD (three-part item model, biomes, recipe acquisition, six benches)
- docs/loot-system-plan.md — loot tables, gold tracking, corpse looting design and build plan
- docs/floor-2-plan.md — floor system + Scroll of Extraction build plan (floor data, descend flow, long rest, debug-tuning floor 2)
- docs/geometry-sprint-plan.md — Walls, doors, platforms, steps, rooms, elevation, high-ground advantage. Two-part doc: feature description + build plan. Open-questions list captures deferred items.

## Keeping Docs Current
After completing any task, flag to the user if the changes warrant updates to CLAUDE.md or docs/tech_spec.md. Triggers include:
- Files added/removed that appear in the file structure lists
- New fields on PlayerState or other synced state
- Changes to the scene entry point or scene graph
- New message protocol entries (new messages, changed payloads)
- New patterns established (new registry, new system, new architectural convention)

Don't update the docs unprompted — flag it and let the user decide.

## Code Style
- ES modules (import/export), not CommonJS (require)
- Pure functions in shared/logic/ — no side effects, no framework deps
- Randomness injected via optional rng parameter for deterministic testing
- Named constants for ALL numeric values — no bare literals in logic files