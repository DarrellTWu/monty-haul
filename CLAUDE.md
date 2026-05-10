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
- `index.js` — entry point; creates an Express app, mounts `hubRouter` at `/hub`, wraps it in a Node `http.Server`, then passes that to Colyseus via `WebSocketTransport`. Single process serves both HTTP hub routes and WebSocket game rooms on port 2567.
- `rooms/DungeonRoom.js` — message routing + equip/loot/hotbar/trap logic; rolls loot on enemy death; handles `open_container`, `close_container`, `take_item`, `take_gold`, `drop_item`, and `descend` (loot_corpse / loot removed in favour of container protocol). Floors are loaded from `FLOOR_REGISTRY` via `_loadFloor(n)` (clears entity maps + repopulates from floor data); player position + long rest applied on descend. Run completes only via Scroll of Extraction (`extract` consumable type) — no auto-complete on enemies-dead. `onJoin` loads raider pack from `playerStore` using `options.playerId`; tracks `_playerIds` (sessionId → playerId), `_extracted` (Set of sessionIds that used a scroll), `_runStartedAt` (sessionId → ms timestamp at join, for `run_history.run_duration_s`), and `_maxFloor` (sessionId → highest floor reached, bumped on `descend` for every active session). `_buildRunMeta(sessionId, player)` returns `{ classId, floorsReached, kills: 0, runDurationS }` consumed by both `commitExtract` (after scroll consumption) and `commitDeath` (in `onLeave` for any player not in `_extracted`). Kills tracking is deferred — always 0.
- `systems/` — CombatSystem.js, MovementSystem.js, AISystem.js (called from tick loop)
- `state/` — PlayerState, EnemyState (incl. `lockedBy`), GameState (incl. `floor`, `stairs` map), ChestState (incl. `lockedBy`), TrapState, StairState
- `store/playerStore.js` — async write-through cache backed by Supabase (Phase 2). In-memory `Map<playerId, state>` is the fast path; on miss, `loadPlayer`/`loadPlayerByUsername` populate from `gear_stash` + `meta_progression`. Every mutation modifies the cached state then `await`s `syncStashAndMeta` to persist. ALL exports are async: `getOrCreate(username)`, `getPlayer(playerId)`, `savePlayer(state)`, hub mutations (`stashToRaider`, `raiderToStash`, `dumpToStash`, `buyItem`, `sellItem`, `craftRecipe`), and dungeon hooks (`commitExtract`, `commitDeath`). All mutations return `{ ok, stash, gold, raiderPack }`. New players (no DB row) get `INITIAL_STASH` seeded via `createProfile` on first `getOrCreate`. **Per-player mutation lock** (`_withLock`) serializes concurrent mutations for the same `playerId` so `syncStashAndMeta`'s DELETE+INSERT can't interleave; other players still mutate in parallel. **Server-authoritative pricing**: `buyItem(playerId, itemId)` reads `BUYABLE_PRICES` from `shared/data/shop.js`; `sellItem(playerId, itemId)` reads `sellPrice()`; `craftRecipe(playerId, recipeId)` reads `RECIPE_REGISTRY`. Client-supplied prices and recipe internals are no longer accepted. **Run history**: `commitExtract` and `commitDeath` accept `{ classId, floorsReached, kills, runDurationS }` and call `insertRunHistory` inside the same per-player lock; insert failure is logged but never invalidates the stash mutation. If `classId` is absent (legacy callers / tests) the row insert is skipped.
- `routes/hub.js` — Express router mounted at `/hub`. CORS-enabled for Vite dev. 8 routes: `POST /login`, `GET /:playerId`, `POST /:playerId/raider/add|remove|dump`, `POST /:playerId/buy|sell|craft`. Each route is wrapped in an `asyncRoute` helper that catches throws (e.g. Supabase outage) and returns 500. All delegate to `playerStore` and return updated state slices. `/buy` and `/sell` accept `{ itemId }` only; `/craft` accepts `{ recipeId }` only — pricing and recipe data are resolved server-side.
- `persistence/` — Supabase plumbing for Phase 2 server persistence:
  - `supabase.js` — singleton client init from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (throws if either missing). Uses the secret API key — bypasses RLS, server-only.
  - `playerLoad.js` — read-side: `loadPlayer(playerId)`, `loadPlayerByUsername(username)`. Aggregates `gear_stash` rows by `item_id`. Returns null for unknown ids.
  - `playerSync.js` — write-side: `createProfile(username, initialStash)` (inserts profile + seeds gear_stash + creates meta_progression row); `syncStashAndMeta(player)` (snapshot-replaces gear_stash, upserts meta_progression by PK).
  - `runCommit.js` — `insertRunHistory({ playerId, classId, floorsReached, extracted, goldExtracted, itemsExtracted, kills, runDurationS })` writes one row to `run_history`. Called by `playerStore.commitExtract` / `commitDeath`. Throws on Supabase error; the caller wraps in try/catch so a telemetry failure never invalidates the preceding stash mutation.
