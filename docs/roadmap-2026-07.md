---
status: in-progress
updated: 2026-07-13
purpose: Sprint roadmap for the next ~8 sprints, sequenced around two goals — first hosted deployment, then designer-ready content pipelines (art, floors, monsters). Each sprint gets its own detailed plan doc when it starts (per DOC_PRINCIPLES §"Adding a new system"); this doc holds goals, scope boundaries, and success criteria only.
---

# Roadmap — July 2026

Sequencing rationale: **deploy first, harden second, then two interleavable tracks.** A hosted closed playtest generates real feedback now; auth (D) only needs to land before the URL is shared beyond trusted testers. The content-enablement track (V → E → F → G) builds the tooling that lets designers — human or agent-assisted — author visuals, floors, and monsters without touching engine code; see [`content-pipeline-enablement.md`](content-pipeline-enablement.md) for the assessment and the agentic workflows (W1–W8) these sprints unblock. D and V/E–G are independent: if designer capacity arrives before public-URL plans, run the content track first. Sprint V (first art pass) is client-only and deliberately placed immediately after deploy so every playtest thereafter tests the actual look of the game.

Cross-references: findings labeled H*/M*/L* are from [`architecture-review-2026-07-07.md`](architecture-review-2026-07-07.md); deploy mechanics live in [`deployment-guide.md`](deployment-guide.md).

---

## Sprint A — Ship floor 3 *(code committed 2026-07-12; plan not yet archived)*

Floor 3 landed in commit `12349a7`. Remaining housekeeping from [`floor-3-sprint-plan.md`](floor-3-sprint-plan.md):

- Run the plan's step-5 end-to-end smoke (floor 1 → 2 → 3, permanent-lock stair, extraction, death row).
- Commit; archive the plan to `docs/archive/` with `status: archived`; flag the doc updates the plan already lists (`PROJECT_STRUCTURE.md` floors row, `agent-context/floors.md` permanentLock note).

**Done when:** smoke checklist passes locally; working tree clean; plan archived.

## Sprint B — First hosted deploy ✅ *(completed 2026-07-12 — live URLs in `deployment-guide.md`)*

Execute [`deployment-guide.md`](deployment-guide.md) end to end. Closes H3, H4, M1, M5, L1.

1. Pre-deploy commit: env-driven `PORT`, `start:prod` script, `engines` field, `/healthz` → verify: local `npm start` unchanged, `PORT=3000 npm run start:prod` binds 3000.
2. `003_enable_rls.sql` migration → verify: anon-key REST query returns zero rows; game still works (service role bypasses).
3. CI workflow + root `test:all` script → verify: green check on GitHub.
4. Railway (server + env vars + volume) and Cloudflare Pages (client + `VITE_COLYSEUS_URL`) → verify: guide §7 hosted smoke test, including the two-machine multiplayer check.
5. Root `README.md` (10 lines: what, `npm start`, docs pointer) and `.gitattributes` (L2, L3) ride along.

**Done when:** a second person on another network completes the full loop on the public URL. Flip the deployment guide's frontmatter to `shipped` and record the live URLs in it.

**Out of scope:** auth, CORS tightening beyond the allowlist, any gameplay change.

## Sprint V — First art pass (sprites + tile skin)

Client-only; slots anywhere after A (recommended here, so every hosted playtest looks like a game instead of a geometry demo). See `content-pipeline-enablement.md` §"Art" for the full rationale and the three-tier cost split. Two halves, engine-light throughout — the server is never touched.

