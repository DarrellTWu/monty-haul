# Hub Settings Panel — Feature Plan

> **Status: Shipped (2026-05-11).** Phase 1 + Phase 2 both implemented and
> validated. Smoke coverage at `server/tests/rename-smoke.js` (31 tests).
> Beyond the original plan, the in-panel layout was expanded to a two-mode
> flow (menu ↔ rename) with a breadcrumb title, and a placeholder DEBUG MODE
> toggle was added above Rename. The DEBUG toggle is currently locked to `ON`
> because the only dungeon shipping today is the test/tuning build; the wiring
> is ready for a future change where flipping it to `OFF` and entering the
> dungeon routes the player through the intended end-user gameplay path
> (matchmaking, fresh-party rooms, production loot tuning).

## Goal

Add a persistent username display to the hub screen with a settings panel
that lets players log out and (later) rename their account.

---

## Phase 1 — Username Display + Settings Panel + Logout

### What's in scope
- Show the logged-in username at the top-left of the hub, with a ⚙ icon
- Click either element to open a settings panel overlay
- Settings panel contains a **Log Out** action
- Logout clears the session (localStorage + in-memory cache) and returns to the login screen

### What's out of scope for Phase 1
- Rename (deferred to Phase 2)
- Any other future settings items

---

### Touch-point summary

| File | Change |
|---|---|
| `server/routes/hub.js` | Include `username` in login POST and GET state responses |
| `client/src/store/stash.js` | Store `username`, export `getUsername()` and `logout()` |
| `client/src/scenes/HubScene.js` | Username + ⚙ display; settings panel with Logout |

---

### Step 1 — `server/routes/hub.js`

The player object in `playerStore` already carries `username` (loaded by
`playerLoad.js:46` and cached in `_byUsername` at `playerStore.js:37, 65`).
It just isn't included in the two hub JSON responses.

**Login POST** (`hub.js:35`) — add `username: p.username` to the response object.
**GET state** (`hub.js:43`) — add `username: p.username` to the response object.

No new routes needed for Phase 1.

---

### Step 2 — `client/src/store/stash.js`

Add a module-level `_username` variable (initially `null`).