- `matchmaking/` — not yet built

**Client** (no `rendering/` or `ui/` subdirectories)
- `scenes/HubScene.js` — entry point (auto-starts); checks localStorage for `mh_player_id` — shows username login screen if absent, otherwise loads state from server via `HubAPI.getState`. Two-panel layout: left cycles sub-screens (Class, Stash, Shop, Craft), right is persistent Raider Config + Enter Dungeon; screen-level VAULT display (top-right) shows hub gold; passes `{ class, abilityScores }` to DungeonScene (no items — server loads raider pack on join); auto-opens Stash tab when `init({ view: 'stash' })`. Sub-state: `_shopVendor` (`'potions' | 'armor'`), `_craftBench` (one of the six BENCH_REGISTRY ids), `_abilityScores` (point-buy allocation, initialized from class defaults on class select). Class sub-screen includes ability score customization panel (27-pt point buy, scores 8–16, non-linear cost via `POINT_COST`). Stash rows expose `[ Sell N gp ]`; raider panel shows `[ Dump All to Stash ]` when pack non-empty. All mutation call sites use `.then(ok => { if (ok) handler(); })` pattern.
- `scenes/DungeonScene.js` — gameplay rendering, input wiring; receives `{ class, abilityScores }` via `init(data)` and passes `playerId` (from `stash.getPlayerId()`) to the server on join — server loads the raider pack; detects run complete/death, shows run summary overlay; server commits stash + gold on extract/death — no client-side stash mutations on run end; F-key triggers `_tryInteractNearby` which dispatches to chest, corpse, or unlocked stair; lootable corpses render dim gold with an "F: Loot" hint; stairs render as a brown box (orange when unlocked) with "F: Descend"; room dimensions + camera bounds redraw on `state.floor` change; per-entity `onRemove` handlers tear down old-floor gfx when the server clears MapSchemas during descend.
- `scenes/HUDScene.js` — conditions, cooldown rings, hotbar overlay
- `scenes/InventoryScene.js` — equipment slots, bag, hotbar assignment UI; shows live `GOLD N gp` line under HP/AC; renders materials (skeleton_bone, wolf_pelt) in the bag. Bag groups duplicate items into a single row with `× N` qty (display-only — server inventory stays flat); fixed-height scrollable viewport clipped by a shared `GeometryMask`, reachable via mouse wheel; mask cleared on drag-start, restored on drag-end. Double-click routes by item type: weapons/armor → `sendEquip`, consumables → `sendAssignHotbar` to first free slot, materials → no-op. **Loot mode**: launched by DungeonScene with `{ lootSource: { kind, id } }`; replaces the left character-sheet column with a loot panel showing container gold and items; `[→ Drop]` buttons push bag items into the container; `sendOpenContainer` on create, `sendCloseContainer` on shutdown. `_lootHandshakeSeen` prevents premature auto-close before the server confirms the lock.
- `network/ColyseusClient.js` — `joinDungeon(opts)` forwards opts (incl. `class`, `playerId`, `abilityScores`) to server; loot container protocol: `sendOpenContainer`, `sendCloseContainer`, `sendTakeItem`, `sendTakeGold`, `sendDropItem`; `sendDescend` (stairs)
- `network/HubAPI.js` — thin async fetch wrapper for the `/hub` HTTP routes. Derives base URL from `VITE_COLYSEUS_URL` (replaces `ws` → `http`). Exports: `login(username)`, `getState(playerId)`, `addToRaider`, `removeFromRaider`, `dumpToStash`, `buy`, `sell`, `craft`. Used exclusively by `store/stash.js`.
- `input/InputHandler.js`
- `store/stash.js` — server-backed item store. `localStorage` used only to persist `mh_player_id` across sessions. In-memory cache (`_cache = { stash, gold, raiderPack }`) populated by `initFromServer(playerId, state)` on login/load — server wins. Sync reads: `getStash`, `getRaiderPack`, `getRaiderPackFlat`, `getHubGold`, `getPlayerId`. Async mutations (call `HubAPI`, update cache, return `Promise<bool>`): `stashToRaider`, `raiderToStash`, `dumpRaiderPackToStash`, `buyItem`, `sellItem`, `craftRecipe`. ALL hub-side state mutations route through this file — single migration point for Phase 2.

