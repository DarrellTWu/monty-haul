---
status: shipped
updated: 2026-07-07
purpose: Staff-level architecture + process review. Successor to architecture-review-2026-05-14.md. No code changes made by the review itself — findings reference exact sites for future sessions.
---

# Architecture & Process Review — 2026-07-07

Scope: full walk-through of the project as of commit `2ba3ec4` plus the uncommitted floor-3 work. Written with the immediate goal in mind: **first hosted deployment** (see [`deployment-guide.md`](deployment-guide.md)) and the next few sprints (see [`roadmap-2026-07.md`](roadmap-2026-07.md)).

Verification state at review time: all offline test suites pass (combat 46, loot 38, geometry 55, items 99, class-progression 13, level-up-flow 19, plus the container/loot/targeting/ranged/retry/dead-letter suites — ~430 assertions total across 14 files).

---

## 1. State of the project

Since the 2026-05-14 review, seven sprints shipped: target selection, ranged combat + advantage tri-state, itemization registry refactor, level-up-on-descend + multiclass MVP, ScrollViewport extraction, and (in flight, uncommitted) floor 3. Every one followed the plan → build → verify → archive loop. Every HIGH and MEDIUM finding from the May review was closed and stayed closed — the refactored modules (`ui/hub/` panels, `RoomRenderer`, `shared/logic/equipment.js`) did not silently regrow.

**The codebase is in genuinely good shape.** The problems below are almost all about the *transition* the project is about to make — from a localhost prototype played by its author to a hosted service played by other people. Localhost forgave things (trust-on-first-use login, one global room, wildcard CORS, hardcoded port, dead-letter on local disk) that a public URL does not.

## 2. What is working — keep doing this

These are the practices that make this codebase unusually agent-friendly and regression-resistant. They are worth naming explicitly so future sessions protect them:

1. **The `shared/` pure-logic layer is the crown jewel.** Framework-free, RNG-injected, exhaustively tested. Every sprint that extracted logic into it (equipment, conditions, class-progression, loot-window) paid off within one or two sprints. Default answer to "where does this logic go?" remains `shared/logic/`.
2. **Validator-style tests scale better than example-style tests.** `shared/tests/items.test.js` (registry-key parity, reference integrity across floors/loot/vendors/recipes) catches whole *classes* of authoring mistakes. Extend this pattern — a floor-data validator is the obvious next one (§3.4).
3. **The three-layer docs model with freshness contracts** (`agent-context/` live, `archive/` frozen, `design/` intent) plus frontmatter status is working exactly as designed. `DOC_PRINCIPLES.md` §"Adding a new system" checklist has been followed for every sprint since it was written.
4. **Sprint plans with "Locked decisions" and per-step verification** (e.g. `floor-3-sprint-plan.md`) are the single best process artifact here. They let a cold agent session execute without re-litigating design.
5. **Server-authoritative economy discipline** — client sends ids only; prices/recipes/validation server-side; per-player mutation lock; UPSERT-first sync; dead-letter on commit failure. This is beyond typical prototype quality and is why the deployment story is mostly configuration, not surgery.
6. **Review → remediation actually closes.** The May review's items were tracked to specific commits. Do the same with this document.

## 3. Findings

Severity is relative to the deployment goal. Items marked **[deploy]** are addressed concretely in [`deployment-guide.md`](deployment-guide.md); items marked **[roadmap]** are scheduled in [`roadmap-2026-07.md`](roadmap-2026-07.md).

### 3.1 HIGH

**H1. Trust-on-first-use login becomes account takeover on a public URL.** [deploy][roadmap]
`POST /hub/login { username }` upserts and returns the playerId; knowing a username *is* the credential. On localhost this was a documented, acceptable limitation (`PROJECT_STRUCTURE.md` §Known Limitations). On a hosted URL, anyone who knows or guesses a username owns that stash. The `/hub/:playerId/*` routes are similarly unauthenticated — the UUID playerId is effectively a bearer token (unguessable, but logged and copy-pasteable).
*Guidance:* do **not** block the first deploy on real auth. Treat deploy #1 as a closed playtest (unguessable usernames, link shared privately) and schedule the auth sprint immediately after (roadmap Sprint D). What to avoid: posting the URL anywhere public before auth lands.

