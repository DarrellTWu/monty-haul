---
status: shipped
updated: 2026-05-14
purpose: Supabase plumbing, retry, dead-letter, run history. Read when the task touches the persistence layer.
---

# Persistence Layer

History + design rationale: `archive/server-persistence-plan.md` (Phase 0–3).

## Architecture
- **Source of truth (in-run state):** Colyseus authoritative server.
- **Source of truth (between-runs state):** Supabase Postgres.
- **Bridge:** `server/store/playerStore.js` — async write-through cache.

## playerStore
- In-memory `Map<playerId, state>` is the fast path.
- On miss: `loadPlayer` / `loadPlayerByUsername` populate from `gear_stash` + `meta_progression`.
- Every mutation modifies the cached state then `await`s `syncStashAndMeta` to persist.
- **All exports are async.** Mutations return `{ ok, stash, gold, raiderPack }` (except `renameUser` — full server result).
- New players (no DB row) get `INITIAL_STASH` seeded via `createProfile` on first `getOrCreate`.

### Per-player mutation lock (`_withLock`)
Serializes concurrent mutations for the same `playerId` so `syncStashAndMeta`'s DELETE+INSERT can't interleave. Other players still mutate in parallel.

### Server-authoritative pricing
- `buyItem(playerId, itemId)` reads `BUYABLE_PRICES` from `shared/data/shop.js`.
- `sellItem(playerId, itemId)` reads `sellPrice()` from `shared/data/values.js`.
- `craftRecipe(playerId, recipeId)` reads `RECIPE_REGISTRY` from `shared/data/crafting/recipes.js`.

Client-supplied prices and recipe internals are **not** accepted.

### Run history
- `commitExtract` and `commitDeath` accept `{ classId, floorsReached, kills, runDurationS }`.
- Call `insertRunHistory` inside the same per-player lock.
- Insert failure is logged but **never** invalidates the stash mutation.
- If `classId` is absent (legacy callers / tests), the row insert is skipped.

### Dead-letter queue
When `savePlayer` throws after `withRetry` exhausts (sustained Supabase outage):
1. Payload appended to dead-letter log via `appendDeadLetter` **before** the error propagates (so a server crash before the next mutation doesn't silently lose the run).
2. `DungeonRoom` surfaces a "save failed" combat-log line on extract; death path logs only.

## Persistence Helpers (`server/persistence/`)

| File | Purpose |
|---|---|
| `supabase.js` | Singleton client from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Server-only, bypasses RLS. |
| `withRetry.js` | Generic 3-attempt 100/200/400 ms backoff HOF. Default predicate skips errors with 5-digit Postgres SQLSTATE (UNIQUE/FK/etc.). **Only wrap idempotent ops** — wrapping a bare INSERT can produce duplicate rows on post-commit blip + retry. |
| `playerLoad.js` | `loadPlayer(playerId)`, `loadPlayerByUsername(username)`. Aggregates `gear_stash` rows by `item_id`. All SELECTs wrapped in `withRetry`. |
| `playerSync.js` | Write-side. `createProfile` (un-retried, one-shot). `syncStashAndMeta` (UPSERT items by `(player_id, item_id)`, DELETE-NOT-IN, UPSERT meta by PK — UPSERT-first so a mid-sync crash leaves ghost rows but never wipes owned items). `renameUsername` (catches PG 23505 → `{ok:false, error:'username_taken'}`). All wrapped in `withRetry`. Requires migration `002_unique_stash.sql`. |
| `runCommit.js` | `insertRunHistory(...)`. Throws on Supabase error; caller wraps in try/catch. **Un-retried** — losing a telemetry row is preferable to duplicating one. |
| `deadLetter.js` | Append-only JSONL at `server/.deadletter.jsonl` (gitignored; override path with `MH_DEAD_LETTER_PATH` for tests). Format: `{ kind: 'extract' \| 'death', playerId, payload, error, ts }`. Recovery is operator-driven — no auto-replay. Server `index.js` logs a startup warning if the file is non-empty. |

## Rename Flow
1. `renamePlayer(playerId, newUsername)` trims + validates non-empty and ≤20 chars server-side.
2. Dispatches to `renameUsername`.
3. On success, evicts the old `_byUsername` entry and registers the new one.
4. A no-op rename (current name) is a fast-path success.
5. UNIQUE conflict surfaces as `{ ok: false, error: 'username_taken' }` from the persistence layer.

## Schema Conventions
- Schema is **current-state oriented** — one row per `(player_id, item_id)` in `gear_stash` after migration 002.
- `run_history` is append-only telemetry.
- See `supabase/migrations/`.

## Known Limitations
- **Username login is trust-on-first-use.** Anyone with a username can become that player. Real auth (Supabase Auth) is future work.
- **`run_history.kills` always 0.** Column exists; attribution deferred.