**Shared**
- `data/` — constants.js, values.js (ITEM_GOLD_VALUE + sellPrice), shop.js (VENDOR_CATALOG), weapons/melee.js, armor/armor.js, items/(consumables+shields+materials), enemies/tier1.js, classes/fighter.js, classes/barbarian.js, classes/monk.js, classes/index.js (CLASS_REGISTRY), loot/tier1.js (LOOT_TABLE_REGISTRY), crafting/benches.js (BENCH_REGISTRY), crafting/recipes.js (RECIPE_REGISTRY + recipesForBench), floors/floor1.js + floor2.js + index.js (FLOOR_REGISTRY)
- `logic/combat.js` — full attack resolution
- `logic/loot.js` — pure `rollLoot(table, rng?)` returning `{ gold, items }`; supports literal item ids and `@pool` references. The `@potion_any` pool filters out consumables with `type === 'extract'` (Scroll of Extraction is run-control, not loot).
- `logic/loot-window.js` — pure container-lock protocol: `tryOpenContainer`, `tryCloseContainer`, `releaseLocksHeldBy`, `tickContainerLocks`, `tryTakeItem`, `tryTakeGold`, `tryDropItem`, `checkLootAccess`, `refreshSourceFlags`. Imported by both DungeonRoom and server tests. No framework deps.
- `tests/combat.test.js`, `tests/loot.test.js`
- `types/` — player.js, enemy.js, weapon.js

**Server tests** (in `server/tests/`, run with `node server/tests/<file>`)
- `server/tests/container-lock.test.js` — 21 tests for `tryOpenContainer`, `tryCloseContainer`, `releaseLocksHeldBy`, `tickContainerLocks`
- `server/tests/loot-flow.test.js` — 35 tests for `tryTakeItem`, `tryTakeGold`, `tryDropItem`, hotbar-cleanup, and lock gate enforcement
- `server/tests/supabase-smoke.js` — 25 tests against the real dev Supabase project: createProfile, syncStashAndMeta (add/modify/remove/empty), loaders, negative cases. Inserts a temp row keyed by username; cleans up afterward. Loads env via `process.loadEnvFile('server/.env')` so it can be invoked directly without npm scripts.
- `server/tests/concurrency-smoke.js` — 7 tests; fires N concurrent `buyItem` calls against one player and asserts the per-player mutation lock prevents duplicate `gear_stash` rows.
- `server/tests/anti-cheat-smoke.js` — 25 tests; covers `/buy` `/sell` `/craft` rejection paths (unknown id, material id buy, unknown recipe id) and asserts gold + stash are unchanged after rejection.
- `server/tests/run-history-smoke.js` — 19 tests; drives `commitExtract` and `commitDeath` end-to-end, asserts each writes one correctly-shaped row to `run_history`. Verifies the legacy no-metadata `commitDeath` call is a no-op for run_history.
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
- `server/state/EnemyState.js` — synced enemy schema. Loot fields:
  - `lootGold, lootItems, looted` — populated on first tick after death from `LOOT_TABLE_REGISTRY[type]` via `rollLoot`; `looted` is true when gold===0 and lootItems is empty (bidirectional — can flip back if items are dropped in)
  - `lockedBy` — sessionId of the player currently holding the loot-window lock ('' = free); cleared automatically by `tickContainerLocks` when player goes out of range/dies or by `releaseLocksHeldBy` on disconnect
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

## Floor System
- Floors are declarative data in `shared/data/floors/` keyed by floor number in `FLOOR_REGISTRY`. Each floor: `{ width, height, playerSpawn, enemies[], chests[], traps[], stairs[] }`. Add a new floor by adding a file + registry entry — no logic changes.
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

## Reference Docs (read when relevant to the task)
- docs/tech_spec.md — Full technical architecture, file structure, module details
- docs/gdd.md — Game design document, combat system, class roster, items
- docs/gdd_crafting.md — Conceptual crafting & itemization GDD (three-part item model, biomes, recipe acquisition, six benches)
- docs/loot-system-plan.md — loot tables, gold tracking, corpse looting design and build plan
- docs/floor-2-plan.md — floor system + Scroll of Extraction build plan (floor data, descend flow, long rest, debug-tuning floor 2)

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