**H2. One global room, unbounded.** [deploy][roadmap]
`joinDungeon` uses `joinOrCreate('dungeon')` and `DungeonRoom` sets no `maxClients`. On a hosted URL, every connected player worldwide lands in the same run, mid-run (the known late-join limitation becomes the *default* experience, and there is no player cap). Fine for a coordinated playtest; wrong the moment two groups play independently.
*Guidance:* minimum viable fix is small — `maxClients` + a `create`/`joinById` or join-code path so a party shares a private room. Full matchmaking stays deferred. Scheduled as roadmap Sprint C.

**H3. Server config is not environment-driven.** [deploy]
`server/index.js:11` hardcodes `PORT = 2567`; the hub router hardcodes `Access-Control-Allow-Origin: *`. Every PaaS injects `PORT` and expects the process to bind to it. This is a two-line change but it gates everything else — it is the first commit of the deploy sprint.

**H4. Supabase tables have no RLS.** [deploy]
Migrations 001/002 create the four tables without `ENABLE ROW LEVEL SECURITY`. Today only the service-role key touches them, so exposure is indirect — but Supabase exposes every table through PostgREST to anyone holding the project's anon key, and anon keys are designed to be publishable. One deny-all migration (no policies; service role bypasses RLS) closes this permanently. SQL provided in the deployment guide.

### 3.2 MEDIUM

**M1. The dead-letter safety net dies on ephemeral disks.** [deploy]
`server/.deadletter.jsonl` is the carefully-built last resort for failed extract/death commits — and PaaS filesystems are wiped on every redeploy. The `MH_DEAD_LETTER_PATH` override already exists (good foresight); point it at a mounted volume, or accept that hosted dead letters are best-effort until it moves to a Supabase table.

**M2. AISystem has zero tests while its behavior keeps growing.** [roadmap]
Carried from May at LOW; upgraded because elevation-aware retargeting, room-aware door pursuit, and wall-slide fallback have each shipped since, all verified only by manual play. The logic is nearly pure already (`update(state, dt, enemyDefs, melee, geometry)`) — extracting it to `shared/logic/ai.js` (long planned in `tech_spec.md`) and testing pursuit/retarget decisions with fixture geometry is one contained sprint.

**M3. Floor authoring is wholesale copy-paste and unvalidated.** [roadmap]
`floor3.js` is a 200-LOC verbatim clone of `floor2.js` including the `cluster`/`buildArm` helper functions. Acceptable for a debug floor (the sprint plan says so explicitly), but the third copy is the signal: before floor 4, extract the shared builders to something like `shared/data/floors/builders.js`. Pair it with the May review's still-open floor-schema validation (`validateFloorData()` at `_loadFloor` time) — as floors multiply, a malformed floor file crashing at iteration depth is increasingly likely and increasingly confusing.

**M4. `run_history` records one class; the game shipped multiclass.**
`DungeonRoom._buildRunMeta` (server/rooms/DungeonRoom.js:733) writes `player.class` — the primary class only — while `classLevels`/`levelUpHistory` carry the real build. Analytics on run history will silently misattribute multiclass runs. The tech_spec schema sketch already anticipated `classes_played JSONB`; a small migration + one-line meta change when convenient.

**M5. No CI.** [deploy]
~430 offline assertions exist and nothing runs them on push. The repo is already on GitHub (`DarrellTWu/monty-haul`); a single GitHub Actions workflow running the pure suites (no Supabase secrets needed) turns the excellent test discipline into an enforced gate. Workflow YAML provided in the deployment guide. Related: root `npm test` runs only `combat.test.js` — add a `test:all` script so humans, agents, and CI share one entry point.

**M6. `InventoryScene.js` (1018 LOC) is the next HubScene.**
Largest file in the repo, and it multiplexes three concerns: equipment/character sheet, bag + hotbar assignment, and loot-container mode. The HubScene split worked well; apply the same treatment (per-panel modules, scene as orchestrator) *the next time a feature touches it* — no need for a standalone refactor sprint.

