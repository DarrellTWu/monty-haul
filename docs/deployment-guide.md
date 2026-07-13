---
status: shipped
updated: 2026-07-12
purpose: Operational guide — how the game is deployed (server, client, database), the live URLs, and how to verify a deployment. First hosted deploy completed + smoke-tested 2026-07-12.
---

# Deployment Guide

Goal: the full loop (login → hub → dungeon → extract/death → stash persists) running on public URLs instead of localhost. Written 2026-07-07; executed 2026-07-12.

## Live deployment (since 2026-07-12)

| Piece | URL / detail |
|---|---|
| Client | https://monty-haul.pages.dev (Cloudflare Pages, auto-deploys on push to `main`) |
| Server | `https://server-production-c772.up.railway.app` — `/healthz` for liveness; WebSocket at `wss://` same host (Railway, US West, auto-deploys on push to `main`) |
| Database | Supabase project `xnwiuaqslbpdkvjccqol` (free tier), RLS deny-all applied (migration 003) |

Deviations from the guide as written:
- **API key:** Railway's `SUPABASE_SERVICE_ROLE_KEY` holds one of Supabase's newer **secret keys** (`sb_secret_…`), not the legacy `service_role` JWT — Supabase now recommends these; drop-in compatible (verified via smoke test with `supabase-js` 2.103.0). Same env-var name.
- **Free-tier pause:** the Supabase project auto-pauses after ~1 week of inactivity and drops off DNS (`ENOTFOUND <ref>.supabase.co`, hub routes 500). Restore from the dashboard; schema and data survive.

⚠️ Operational notes:
- **Every push to `main` redeploys both Railway and Pages.** A Railway redeploy restarts the server and disconnects anyone mid-run (in-run progress lost, hub state safe). Push when nobody's playing.
- The URL runs **trust-on-first-use auth** and **one global room** — closed playtest only until roadmap Sprints C + D land. Don't post it publicly.
- CORS is still `*`; tighten in Sprint C (§8).
- After each playtest, skim Railway logs for dead-letter warnings (§8).

**Recommended stack** (matches the intent in `tech_spec.md` §1, chosen here for lowest ops burden):

| Piece | Host | Why | Cost |
|---|---|---|---|
| Game server (Colyseus + Express) | **Railway** | Native WebSocket support, deploy-from-GitHub, volumes for the dead-letter file, no cold starts | ~$5/mo (Hobby) |
| Client (static Vite build) | **Cloudflare Pages** | Free, fast CDN, deploy-from-GitHub, build-time env vars | $0 |
| Database | **Supabase** (already in use) | Nothing to migrate — point prod env vars at it | $0 (free tier) |

Alternatives, if preferences change: **Render** free tier works but spins the server down after ~15 min idle (players hit a 30–60 s cold start — acceptable for scheduled playtests only). **Fly.io** gives more control (volumes, regions) at the cost of a `fly.toml` and CLI-first workflow. **Colyseus Cloud** is purpose-built but adds a platform dependency; revisit at matchmaking time.

---

## 1. Pre-deploy code changes (one small commit)

These are required or near-required. None existed at guide-writing time — make them the first commit of the deploy sprint.

1. **Bind to the platform's port** — `server/index.js:11`:
   ```js
   const PORT = Number(process.env.PORT) || 2567;
   ```
   Every PaaS injects `PORT`. Local behavior is unchanged.
2. **Start script that doesn't require a `.env` file.** `npm run server` uses `--env-file=server/.env`, which *errors if the file is absent* — and on the host, env vars come from the dashboard, not a file. Add to root `package.json`:
   ```json
   "start:prod": "node server/index.js"
   ```
3. **Pin the runtime** — add to root and `server/package.json`:
   ```json
   "engines": { "node": ">=22" }
   ```
   (The code uses `--env-file` and `process.loadEnvFile`; dev runs Node 24. Railway/Render read this field.)
4. *(Optional but cheap)* **Health endpoint** — in `server/index.js`, before the hub router:
   ```js
   app.get('/healthz', (_req, res) => res.json({ ok: true }));
   ```
   Gives the platform (and you) something to probe that doesn't touch Supabase.

