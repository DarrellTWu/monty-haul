# Server-Side Persistence Plan
*Internal Reference | Two-Phase Implementation*

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

## Migration Notes

When Supabase Auth (email/password or OAuth) is added later:
- Add `auth_id UUID REFERENCES auth.users` to `player_profiles`
- Enable Row Level Security and add policies scoped to `auth.uid()`
- The username-login flow in `HubScene.js` becomes a real auth flow
- No other schema changes needed

The `playerStore` / `playerLoad` / `runCommit` abstraction boundary means the auth upgrade
is isolated to those files and `HubScene.js` — no game logic changes.