- **Half 1 — sprite pipeline foundation:** human picks one CC0 pack (Kenney / 0x72 DungeonTileset II / DungeonCrawl Stone Soup — this is the taste gate, ~an hour of browsing); agent integrates via workflow W6: assets under `client/public/assets/` (no R2 — Pages serves them), license captured in `LICENSES.md`, preload step, `spriteKey` on enemy defs + `ITEM_REGISTRY` (default = id), **fallback-first rendering** (missing texture → today's colored circle), asset-coverage validator, in-game screenshot verification (W8). Gap-fill any missing ids with agent-authored SVG (W7).
- **Half 2 — floor tile skin:** `RoomRenderer` paints ground/wall/platform tiles *from the existing floor rect data* (auto-tiling; no authoring-format change, Sprint E's builders/preview plan unaffected); `pixelArt: true` + zoom in the Phaser config.

**Done when:** floor 1 renders with tiles and sprites for every current entity/item; deleting one texture file degrades that entity to the placeholder circle (not a crash); the coverage validator reports 100%; hosted build (`pages.dev`) shows the same result.

**Out of scope:** animations beyond idle (facing/walk cycles are a follow-up once the pack's frames are wired), audio, Tiled-as-authoring-format, R2.

## Sprint C — Room lifecycle + production hygiene ✅ *(completed 2026-07-13)*

Make the hosted build safe for multiple *groups*. Closes H2, part of H1's exposure, M3's validation half.

- `maxClients` on `DungeonRoom` + private-room path: party leader creates a room, gets a short join code, others `joinById`. Solo "quick start" keeps `joinOrCreate` semantics or auto-creates. (Full matchmaking stays deferred — this is the stopgap that makes strangers-in-my-run impossible.)
- CORS allowlist from `ALLOWED_ORIGINS` env (guide §8).
- `validateFloorData()` at server boot — validator-style, modeled on `items.test.js`: required keys per floor, stair `toFloor` targets exist in `FLOOR_REGISTRY` or are `permanentLock`, chest items resolve, enemies reference known types, geometry rects well-formed.

**Done when:** two simultaneous parties on the hosted server run separate dungeons; a deliberately-broken floor file fails at boot with a named error, not a mid-tick crash.

**Watch:** the hub → dungeon handoff (`HubScene` → `joinDungeon` opts) and `run_history` semantics for late joiners both change shape here; check `agent-context/protocol.md` triggers.

## Sprint D — Real auth ✅ *(completed 2026-07-13 — verified on the hosted URL)*

Replace trust-on-first-use login. Closes H1.

- **Shipped shape: hand-rolled session tokens** (HMAC-SHA256, 7-day TTL) over username+password (scrypt hashes, migration 004) — chosen over Supabase Auth because magic-link needs an email provider and anonymous sign-in needs dashboard config + the anon key in the client. Trade-off accepted: no refresh, revocation via `AUTH_TOKEN_SECRET` rotation only. `verifyToken` (`server/auth/tokens.js`) is the single seam to swap for `supabase.auth.getUser(jwt)` later.
- Migration path shipped as link-by-username: a legacy passwordless account adopts the first password presented at login.
- Kept: playerId-keyed store internals; server-side pricing/validation (unchanged).
- Done-when met: no/expired/forged tokens rejected on every `/hub` route and on room join (`onAuth`); cross-account access 403s; `server/tests/auth.test.js` covers the rejection matrix (offline rather than as anti-cheat smoke extensions).

## Sprint E — Floor-authoring foundation + floor 4 *(partially pulled forward 2026-07-13)*

Content track begins. Closes M3's builder half, M4, and the deferred unlock-condition stopgap; unblocks workflow W2 (Floor Architect) in `content-pipeline-enablement.md`.

> Already shipped ahead of this sprint: the **unlock-condition system** (`shared/logic/unlock.js` — both stopgaps removed), **kill attribution** (`PlayerState.kills` → `run_history.kills`), and boot-time floor validation (Sprint C). Remaining here: shared floor builders, SVG preview script, floor 4, run_history multiclass column (M4).

- Extract shared floor builders (`cluster`/`buildArm`/walled-room helpers duplicated across floors 2–3) to `shared/data/floors/builders.js`; floors become short declarative files. The walled-room builder emits consistent wall segments + door rects + `rooms[].doors` entries from one declaration — the hand-correlated-geometry problem disappears into tested helpers.
- General stair/door **unlock-condition system** replacing both `lockedUntilAllEnemiesDead` and the `_permanentlyLockedStairs` Set stopgap (the `TODO(deferred)` sites in `DungeonRoom`). Data-driven: `unlock: { kind: 'enemies_cleared' | 'never' | ... }`.
- **SVG floor preview script** — `node scripts/render-floor.js <n>` draws walls/doors/platforms/steps/spawns/enemies/chests/stairs from floor data alone. The review loop for humans and the self-check loop for floor-authoring agents.
- Floor 4 as the first floor authored the new way — even if mechanically another debug clone, it proves the builders.
- Ride-alongs while the schema is open: `run_history` multiclass column (M4) and kill attribution (`PlayerState.kills` — the long-standing deferred item; small once touched).

**Done when:** floor 4 ships as a <50-LOC data file; its SVG preview matches the design sketch before the game is ever booted; all existing unlock behavior covered by tests against the new system; a multiclass extraction writes its full class breakdown to `run_history`.

## Sprint F — Monster pipeline

Closes M2; unblocks workflow W1 (Monster Smith) and gives W4 its behavior vocabulary. Two halves — split into two sessions if it runs long, engine half first.

- **AI extraction + tests (engine half):** move the state machine from `server/systems/AISystem.js` to pure `shared/logic/ai.js` (long planned in `tech_spec.md`); fixture-geometry tests for pursuit, elevation retargeting, room/door routing, wall-slide fallback. This pays the M2 test debt *before* the behavior surface grows.
- **Behavior palette (engine half):** data-driven behavior selection on the enemy def — first new behavior: **ranged attacker** (kite to preferred range, attack with the def's ranged action; the goblin's inert SRD shortbow is the pilot). Behavior kinds are engine work; defs only *select* and parameterize them.
- **Enemy validator suite (tooling half):** `shared/tests/enemies.test.js` modeled on `items.test.js` — engine-required fields present and well-formed per def, every floor-placed `type` resolves in the registry, every enemy has a loot table or an explicit `noLoot` marker, declared behaviors exist in the palette.
- **Per-def visual identity (tooling half):** if Sprint V has landed, this is just "every def carries a `spriteKey` the coverage validator accepts" (+ W7 SVG gap-fill for new monsters); if V hasn't landed yet, interim `color`/`radius` on the def read by the placeholder renderer and SVG preview.

**Done when:** a goblin actually shoots its shortbow (kites, fires, melees when cornered) with the behavior declared in `goblin.js`, not coded in `AISystem`; `enemies.test.js` fails on a def missing engine fields; AI decision logic has ≥ 20 pure tests; a new monster is visually distinct with zero client-code changes.

## Sprint G — Balance sim + pilot content wave

The proof sprint: use the tooling to ship real content via the agentic workflows. Unblocks W3 (Balance Auditor) and writes W5 (authoring guide).

- **Balance sim harness:** ✅ *(pulled forward 2026-07-13 — `scripts/balance-sim.mjs`)* headless Monte Carlo over `shared/logic/combat.js` (pure, RNG-injected — no game boot) → per class-loadout (levels 1–3 incl. subclasses) × monster × pack size: hit rates, TTK, player death probability. Deterministic seed for reproducible reports.
- **Target bands as data:** a small file declaring intended difficulty per monster (e.g. "goblin: level-1 fighter TTK 2–4 attacks"); the sim report flags out-of-band pairs.
- **Pilot content wave, run as the workflows dictate:** 2–3 new tier-1 monsters via W1 briefs (at least one using the ranged behavior), one new floor via a W2 sketch→preview→approve loop, tuned via W3. One agent session per item.
- **`docs/design/authoring-guide.md` (W5):** the designer-facing brief formats, how to read sim reports and previews, the behavior vocabulary — written now, against real tooling.

**Done when:** a monster goes from three-line brief to validated, sim-checked, floor-placed and in-game-verified without a human editing JS; the authoring guide is accurate enough that a new designer (or cold agent session) can repeat it.

## Parking lot (explicitly not scheduled)

- `InventoryScene` split (M6) — do opportunistically on next inventory feature, not as its own sprint.
- Colyseus 0.15 → current (L6) — deliberate, client+server in lockstep, after auth.
- Tiled (or in-game) visual floor editor — deliberately deferred until the floor format stabilizes; see `content-pipeline-enablement.md` §1. Sprint V's tile *rendering* does not change this — it skins the existing rect data. The builders + preview + agent-as-compiler combination covers the gap.
- R2 asset pipeline — trigger is now concrete: adopt when assets get heavy (audio, multiple atlases) or need swapping without a client redeploy. Until then `client/public/assets/` + Pages CDN suffices (Sprint V).
- Entity animation (walk cycles, facing, attack frames) and audio — natural follow-ups once Sprint V's pack is wired; scope when the pack's frame coverage is known.
- Horizontal scaling / Redis presence, matchmaking proper, Debug Mode OFF economy — all still correctly deferred; triggers unchanged from `CLAUDE.md` §Deferred Features and `tech_spec.md`.