Deliberately **not** changed for deploy #1: CORS wildcard (tighten in §8 after the client URL exists), TOFU auth and the single global room (scheduled sprints — see `roadmap-2026-07.md`; run deploy #1 as a closed playtest).

## 2. Supabase

The dev project can serve as prod for the closed playtest. If (recommended, when convenient) you want separation, create a second Supabase project as prod and apply `supabase/migrations/001` and `002` via SQL Editor.

**Either way, enable RLS now.** The tables are currently exposed to anyone holding the project's anon key via PostgREST. The server uses the service-role key, which bypasses RLS, so a deny-all posture costs nothing. Add as `supabase/migrations/003_enable_rls.sql` and run it in the SQL Editor:

```sql
-- Deny-all RLS: no policies defined, so anon/authenticated get nothing.
-- The game server uses the service-role key, which bypasses RLS entirely.
ALTER TABLE player_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_stash       ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_progression ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_history      ENABLE ROW LEVEL SECURITY;
```

Collect for §3: **Project URL** and **service_role key** (Dashboard → Settings → API). The service-role key goes in the server host's env vars only — never in client env, never in git.

## 3. Server → Railway

1. railway.app → New Project → **Deploy from GitHub repo** → `DarrellTWu/monty-haul`.
2. Service settings:
   - **Root directory:** leave at repo root (the server imports `shared/` by relative path; the whole monorepo must be present).
   - **Build:** auto (Nixpacks detects Node, runs `npm install` — workspaces install everything).
   - **Start command:** `npm run start:prod`
3. **Variables:**
   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | service-role key |
   | `MH_DEAD_LETTER_PATH` | `/data/deadletter.jsonl` *(with the volume below)* |
4. **Volume (recommended):** right-click the service → Attach Volume → mount path `/data`. Without it, the filesystem is wiped on every redeploy and any dead-lettered extract/death commits are lost — the one durability gap in an otherwise write-through design. If you skip the volume, also skip the `MH_DEAD_LETTER_PATH` var and accept best-effort dead letters for the playtest.
5. **Networking → Generate Domain.** When asked for the port, use `2567` (or whatever `PORT` Railway injected — with the §1 change the app binds to the injected one automatically). Railway terminates TLS, so the app is reachable at `https://…railway.app` and WebSockets at `wss://…railway.app` with no extra config.
6. Deploy log should show `Colyseus server listening…` and no dead-letter warning. Then verify from your machine:
   - `https://<domain>/healthz` → `{"ok":true}` (if added)
   - `POST https://<domain>/hub/login` with `{"username":"smoketest"}` → `{ ok: true, playerId, … }`

**Scaling warning — do not set replicas > 1.** `playerStore`'s in-memory cache and the single-room model assume exactly one process. A second replica means split-brain hub state and players sharded across invisible duplicate rooms. Horizontal scaling is a future sprint (Colyseus presence + Redis), not a dashboard setting.

## 4. Client → Cloudflare Pages

1. dash.cloudflare.com → Workers & Pages → Create → **Pages → Connect to Git** → select the repo.
2. Build settings:
   - **Root directory:** *(repo root)*
   - **Build command:** `npm install && npm run build --workspace=client`
   - **Build output directory:** `client/dist`
3. **Environment variable (build-time):**
   | Name | Value |
   |---|---|
   | `VITE_COLYSEUS_URL` | `wss://<your-railway-domain>` |

   This one var drives both the WebSocket connection and the `/hub` HTTP base (`HubAPI.js` derives `https://…/hub` from it). It is baked in at build time — changing it means re-deploying the Pages build, not just editing the dashboard.
4. Deploy. The site is at `https://<project>.pages.dev`.

Notes:
- **Mixed content:** the client is HTTPS, so the server URL *must* be `wss://` — a `ws://` value will be silently blocked by the browser. This is the most common first-deploy failure; check the browser console for mixed-content errors if the hub login hangs.
- There are no image/audio assets yet (everything is Phaser Graphics), so the R2 asset pipeline from `tech_spec.md` §3.4 is **not needed** for this deploy. When real sprites land, revisit that section; until then `VITE_ASSET_BASE_URL` is unused.
- Vercel works identically if preferred (framework preset Vite, same build command/output/env var).