### 3.3 LOW

- **L1. No `engines` field.** The server relies on `node --env-file` (≥20.6) and tests on `process.loadEnvFile` (≥21.7); dev machine runs Node 24. Pin `"engines": { "node": ">=22" }` in root + server package.json so PaaS builders pick the right runtime.
- **L2. No root `README.md`.** The GitHub landing page is blank. Ten lines — what the game is, `npm start`, pointer to `docs/README.md` — helps collaborators and hosting-platform repo scanners.
- **L3. No `.gitattributes`.** Every diff on this Windows checkout emits LF/CRLF warnings. One line (`* text=auto eol=lf`) ends it.
- **L4. `tech_spec.md` hosting/deployment sections are now superseded** by `deployment-guide.md` (the spec's Vercel/Railway table was aspirational; the guide is operational). Worth a status note in the spec on next touch. The cohort/ZoneSystem/12-player material remains valid *intent*.
- **L5. Carried from May, still open, still LOW:** elevation-flow code consolidation (4 scattered sites); client test harness for hub flows.
- **L6. Colyseus 0.15** is one major version behind current. No urgency — but note that `colyseus.js` client and server must stay in lockstep, so schedule the bump deliberately, not as a drive-by.

## 4. Process guidance going forward

1. **Add "runs in production" to the definition of done.** Once deployed, every sprint's verification section should include the hosted smoke test (deployment guide §7), not just localhost. The floor-3 plan's e2e checklist is the right shape — it just needs to run against the hosted URL too.
2. **Grow a fourth doc layer: operations.** The three-layer model (live/frozen/intent) has no home for runbooks — "how to deploy," "how to drain the dead-letter queue," "how to roll back." `deployment-guide.md` is the first such doc; if two more appear, give them `docs/ops/` and a README section, per `DOC_PRINCIPLES.md` §"fewer docs, denser docs, in the right layer."
3. **Keep the single-process assumption explicit.** `playerStore`'s in-memory cache and the one-room model both assume exactly one server process. That is the correct simplicity for now — but it means **never set replicas > 1 on the host**. This constraint is documented in the deployment guide; any future scaling sprint starts with Colyseus presence/Redis, not with a slider in a dashboard.
4. **Sprint sizing has been right — protect it.** The shipped sprints averaged a few files, one system, per-step verification. The two sprints ahead that most threaten this discipline are auth (touches client login, hub routes, room onAuth, and Supabase at once) and matchmaking. Both are split into stopgap-first shapes in the roadmap for exactly this reason.

## 5. Scorecard

| Area | May 2026 | Now |
|---|---|---|
| Shared logic + data | Excellent | Excellent — grew (conditions, class-progression, item-display) without quality loss |
| Test discipline (offline) | Good | Excellent — ~430 assertions, validator-style suites, every sprint added coverage |
| Persistence layer | Excellent | Excellent — unchanged; dead-letter durability is a hosting concern, not a code one |
| Server room / systems | Refactored, healthy | Healthy — DungeonRoom 681 LOC and stable; AISystem test gap now the weak spot |
| Client scenes | Refactored, healthy | Healthy except `InventoryScene.js` (1018 LOC, split-on-next-touch) |
| Docs system | Restructured, strong | Strong and self-sustaining — checklist followed unprompted across 7 sprints |
| Security posture | N/A (localhost) | **Weakest area for the deploy goal** — TOFU auth, no RLS, wildcard CORS, global room |
| Ops readiness (CI, config, deploy) | N/A | **Absent by design until now** — this is the next sprint's whole job |

**Bottom line:** the code is ready to be hosted; the *operational shell around it* is what's missing, and all of it is small: env-driven port, RLS migration, CI workflow, room cap, volume for the dead-letter file. The deliberate debt (TOFU auth, single room) is correctly documented and now has scheduled paydown dates in the roadmap. Nothing found in this review requires undoing past decisions — the architecture bets (shared-first, server-authoritative, plan-then-archive) are all paying out.
