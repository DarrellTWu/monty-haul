---
status: shipped
updated: 2026-07-13
purpose: Supabase plumbing, auth (passwords + session tokens), retry, dead-letter, run history. Read when the task touches the persistence layer or login.
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
- New players (no DB row) get `INITIAL_STASH` seeded via `createProfile` on first `getOrCreate` / `authenticate`.

### Auth (`authenticate`, Sprint D 2026-07-13)
`authenticate(username, password)` is the single entry for `/hub/login`: username validated first via shared `validateUsername` (trim, non-empty, ≤ `USERNAME_MAX_LENGTH` — same rule as rename; `{ ok: false, error: 'invalid_username' }` → HTTP 400); unknown username → register (scrypt hash into `player_profiles.password_hash`, migration 004); known + `passwordHash === null` → legacy account adopts this password (link-by-first-authed-login); known + hash → verify, `{ ok: false, error: 'invalid_credentials' }` on mismatch. A registration race (two concurrent first-time logins, same name) is absorbed: the loser's PG 23505 falls through to a re-read + the normal existing-account path instead of a 500. Hashing/verify in `server/auth/passwords.js`; session tokens (HMAC, 7-day TTL, `AUTH_TOKEN_SECRET` env) + `requireAuth` middleware in `server/auth/tokens.js`; `DungeonRoom.onAuth` verifies the same token on room join. Design rationale + upgrade path to Supabase Auth: header comment of `tokens.js` and `agent-context/protocol.md` §HTTP.

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
| `playerLoad.js` | `loadPlayer(playerId)`, `loadPlayerByUsername(username)`. Selects `password_hash` (migration 004) into `passwordHash`. Aggregates `gear_stash` rows by `item_id`. All SELECTs wrapped in `withRetry`. |
| `playerSync.js` | Write-side. `createProfile(username, initialStash, passwordHash)` (un-retried, one-shot). `syncStashAndMeta` (UPSERT items by `(player_id, item_id)`, DELETE-NOT-IN, UPSERT meta by PK — UPSERT-first so a mid-sync crash leaves ghost rows but never wipes owned items). `renameUsername` (catches PG 23505 → `{ok:false, error:'username_taken'}`). `updatePasswordHash` (idempotent, retried). All wrapped in `withRetry`. Requires migrations `002_unique_stash.sql` + `004_password_auth.sql`. |
| `runCommit.js` | `insertRunHistory(...)`. Throws on Supabase error; caller wraps in try/catch. **Un-retried** — losing a telemetry row is preferable to duplicating one. |
| `deadLetter.js` | Append-only JSONL at `server/.deadletter.jsonl` (gitignored; override path with `MH_DEAD_LETTER_PATH` for tests). Format: `{ kind: 'extract' \| 'death', playerId, payload, error, ts }`. Recovery is operator-driven — no auto-replay. Server `index.js` logs a startup warning if the file is non-empty. |

## Rename Flow
1. `renamePlayer(playerId, newUsername)` validates via shared `validateUsername` (trim, non-empty, ≤ `USERNAME_MAX_LENGTH`, strings only).
2. Dispatches to `renameUsername`.
3. On success, evicts the old `_byUsername` entry and registers the new one.
4. A no-op rename (current name) is a fast-path success.
5. UNIQUE conflict surfaces as `{ ok: false, error: 'username_taken' }` from the persistence layer.

## Storage Model — Current-State (decided 2026-05-09)
`gear_stash` is treated as **current state**, not an event log: one logical row per `(player_id, item_id)`. The sync pattern (UPSERT current items + DELETE-NOT-IN) effectively snapshot-replaces the player's stash rows.

This was a deliberate pick over an audit-trail interpretation because it mirrors the in-memory `playerStore` shape 1:1 — the Phase 2 Supabase migration stayed a pure storage swap with zero behavior change. The `acquired_via` / `acquired_at` columns become "last sync" metadata in this mode and are **not** relied on for provenance.

**Future provenance path:** an append-only `gear_events` table can be layered alongside the current-state `gear_stash` when audit/analytics demand it. The current-state table stays the source of truth for "what does the player own right now"; events answer "how did they get it." Sketch in `archive/server-persistence-plan.md` §"Future Work — gear_events".

## Other Schema Conventions
- `run_history` is append-only telemetry.
- See `supabase/migrations/`.

## Known Limitations
- **No token refresh or revocation list.** Sessions last 7 days; revocation only via `AUTH_TOKEN_SECRET` rotation (logs everyone out). Acceptable for the closed playtest; swap `verifyToken` internals for `supabase.auth.getUser(jwt)` if/when Supabase Auth lands.
- **Server startup probes for migration 004** and warns loudly if `password_hash` is missing (logins fail until applied).

## See also — historical context
`archive/server-persistence-plan.md` — Phase 0–3 build plan + post-implementation audit. Read only if you need: the original Phase 1/2/3 decomposition and rationale, the 2026-05-09 audit findings (snapshot-replace row-op waste, etc.), the full Phase 3 hardening pre-flight list (per-player lock, server-authoritative pricing, retry, dead-letter, atomic-safe sync — all shipped), the future `gear_events` table sketch, or the Supabase Auth migration notes. Frozen at Phase 3 completion (2026-05-10).