## 5. CI (do this in the same sprint)

The offline suites need no secrets. Add `.github/workflows/test.yml`:

```yaml
name: tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install
      - run: node shared/tests/combat.test.js
      - run: node shared/tests/loot.test.js
      - run: node shared/tests/geometry.test.js
      - run: node shared/tests/character.test.js
      - run: node shared/tests/equipment.test.js
      - run: node shared/tests/conditions.test.js
      - run: node shared/tests/class-progression.test.js
      - run: node shared/tests/items.test.js
      - run: node server/tests/container-lock.test.js
      - run: node server/tests/loot-flow.test.js
      - run: node server/tests/target-selection.test.js
      - run: node server/tests/ranged-combat.test.js
      - run: node server/tests/level-up-flow.test.js
      - run: node server/tests/with-retry.test.js
      - run: node server/tests/dead-letter.test.js
```

Better: add a root `"test:all"` script that runs the same list (a tiny `node scripts/run-tests.js` or a one-line shell loop) so CI, humans, and agents share one entry point, and the workflow becomes a single `npm run test:all`. The Supabase smoke tests (`supabase-smoke`, `rename-smoke`, `run-history-smoke`, `concurrency-smoke`, `anti-cheat-smoke`) stay manual/local — they need live credentials and a throwaway player.

Both Railway and Cloudflare Pages auto-deploy on push to `main` once connected — with the workflow above, a red build on GitHub is your signal to check before the auto-deploy bites.

## 6. Order of operations, first deploy

1. Land the §1 commit (port, `start:prod`, engines, healthz) + §5 workflow. Push; CI green.
2. Run the §2 RLS migration in Supabase.
3. Railway: §3. Verify `/healthz` + `/hub/login` from your machine.
4. Cloudflare Pages: §4 with `VITE_COLYSEUS_URL` pointing at the Railway domain.
5. Run the smoke test (§7) yourself, then with a second person on a different network.

## 7. Hosted smoke test (definition of done)

On `https://<project>.pages.dev`, with a fresh username:

- [ ] Login creates the player; stash shows the seeded starter kit; refresh keeps the session (localStorage playerId → `GET /hub/:playerId`).
- [ ] Buy a potion, craft nothing (or Tan Hide if materials on hand), rename — each survives a page refresh (round-trips Supabase).
- [ ] Stage a loadout in the raider pack, Enter Dungeon — WebSocket connects (no mixed-content errors in console).
- [ ] Move, attack, kill an enemy, loot the corpse, open the entry chest.
- [ ] Descend to floor 2 (long rest + level-up modal), take the floor-2 stair to floor 3, confirm the floor-4 stair stays locked after clearing.
- [ ] Use the Scroll of Extraction → back in hub, extracted gear + gold present in stash.
- [ ] Die on a second run → run gold gone, stash intact; `run_history` has both rows (Supabase Table Editor).
- [ ] **Two browsers/machines simultaneously**: both players visible and moving in the same dungeon; loot-window lock excludes the second opener.
- [ ] Railway logs clean: no dead-letter warnings, no unhandled rejections.

## 8. Post-deploy tightening (same sprint or next)

- **CORS:** replace `*` in `server/routes/hub.js` with the Pages origin (`https://<project>.pages.dev`), keeping localhost:5173 for dev — e.g. an allowlist read from an `ALLOWED_ORIGINS` env var.
- **Watch the dead-letter file** after each playtest: any entries mean a player's extract/death didn't commit — recover manually per `agent-context/persistence.md`.
- **Known-and-accepted for the closed playtest** (do not share the URL publicly until these land — see roadmap): username login is trust-on-first-use (Sprint D: auth); all players share one global room and can join mid-run, with no player cap (Sprint C: room lifecycle).
- **Restart semantics:** a server redeploy/crash mid-run disconnects everyone; in-run progress is lost (equivalent to death-on-disconnect — `onLeave` may not fire on hard kills, in which case no `run_history` row is written either). Hub state is safe: every hub mutation is write-through to Supabase before the response returns. Announce redeploys during playtests.
