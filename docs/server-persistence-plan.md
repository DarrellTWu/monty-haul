# Server-Side Persistence Plan
*Internal Reference | Two-Phase Implementation*

> **Status:**
> - **Phase 1** complete and fully tested (2026-04-28). All 5 checkpoints verified.
> - **Phase 2** core implemented and verified (2026-05-09). Checkpoints 6 (schema) and 7
>   (state persists across server restart) green. Hub mutations + dungeon extract/death
>   write through to `gear_stash` + `meta_progression` via async `playerStore` cache.
>   Storage model: current-state (one row per `(player_id, item_id)`), snapshot-replace
>   on sync — see "Storage Model" block below.
> - **Phase 2 audit (2026-05-09):** post-implementation review surfaced a critical
>   race condition (#1) and pre-existing anti-cheat hole (#2) plus several robustness
>   and scalability gaps. See "Phase 2 — Post-Implementation Audit" section below.
>   These are addressed in Phase 3.
> - **Phase 3 #1 done (2026-05-09, commit `7888654`):** per-player mutation lock
>   added to `playerStore.js`. 20 concurrent buys now produce 1 `gear_stash` row
>   with correct qty (verified by `server/tests/concurrency-smoke.js`).
> - **Phase 3 #2 done (2026-05-09):** server-authoritative prices and recipes.
>   `/buy` `/sell` accept `{ itemId }` only; `/craft` accepts `{ recipeId }` only.
>   Server resolves canonical values from `BUYABLE_PRICES`, `sellPrice()`, and
>   `RECIPE_REGISTRY`. Verified by `server/tests/anti-cheat-smoke.js` (25 tests)
>   and manual hub UI validation (buy / sell / craft / refresh).
> - **Phase 3 #3 done (2026-05-10):** `run_history` writes on extract/death.
>   Closes Checkpoints 8 and 9. New `server/persistence/runCommit.js`;
>   `playerStore.commitExtract` / `commitDeath` accept `{ classId, floorsReached,
>   kills, runDurationS }` and insert one row per run. `DungeonRoom` tracks
>   `_runStartedAt` and `_maxFloor` per session. `kills` deferred (always 0
>   for now). Verified by `server/tests/run-history-smoke.js` (19 tests).
>   Run-history insert failure is logged but never invalidates the stash mutation.
> - **Phase 3 #4 done (2026-05-10):** retry/backoff around Supabase calls.
>   New generic `server/persistence/withRetry.js` (3 attempts, 100/200/400ms
>   exponential backoff). Wraps idempotent ops only: all SELECTs in
>   `playerLoad`, plus the DELETE and the meta UPSERT in `syncStashAndMeta`.
>   The bare INSERT in `syncStashAndMeta` and `runCommit.insertRunHistory` are
>   intentionally left un-wrapped — non-idempotent without a UNIQUE constraint
>   (closed by #5). Default predicate skips errors carrying a 5-digit Postgres
>   SQLSTATE (semantic errors won't benefit from retry). Verified by
>   `server/tests/with-retry.test.js` (17 unit tests, no Supabase needed).
> - **Phase 3 #6 done (2026-05-10):** resilient extract/death commit hooks.
>   New `server/persistence/deadLetter.js` (append-only JSONL log at
>   `server/.deadletter.jsonl`, gitignored). `playerStore.commitExtract` and
>   `commitDeath` wrap `await savePlayer(p)` in try/catch — on persistence
>   failure after withRetry exhausts, the payload is appended to the dead-letter
>   log before the error propagates. `DungeonRoom` extract path broadcasts a
>   "save failed — your run was logged for recovery" combat-log line; death
>   path logs to console (player already disconnected). Server `index.js` warns
>   on startup if the dead-letter file is non-empty. Verified by
>   `server/tests/dead-letter.test.js` (18 unit tests, no Supabase needed).
> - **Phase 3 #5 done (2026-05-10):** atomic-safe sync via UPSERT + DELETE-NOT-IN.
>   New migration `supabase/migrations/002_unique_stash.sql` adds
>   `UNIQUE (player_id, item_id)` to `gear_stash`. `syncStashAndMeta` rewritten
>   to UPSERT current items, then DELETE rows whose `item_id` is no longer
>   present, then UPSERT meta. UPSERT-first ordering: a crash mid-sync leaves
>   leftover ghost rows (visible to the player) but never wipes items the
>   player still owns. All three ops idempotent and wrapped in `withRetry` —
>   the gap left open by #4 (the bare INSERT) is closed. Also addresses audit
>   issue #8 (snapshot-replace row-op waste). Verified by 9 new convergence
>   assertions in `supabase-smoke.js` (34 tests total) plus the existing
>   concurrency-smoke and run-history smokes. Foundation for future
>   multi-process operation (audit issue #6); per-player lock from #1 still
>   provides in-process serialization.
> - **Phase 3 fully complete.** All 6 hardening items shipped.
>
> ### Known limitation — late-join depth recording
> The single-room model lets a second crawler join while a first is already
> mid-run; the joiner spawns on whatever floor the room is currently on, and
> their `run_history.floors_reached` is recorded as that floor (not 1). The
> persistence layer is correct — `_maxFloor` is set at `onJoin` to
> `state.floor` and bumped on descend, so the value honestly reflects "deepest
> floor this session touched." But if you later read `run_history` as "depth
> descended through this run," late-joiners' rows will look like they got
> further than they did.
>
> No action now. The condition disappears once matchmaking lands and rooms are
> fresh-per-party (every join starts on floor 1). Until then, treat this as a
> known data-quality nuance for analytics, not a bug. Revisit when designing
> the matchmaking layer in `server/matchmaking/`.
> - **Pending manual validation:** Checkpoint 10 (multi-client isolation across two
>   browser sessions / two usernames).

---

## Goal

Move the source of truth for all player inventory, stash, gold, and run history from
`localStorage` (client-side, ephemeral) to the Colyseus server, then persist that server
state to Supabase. Phase 1 is fully testable on the local machine with no external services.
Phase 2 layers Supabase behind the same interface.

---

## Phase 1 — Server-Side In-Memory State

No database. Server holds player state in a `Map`. All hub mutations go through an HTTP API
on the Colyseus server. Dungeon extract and death update the same store. On server restart,
state resets — that's acceptable for local testing.

### Data Shape

All player state in `playerStore` follows this shape:

```js
{
  playerId: string,       // UUID, generated on first login
  username: string,
  stash: [{ id, qty }],   // same shape as current stash.js
  gold: number,
  raiderPack: [{ id, qty }],
}
```

`stash` and `raiderPack` mirror the current `stash.js` entry shapes exactly so the hub
display layer requires minimal changes.

### Files to Create

**`server/store/playerStore.js`**
In-memory `Map<playerId, playerState>`. Exports:
- `getOrCreate(playerId, username)` → player state
- `getPlayer(playerId)` → player state or null
- `savePlayer(state)` → void (no-op in Phase 1; real write in Phase 2)
- `stashToRaider(playerId, itemId)` → `{ ok, state }`
- `raiderToStash(playerId, itemId)` → `{ ok, state }`
- `dumpToStash(playerId)` → `{ ok, state }`
- `buyItem(playerId, itemId, price)` → `{ ok, state }`
- `sellItem(playerId, itemId, price)` → `{ ok, state }`
- `craftRecipe(playerId, recipe)` → `{ ok, state }`
- `commitExtract(playerId, { survivingItems, goldEarned })` → updated state
- `commitDeath(playerId)` → updated state (raider pack cleared, stash unchanged)

All mutations are atomic and return the updated state so callers don't need a second read.

**`server/routes/hub.js`**
Express router mounted at `/hub`. All routes accept/return JSON.

| Method | Path | Body | Returns | Action |
|--------|------|------|---------|--------|
| `POST` | `/hub/login` | `{ username }` | `{ playerId, stash, gold, raiderPack }` | Upsert player by username |
| `GET` | `/hub/:playerId` | — | `{ stash, gold, raiderPack }` | Load hub state |
| `POST` | `/hub/:playerId/raider/add` | `{ itemId }` | `{ stash, gold, raiderPack }` | stashToRaider |
| `POST` | `/hub/:playerId/raider/remove` | `{ itemId }` | `{ stash, gold, raiderPack }` | raiderToStash |
| `POST` | `/hub/:playerId/raider/dump` | — | `{ stash, gold, raiderPack }` | dumpRaiderPackToStash |
| `POST` | `/hub/:playerId/buy` | `{ itemId, price }` | `{ ok, stash, gold }` | buyItem |
| `POST` | `/hub/:playerId/sell` | `{ itemId, price }` | `{ ok, stash, gold }` | sellItem |
| `POST` | `/hub/:playerId/craft` | `{ recipe }` | `{ ok, stash }` | craftRecipe |

**`client/src/network/HubAPI.js`**
Thin fetch wrapper around the hub routes. All functions are async and return the updated
player state slice. Used by `stash.js` as the transport layer.

```js
export const HubAPI = {
  login(username),                    // → { playerId, stash, gold, raiderPack }
  getState(playerId),                 // → { stash, gold, raiderPack }
  addToRaider(playerId, itemId),      // → { stash, gold, raiderPack }
  removeFromRaider(playerId, itemId), // → { stash, gold, raiderPack }
  dumpToStash(playerId),              // → { stash, gold, raiderPack }
  buy(playerId, itemId, price),       // → { ok, stash, gold }
  sell(playerId, itemId, price),      // → { ok, stash, gold }
  craft(playerId, recipe),            // → { ok, stash }
}
```

### Files to Modify

**`server/index.js`**
Mount the hub Express router on the Colyseus server's built-in Express instance.

**`client/src/store/stash.js`**
Rewrite internals to call `HubAPI` instead of `localStorage`. Public API stays the same
but all functions become async. `playerId` is read from `localStorage` (sole remaining use
of localStorage in this file). The INITIAL_STASH seed moves to `playerStore.getOrCreate`
on the server — first-time players get a seeded stash.

**`client/src/scenes/HubScene.js`**
- Add username login screen: shown if no `mh_player_id` in localStorage, blocks hub render.
- `await` all stash calls (they are now async).
- On login success: store `playerId` in localStorage, load hub state, proceed to hub.

**`client/src/network/ColyseusClient.js`**
`joinDungeon(opts)` stops passing `items` array. Passes `{ class, playerId, abilityScores }`
only. Server fetches the raider pack from `playerStore` using `playerId`.

**`server/rooms/DungeonRoom.js`**
- `onJoin`: read `playerId` from `options`; load raider pack from `playerStore`; equip/seed
  inventory from that data (replaces the client-passed items logic).
- On extract (when `extract` consumable fires `state.phase = 'complete'`): call
  `playerStore.commitExtract(playerId, { survivingItems: player.inventory, goldEarned: player.gold })`.
- `onLeave`: if player is alive and run is not complete, call `playerStore.commitDeath(playerId)`.
  Tracks `runStartTime` per player (set in `onJoin`) for run duration.

**`client/src/scenes/DungeonScene.js`**
Remove `setRaiderPack` and `addHubGold` calls on extract. Server now owns those writes.
DungeonScene just navigates back to hub on run end; hub re-fetches fresh state from server.

### Test Checkpoints

**Checkpoint 1 — Hub routes respond correctly**
Start the server. Use curl or a browser to verify:
```
POST /hub/login { "username": "test" }     → returns playerId + seeded stash
GET  /hub/:playerId                         → same stash/gold/raiderPack
POST /hub/:playerId/buy { ... }             → gold decrements, item appears in stash
POST /hub/:playerId/sell { ... }            → item gone, gold increments
POST /hub/:playerId/raider/add { ... }      → item moves stash → raiderPack
POST /hub/:playerId/craft { ... }           → inputs consumed, output added
```
Server restart resets state — that's expected at this phase.

**Checkpoint 2 — Hub UI works end-to-end**
Open the browser. Enter a username. Verify:
- Hub renders with server-seeded stash (not localStorage data)
- Buy a potion → gold updates
- Move item to raider pack → raider pack updates
- Sell an item → gold updates, item removed
- Craft a recipe → inputs consumed, output appears
- Refresh the page → state reloads from server (not localStorage)

**Checkpoint 3 — Dungeon join uses server state**
From hub, load a raider pack and enter the dungeon. Verify:
- Player spawns with the correct items (loaded from server, not passed by client)
- Ability scores and class are correct

**Checkpoint 4 — Extract commits correctly**
Complete a run via Scroll of Extraction. Return to hub. Verify:
- Surviving inventory items appear in stash
- Gold earned during run added to hub gold
- Raider pack is now empty (items moved to stash)

**Checkpoint 5 — Death commits correctly**
Die in the dungeon (or disconnect mid-run). Return to hub. Verify:
- Stash is unchanged (items brought in are lost)
- Hub gold unchanged (run gold not transferred)
- Raider pack is empty

---

## Phase 2 — Supabase Persistence

Swap `playerStore`'s in-memory `Map` for Supabase reads/writes. No client-side changes.
The HTTP routes and `HubAPI.js` are untouched — only the storage backend changes.

### Storage Model: Current-State (decided 2026-05-09)

`gear_stash` is treated as **current state**, not an event log: one logical row per
`(player_id, item_id)`. Every hub mutation snapshot-replaces the player's stash rows
(simple, robust at dev scale; optimize to upsert+targeted-delete later if row counts grow).
The `acquired_via` / `acquired_at` columns become "last sync" metadata in this mode and
are not relied on for provenance.

This was a deliberate pick over an audit-trail interpretation of `gear_stash` because
it mirrors the in-memory `playerStore` shape 1:1 — Phase 2 stays a pure storage swap
with zero behavior change. See "Future Work — gear_events" below for the planned
provenance/analytics path.

### Supabase Setup

Create a free-tier Supabase project (dev). Create a second project for production when ready.
Apply the migration file below via `supabase db push` or the Supabase dashboard SQL editor.
Environment variables added to `server/.env` and `client/.env.development`.

### Schema (`supabase/migrations/001_initial_schema.sql`)

```sql
-- Player identity (no auth.users dependency yet — username-only for now)
CREATE TABLE player_profiles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username     TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Persistent stash (items that survive in the hub)
CREATE TABLE gear_stash (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    UUID NOT NULL REFERENCES player_profiles,
  item_id      TEXT NOT NULL,
  quantity     INT  NOT NULL DEFAULT 1,
  acquired_via TEXT NOT NULL DEFAULT 'extract', -- 'extract' | 'buy' | 'craft' | 'sell_refund'
  acquired_at  TIMESTAMPTZ DEFAULT now()
);

-- Hub gold and raider pack (items staged for next run)
CREATE TABLE meta_progression (
  player_id    UUID PRIMARY KEY REFERENCES player_profiles,
  gold         INT  NOT NULL DEFAULT 0,
  raider_pack  JSONB NOT NULL DEFAULT '[]', -- [{ id, qty }]
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- One row per completed or abandoned run
CREATE TABLE run_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID NOT NULL REFERENCES player_profiles,
  class           TEXT NOT NULL,
  floors_reached  INT  NOT NULL DEFAULT 1,
  extracted       BOOLEAN NOT NULL DEFAULT false,
  gold_extracted  INT  NOT NULL DEFAULT 0,
  items_extracted JSONB NOT NULL DEFAULT '[]', -- [{ id, qty }]
  kills           INT  NOT NULL DEFAULT 0,
  run_duration_s  INT,
  completed_at    TIMESTAMPTZ DEFAULT now()
);
```

### Files to Create

**`server/persistence/supabase.js`**
Server-side Supabase client initialised with the service role key (bypasses RLS).

**`server/persistence/playerLoad.js`**
`loadPlayer(playerId)` — reads `gear_stash` + `meta_progression` from Supabase,
returns the same `{ stash, gold, raiderPack }` shape `playerStore` already uses.

**`server/persistence/runCommit.js`**
- `commitExtract(playerId, { survivingItems, goldEarned, classId, floorsReached, kills, runDurationS })`
  Writes to `gear_stash` (items), updates `meta_progression` (gold), inserts into `run_history`.
- `commitDeath(playerId, { classId, floorsReached, kills, runDurationS })`
  Inserts into `run_history` only (extracted: false).

### Files to Modify

**`server/store/playerStore.js`**
- `getOrCreate`: call `playerLoad.loadPlayer` on cache miss; fall back to seeded defaults
  for brand-new players.
- `savePlayer`: call `runCommit` or direct Supabase writes depending on mutation type.

The `playerStore` Map becomes a request-scoped cache: load from Supabase if not cached,
write through to Supabase on every mutation.

### Test Checkpoints

**Checkpoint 6 — Schema is applied**
Run migration. Confirm tables exist in Supabase dashboard or via psql.

**Checkpoint 7 — State persists across server restarts**
Log in, buy a potion, restart the server, log in again → stash is unchanged.

**Checkpoint 8 — Extract writes to Supabase**
Complete a run. Check `gear_stash`, `meta_progression`, and `run_history` rows in Supabase.

**Checkpoint 9 — Death writes run_history only**
Die in the dungeon. Check `run_history` row (extracted: false). Confirm `gear_stash` and
`meta_progression` are unchanged (items lost, stash untouched).

**Checkpoint 10 — Full loop across clients**
Two different browser sessions, two usernames. Run independently. Confirm state is isolated
per player and persists correctly for both.

---

## Phase 2 — Post-Implementation Audit (2026-05-09)

After Phase 2 shipped (Checkpoints 6–7 verified), an architectural review surfaced
bugs and scalability concerns that affect production-readiness. Tracked here;
addressed in Phase 3 below.

### Critical Issues

#### 1. Race condition in `syncStashAndMeta` — duplicate rows on concurrent same-player mutations
**Severity:** HIGH (correctness; reproducible at single-user scale)

`syncStashAndMeta` does three sequential network ops: DELETE-all, INSERT-all,
UPSERT meta. Concurrent mutations for the same player interleave at `await`
boundaries, producing duplicate rows in `gear_stash`. Aggregation on read sums
quantities → player ends up with multiplied stash.

Reproduction: rapid double-click of Buy in the hub UI. Bad interleaving:

| Time | Handler A (Buy)       | Handler B (Buy)       | DB state               |
|------|-----------------------|-----------------------|------------------------|
| t=0  | mutate cache, DELETE  |                       | —                      |
| t=1  |                       | mutate cache, DELETE  | —                      |
| t=10 | DELETE returns, INSERT|                       | [potion×2]             |
| t=11 |                       | DELETE returns (no-op)| [potion×2] still       |
| t=12 |                       | INSERT                | **[potion×2, potion×2]** |

There is no `UNIQUE(player_id, item_id)` constraint to prevent duplicates.

**Fix plan:** per-player mutation lock (`Map<playerId, Promise>`) in
`playerStore.js`. Mutations chain via `prev.then(() => fn())`. Serializes one
player's writes; doesn't slow other players. ~15 lines, no schema change. Add a
test: fire N concurrent buys against one player, assert final qty == N.

(Optional follow-up: add `UNIQUE(player_id, item_id)` + switch to UPSERT pattern
as belt-and-suspenders.)

#### 2. Server trusts client-supplied prices and recipes
**Severity:** HIGH (anti-cheat; predates Phase 2)

`hub.js` `/buy`, `/sell`, `/craft` routes accept `price` and full `recipe`
objects from the client and pass them straight to `playerStore`. A malicious
client can:
- Send `price: 0` to buy items free
- Send a huge `price` on sell to mint gold
- Send a fake recipe with no inputs to materialize items

Violates the `CLAUDE.md` rule "Server never trusts client. Clients send inputs
only; server resolves outcomes."

**Fix plan (2026-05-09):**

*Architecture:* lookups live in `playerStore`, not the route. Routes are
thin pass-throughs; the store owns the rules. One file changes if pricing
rules ever evolve (per-vendor pricing, dynamic pricing, sales).

*Three gates, three registries:*
- **Buy gate** = `VENDOR_CATALOG`, not `ITEM_GOLD_VALUE`. The latter
  includes materials like `wolf_pelt` that are sellable but not buyable.
  Add `BUYABLE_PRICES = { itemId → price }` to `shared/data/shop.js`,
  derived once from `VENDOR_CATALOG` at module load.
- **Sell gate** = `sellPrice(itemId)`. Returns 0 for unknown ids → reject.
- **Craft gate** = `RECIPE_REGISTRY[recipeId]`. Reject if absent.

*API surface change:* routes accept `{ itemId }` (buy/sell) or
`{ recipeId }` (craft). The `price` and `recipe` payload fields are
removed entirely — leaving them as accepted-but-ignored would just
confuse the next reader. `playerStore` mutations drop their `price` /
`recipe-object` parameters in lockstep.

*Designer workflow stays the same:* adding a new buyable item still
means editing `ITEM_GOLD_VALUE` + `VENDOR_CATALOG` (or `RECIPE_REGISTRY`
for recipes). Server picks up new entries automatically — no separate
allowlist to maintain.

*Test plan:* `server/tests/anti-cheat-smoke.js` covers exploit attempts
(unknown item id, material id buy, unknown recipe id) and asserts gold +
stash are unchanged after rejection. Existing `concurrency-smoke.js`
updated for the new signature.

### Robustness Issues

#### 3. Non-atomic DELETE + INSERT can wipe player on crash
**Severity:** MEDIUM

`syncStashAndMeta` deletes then inserts in two separate calls. Server crash
between them = wiped `gear_stash`. Cache holds the right state, so a successful
next mutation re-syncs — but a crash that takes the process down loses the
player's stash entirely.

**Fix plan:** wrap both ops in a Supabase RPC function (PL/pgSQL) that runs them
in a SQL transaction. Or switch to UPSERT + DELETE-NOT-IN (idempotent, no
transaction needed).

#### 4. Fire-and-forget commits silently drop on Supabase failure
**Severity:** MEDIUM

`commitExtract` and `commitDeath` in `DungeonRoom.js` use `.catch(err => console.error(...))`.
A transient Supabase outage at the moment of extraction means the player's
surviving inventory and run gold are silently lost. Player sees "extract complete"
UI; nothing lands in stash.

**Fix plan:** retry with exponential backoff (3 attempts). If all fail, write to
a local dead-letter file or in-memory queue for manual recovery. Optionally
surface a "save failed" message to the client.

#### 5. No retry/backoff anywhere
**Severity:** MEDIUM

A single transient network blip during any sync = lost mutation, surfaced as a
500 to the client. Cache is then ahead of DB until next successful mutation.

**Fix plan:** thin retry wrapper (3 attempts, 100ms exponential) around
`supabase.from(...)` calls. Idempotent ops (UPSERT, DELETE) are safe to retry.
INSERT-after-DELETE is not; addressed by #3 fix.

### Scalability Issues

#### 6. Single-process cache lock-in
**Severity:** ARCHITECTURE (not blocking until horizontal scaling needed)

`_players` is a per-process `Map`. Two Node processes serving the same players
would diverge — process A mutates cache + DB; process B's cache is stale. Locks
the deployment to a single Node box.

**Fix paths (when needed), ranked by complexity:**
- (a) Drop the cache, read Supabase on every request (slow, simple, correct)
- (b) Redis as shared cache layer (fast, correct, adds infra dep)
- (c) Shard players by `playerId` hash across N processes (fast, correct, complex routing)

A single Node process comfortably handles thousands of concurrent users for a
game like this. Real ceiling, not an immediate one.

#### 7. Cache grows unbounded
**Severity:** LOW

`_players` Map never evicts. Every player who ever logged in stays in memory
until process restart. Fine for hundreds of players; meaningful at tens of
thousands.

**Fix path (when needed):** LRU cache with size limit, or TTL-based eviction
(drop entries idle for >1 hour).

#### 8. Snapshot-replace is row-op-wasteful at scale
**Severity:** LOW

A player with 200 stash items costs ~400 row ops per mutation (DELETE-all +
INSERT-all). Suboptimal but Supabase handles it fine at our scale.

**Fix path (when needed):** UPSERT individual changed rows; targeted DELETE for
removed items. Requires `UNIQUE(player_id, item_id)`.

### Pre-existing Items (out of scope for hardening)

- Username login is trust-on-first-use (anyone with a username can become that
  player). Auth is in Migration Notes as future work.
- RLS enabled but no policies exist. Service role bypasses RLS entirely. No bug
  today; matters when client-side anon access is added.

---

## Phase 3 — Hardening Plan

Items 1–2 done; #3–#6 pending. Severity is the original ordering signal;
the analysis below re-prioritizes by *what each item unlocks downstream*
(see "Suggested re-ordering" at the end of this section).

| Order | Item                                                       | Severity | Effort   | Status            |
|-------|------------------------------------------------------------|----------|----------|-------------------|
| 1     | Per-player mutation lock (#1)                              | HIGH     | half day | DONE `7888654`    |
| 2     | Server-authoritative prices and recipes (#2)               | HIGH     | half day | DONE `ee1dd52`    |
| 3     | `run_history` writes — formally close Checkpoints 8/9      | LOW      | half day | DONE 2026-05-10   |
| 4     | Retry/backoff around Supabase calls (#5)                   | MEDIUM   | half day | DONE 2026-05-10   |
| 5     | Atomic transaction for sync (#3)                           | MEDIUM   | 1 day    | DONE 2026-05-10   |
| 6     | Resilient commit hooks for extract/death (#4)              | MEDIUM   | half day | DONE 2026-05-10   |

### Item-by-item analysis (#3–#6)

#### #3 — `run_history` writes
**What it does.** On every extract / death, insert one row into the existing
`run_history` table with `class`, `floors_reached`, `extracted` (bool),
`gold_extracted`, `items_extracted` (JSONB), `kills`, `run_duration_s`. Schema
already exists; just no writer. Need a per-player `kills` counter in
`DungeonRoom` and to populate `items_extracted` from `player.inventory` at
extract.

**Unlocks:**
- **Design (high value).** Only item in the list that creates a data feedback
  loop. Without it, balance discussions are anecdotal. With it: "Floor 2 has a
  78% death rate at avg 3:40 vs Floor 1's 12%." Every itemization / monster /
  map decision benefits.
- Future leaderboards, player-profile UI, activity feeds.
- Forensics for "I lost my longsword" complaints.

**Multi-crawler relevance:** independent. One row per player per run regardless
of party size.

#### #4 — Retry/backoff around Supabase calls
**What it does.** Wrap `supabase.from(...)` calls in a small `withRetry` HOF —
3 attempts, exponential backoff (100ms / 200ms / 400ms). Idempotent ops
(UPSERT, DELETE) safe; non-idempotent INSERT-after-DELETE handled by #5.

**Unlocks:**
- Removes "single transient blip = lost mutation, 500 to client" failure mode.
- The retry primitive is reused by #6.

**Multi-crawler relevance:** growing. More concurrent users → more parallel
Supabase calls → higher base rate of any one blipping. Cheap insurance before
scale.

**Design relevance:** keeps playtest sessions running smoothly through flakes.

#### #5 — Atomic transaction for sync
**What it does.** `syncStashAndMeta` does DELETE-all then INSERT-all in two
separate calls. Server crash between them wipes `gear_stash`. Two fix paths:
- (a) Postgres RPC that runs both inside a SQL transaction.
- (b) Add `UNIQUE(player_id, item_id)` and switch to UPSERT changed rows +
  DELETE-NOT-IN. **Recommended** — also fixes audit issue #8 (snapshot-replace
  row-op waste at scale) and unlocks safe multi-process operation.

**Unlocks:**
- **Crash-safety.** Required before any production deployment that isn't a dev
  box.
- **Multi-process server.** This is the gating item for horizontal scaling
  (audit issue #6). Within a single process, the #1 mutation lock protects
  ordering; across processes, atomic sync is the only thing that protects
  against concurrent UPSERT pairs corrupting rows. Without #5, multi-process
  is unsafe.

**Multi-crawler relevance:** **prerequisite** for any multi-process scaling.
The single highest-leverage infra item in Phase 3.

**Design relevance:** indirect — designers don't lose work to crashes.

#### #6 — Resilient commit hooks for extract/death
**What it does.** Replaces the `.catch(err => console.error(...))`
fire-and-forget on `commitExtract` / `commitDeath` with: retry via #4's helper;
if all retries fail, write to a local dead-letter file (or in-memory queue) for
manual recovery; optionally surface "save failed" to the client.

**Unlocks:**
- **Highest player-perceived stakes of any audit item.** Extraction is the
  payoff moment of a long run; silently losing surviving inventory there is the
  worst-feeling failure mode the game can produce.

**Multi-crawler relevance:** matters more with concurrent extracts hitting a
momentarily-slow Supabase.

**Design relevance:** required for trusted playtests. The first time Supabase
hiccups during a playtester's first extract, you lose them.

### Dependency mapping — what gates the bigger arcs

The Phase 3 items aren't equally important to the two arcs the project cares
about most. Sorting them by what each one unlocks:

#### Infrastructure arc → multi-crawler-per-dungeon

The architecture is already "single Colyseus room, N players in it" — schema
and `_playerIds` map don't care about player count. The actual blockers to
shipping shared-room multiplayer:

| Blocker                                          | Phase 3 item    | State                  |
|--------------------------------------------------|-----------------|------------------------|
| Per-player atomic write under load               | #1 + #5         | #1 done; **#5 missing**|
| Retry/backoff for transient blips                | #4              | pending                |
| Resilient extract/death                          | #6              | pending                |
| Matchmaking / lobby / party formation            | not Phase 3     | not started            |
| Loot fairness in shared rooms                    | not Phase 3     | partial — `lockedBy`   |
| Disconnect / reconnect handling                  | not Phase 3     | partial — `commitDeath`|
| Multi-process server (audit #6)                  | gated on **#5** | not started            |

**Hard prereq from Phase 3:** #5. Everything else is "needed eventually for a
healthy production" rather than "needed before the multi-process architecture
can be designed."

#### Design arc → itemization, monsters, graphics, maps

Designer workflow is already pleasant: registries in `shared/data/` are pure
data, no logic to write. Phase 3 #2 reinforced this — the server reads the
same registries the client renders from.

| Need                                             | Phase 3 item   | State                  |
|--------------------------------------------------|----------------|------------------------|
| Telemetry to see what's happening in playtests   | **#3**         | pending                |
| Playtests that don't lose work to flakes         | #4 + #6        | pending                |
| Asset pipeline for graphics (Cloudflare R2)      | not Phase 3    | not started            |
| Subclass / conditions / AI systems               | not Phase 3    | not started            |
| Floor-builder DSL or editor                      | not roadmapped | hand-authored works    |
| Recipe-acquisition system (gdd_crafting.md)      | not Phase 3    | conceptual only        |

**Hard prereq from Phase 3:** #3. The others are quality-of-life.

### Suggested re-ordering

Inverse of the current severity-based table, ordered to maximize what each
commit unlocks:

| New order | Item | Why this slot                                              |
|-----------|------|------------------------------------------------------------|
| 3rd       | #3   | Smallest, isolates cleanly, immediately enables data-driven design |
| 4th       | #4   | Small, reusable retry primitive that #6 sits on top of     |
| 5th       | #6   | Builds on #4, closes the most player-visible failure mode  |
| 6th       | #5   | Biggest item, only one with a schema migration; gates multi-process |

Both orderings get to the same end state. The re-ordering just front-loads the
items whose downstream value is largest (data for design; crash-safety for
infra).

---

## Future Work — `gear_events` table

When provenance / analytics features become real requirements, add a separate
append-only `gear_events` table alongside the current-state `gear_stash`. Sketch:

```sql
CREATE TABLE gear_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES player_profiles,
  item_id     TEXT NOT NULL,
  delta       INT  NOT NULL,             -- positive for acquisition, negative for removal
  reason      TEXT NOT NULL,             -- 'extract' | 'buy' | 'sell' | 'craft_in' | 'craft_out' | 'raider_add' | 'raider_remove' | 'death' | 'admin'
  run_id      UUID REFERENCES run_history,  -- nullable, set when the event came from a run
  occurred_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX gear_events_player_time ON gear_events (player_id, occurred_at DESC);
```

Wiring: every hub mutation and dungeon commit appends one or more rows here in addition
to updating `gear_stash`. The current-state table stays the source of truth for "what
does the player own right now"; `gear_events` answers "where did it come from" and
"what's the economy doing."

Features this unlocks:
- Item provenance tooltips ("first acquired 2026-04-12 from goblin loot")
- Dispute resolution ("show me every change to this player's longsword count")
- Economy analytics (% of healing potions bought vs looted vs crafted)
- Bug-recovery reconstruction if `gear_stash` is ever corrupted
- Seasonal / event-tagged item leaderboards

Don't build this until a concrete feature needs it. The schema above is a sketch; refine
when the requirements are clearer.

## Migration Notes

When Supabase Auth (email/password or OAuth) is added later:
- Add `auth_id UUID REFERENCES auth.users` to `player_profiles`
- Enable Row Level Security and add policies scoped to `auth.uid()`
- The username-login flow in `HubScene.js` becomes a real auth flow
- No other schema changes needed

The `playerStore` / `playerLoad` / `runCommit` abstraction boundary means the auth upgrade
is isolated to those files and `HubScene.js` — no game logic changes.