**`initFromServer`** — destructure `username` from the server payload and
store it in `_username`. Signature stays backward-compatible (extra field is
just ignored by callers that don't pass it).

**`getUsername()`** — new sync read; returns `_username`.

**`logout()`** — new export:
1. Clears `_playerId` and `_username` to `null`
2. Resets `_cache` to `{ stash: [], gold: 0, raiderPack: [] }`
3. Calls `localStorage.removeItem(PLAYER_ID_KEY)`

No server call is needed — the server session is stateless between runs; the
playerId stored in localStorage is the only client-side session token.

---

### Step 3 — `client/src/scenes/HubScene.js`

#### 3a. Username display in `_buildHub()`

Render at top-left (x = 30, y = 38, baseline-matching the centered title at
`(640, 38)` and the VAULT label at top-right):

```
▸ username  ⚙
```

Both the username text and the ⚙ icon are interactive. Any click on either
calls `_openSettings()`.

Store these objects in a new `_topObjs` array (parallel to `_leftObjs` and
`_rightObjs`). They are *not* destroyed on sub-nav tab switches — only on
`_buildHub()` rebuild (used by Phase 2's rename refresh) or on logout via
`scene.restart`.

#### 3b. Settings panel — `_openSettings()` / `_closeSettings()`

**Modal semantics — required, not optional.** Phaser doesn't capture pointer
events under an overlay graphic by default, so any clickable element under the
panel (`[ Enter Dungeon ]`, sub-nav tabs, stash rows) remains live and can
fire while the panel is open. Block this by:

1. Creating a full-screen backdrop rect first (e.g. `add.rectangle(0, 0,
   1280, 720, 0x000000, 0.45).setOrigin(0).setInteractive()`). The
   `.setInteractive()` call swallows clicks that miss the panel. Clicks on
   the backdrop itself also close the panel (cheap "click-outside-to-close"
   behavior).
2. Drawing the panel above the backdrop. Phaser draws in creation order, so
   this works as long as panel objects are added after the backdrop.

Both the backdrop and panel are pushed into a `_settingsObjs` array.

**Panel contents (Phase 1):**
```
┌──────────────────────────┐
│  SETTINGS                │
│  ──────────────────────  │
│  Logged in as: username  │
│                          │
│  [ Log Out ]             │
│                          │
│  [ × Close ]            │
└──────────────────────────┘
```

Panel is centered on the screen (cx = 640, cy = 360), width ≈ 320, height ≈
220. This avoids the awkward overlap with the centered title (`y=38`) and the
left-panel border (`y=70`) that a top-left-anchored panel would have.
Rendered with the same `add.graphics()` dark-fill + border style used
elsewhere in HubScene.

**Log Out action:**
1. Close the panel first (destroy `_settingsObjs`, remove Escape handler)
2. Call `logout()` from `store/stash.js`
3. Call `this.scene.restart({})` — pass an empty object explicitly so any
   prior `init({ view: 'stash' })` data from DungeonScene is cleared.
   HubScene's `create()` will call `getPlayerId()`, get `null`, and route to
   `_showLoginScreen()`.

**Close paths:**
- `[ × Close ]` text button inside the panel
- Escape key, via `window.addEventListener('keydown', ...)` registered on open
- Click on the backdrop (outside the panel rect)

`_closeSettings()` must:
1. Remove the keydown listener (`window.removeEventListener`)
2. Destroy every object in `_settingsObjs`
3. Clear `_settingsObjs = []`
4. Clear `_settingsOpen = false` (used by the guard below)

Guard: track `_settingsOpen` boolean. `_openSettings()` is a no-op when true.

---

### Phase 1 verification checklist
- [ ] Server `/login` and `/:playerId` responses include `username`
- [ ] `getUsername()` returns the logged-in username after login or reload
- [ ] Clicking the username or ⚙ icon opens the panel
- [ ] Clicking through the backdrop onto a stash row or `[ Enter Dungeon ]`
      does NOT fire those handlers (modal block working)
- [ ] Escape, `[ × Close ]`, and clicking the backdrop all close the panel
- [ ] `[ Log Out ]` clears localStorage, resets the cache, and lands on the
      login screen
- [ ] After logout, logging back in restores the previous stash/gold/pack
      (server state is intact; only the client session was cleared)
- [ ] After logout from the stash sub-tab, login does NOT auto-open Stash
      (i.e. `_initData.view` was cleared by `restart({})`)

---

## Phase 2 — Rename (planned, not yet implemented)

### Additional touch-points

| File | Change |
|---|---|
| `server/persistence/playerSync.js` | Add `renameUsername(playerId, newUsername)` |
| `server/store/playerStore.js` | Add `renamePlayer(playerId, newUsername)` |
| `server/routes/hub.js` | Add `POST /:playerId/rename { username }` route (wrapped in `asyncRoute`) |
| `client/src/network/HubAPI.js` | Add `rename(playerId, newUsername)` method |
| `client/src/store/stash.js` | Add `renameUser(newUsername)` async mutation |
| `client/src/scenes/HubScene.js` | Add Rename section to settings panel |

### Server — `renameUsername` (playerSync.js)

1. UPDATE `player_profiles` SET `username = newUsername` WHERE `id = playerId`.
2. Catch the Postgres error inside this function:
   - If `err.code === '23505'` (UNIQUE violation on `username`), return
     `{ ok: false, error: 'username_taken' }`.
   - Otherwise re-throw so `asyncRoute` returns a 500.
3. On success return `{ ok: true }`.

The `player_profiles.username` column already has a UNIQUE constraint (relied
on by `createProfile` at `playerSync.js:31-36`), so the UPDATE itself is the
race-safe check — no separate SELECT needed, and no DB migration needed.

### Server — `renamePlayer` (playerStore.js)

Inside `_withLock(playerId)`:

1. **Input validation** (server mirrors client; never trust client):
   - `newUsername = String(newUsername ?? '').trim()`
   - If `!newUsername` or `newUsername.length > 20`, return
     `{ ok: false, error: 'invalid_username' }`.
   - (Length cap matches the existing login screen's 20-char limit at
     `HubScene.js:196`.)
2. Load player; return `{ ok: false, error: 'Player not found' }` if absent.
3. If `p.username === newUsername` return `{ ok: true, username: newUsername }`
   (no-op rename succeeds silently).
4. Call `renameUsername(playerId, newUsername)`. If it returns
   `{ ok: false, error: 'username_taken' }`, propagate that to the caller.
5. On success: evict the old `_byUsername` entry, set `p.username = newUsername`,
   register the new `_byUsername` entry.
6. Return `{ ok: true, username: newUsername }`.

### Server — `/rename` route (hub.js)

```js
router.post('/:playerId/rename', asyncRoute(async (req, res) => {
  const result = await store.renamePlayer(req.params.playerId, req.body?.username);
  res.status(result.ok ? 200 : 400).json(result);
}));
```

Wrapping in `asyncRoute` matches every other mutation route (`hub.js:47-83`).

### Client — `renameUser` (stash.js)

```js
export async function renameUser(newUsername) {
  const result = await HubAPI.rename(_playerId, newUsername);
  if (result.ok) _username = result.username;
  return result;
}
```

Returns the full result object (not just a bool) so the UI can distinguish
`username_taken` from `invalid_username` from a network failure.

### Client — rename UI in settings panel

Additional panel section (below a separator, above Close):

```
NEW NAME  [______________]
[ Rename ]   · status text
```

- Text input pre-filled with current username (same keyboard-capture pattern
  as login screen: `window.addEventListener('keydown', ...)`)
- Client-side validation: non-empty after trim, max 20 chars, different from
  current name
- On submit: show "Renaming…", call `renameUser(newName)`
  - `{ ok: true }`: update `_topObjs` display (rebuild via the same path
    `_buildHub` uses), update status to "Saved ✓", close panel after ~500ms
  - `{ ok: false, error: 'username_taken' }`: show "Name already taken"
  - `{ ok: false, error: 'invalid_username' }`: show "Invalid name"
  - Thrown / network error: show "Could not connect"

### Phase 2 doc-update reminders

Per CLAUDE.md "Keeping Docs Current", Phase 2 introduces new touch-points
worth flagging in the project docs after merge:

- `playerStore.js` section — note `renamePlayer` mutation and the per-player
  lock interaction
- `hub.js` section — list `POST /:playerId/rename`
- `playerSync.js` section — describe `renameUsername` and the 23505 mapping

(No `tech_spec.md` changes anticipated — the rename feature is
hub-economy-adjacent, not core gameplay.)
