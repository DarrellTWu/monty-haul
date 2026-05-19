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
- `shared/` is the source of truth. All game logic and balance data lives here.
- Server never trusts client. Clients send inputs only; server resolves outcomes.
- No Phaser.Physics. Client renders positions from server state only.
- All tuning values are named constants in `shared/data/constants.js` or subclass files.
- One module per agent session. Never touch unrelated files.

## Key Commands
- `npm start` — starts both server and client together (via concurrently). Server is launched with `--env-file=server/.env` so `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` load automatically.
- `npm run dev` — Vite dev server (client) only
- `npm run server` — Colyseus server only (also passes `--env-file=server/.env`)
- `node shared/tests/combat.test.js` — run combat tests
- `node shared/tests/loot.test.js` — run loot tests
- `node shared/tests/items.test.js` — run itemization validator (covers floors/loot/vendor/recipe reference integrity)
- `node server/tests/supabase-smoke.js` — round-trip a temp player through Supabase (requires `server/.env`)

## File Structure
Canonical layout lives in [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md). Single source of truth — do not duplicate file listings here or in `docs/tech_spec.md`.

Quick orientation:
- **`server/`** — Colyseus authoritative room (`rooms/DungeonRoom.js`), tick systems (`systems/`), state schemas (`state/`), hub HTTP routes (`routes/hub.js`), persistence (`persistence/`, write-through cache in `store/playerStore.js`).
- **`client/`** — Phaser scenes (`scenes/HubScene.js`, `DungeonScene.js`, `HUDScene.js`, `InventoryScene.js`), hub panel modules (`ui/hub/` — Login/Settings/Class/Stash/Shop/Craft/Raider + `hub-data.js`), gameplay rendering (`rendering/RoomRenderer.js`), input (`input/`), network (`network/`), server-backed store (`store/stash.js`).
- **`shared/`** — Pure logic + balance data. `data/` (constants, weapons, items, classes, enemies, floors, loot, crafting, shop), `logic/` (combat, equipment, character, loot, loot-window, geometry — all framework-free, RNG-injected), `tests/` (pure unit tests).
- **`supabase/migrations/`** — versioned schema.

## Docs Map — read when relevant to your task
Index: [`docs/README.md`](docs/README.md).

| Task touches… | Read |
|---|---|
| combat, classes, ability scores, loadout | `docs/agent-context/combat.md` |
| walls, doors, platforms, elevation, high-ground | `docs/agent-context/geometry-elevation.md` |
| floors, descend, long rest, extraction scroll | `docs/agent-context/floors.md` |
| shop, crafting, hub gold, stash, Debug Mode | `docs/agent-context/hub-economy.md` |
| inventory, hotbar, containers, loot tables | `docs/agent-context/inventory-loot.md` |
| item defs, registry, display strings, gold values, recipes-as-data | `docs/agent-context/itemization.md` |
| Supabase, retry, dead-letter, run history | `docs/agent-context/persistence.md` |
| client↔server messages or `/hub` HTTP routes | `docs/agent-context/protocol.md` |
| target/planned architecture | `docs/tech_spec.md` |
| design intent (not yet built) | `docs/design/gdd.md`, `docs/design/gdd_crafting.md` |
| current code/docs critique | `docs/architecture-review-2026-05-14.md` |

Historical sprint plans live in `docs/archive/` — do not edit; may be stale.

## Agent Task Context
Before any game logic task, read these files:
- `shared/types/player.js` and `shared/data/constants.js` (data shapes and tuning)
- `server/state/PlayerState.js` — authoritative runtime schema. Key fields:
  - `x, y, vx, vy` — position and velocity
  - `hp, maxHp, ac, level, alive`
  - `class` — class id string (e.g. `'fighter'`); set on join from join options
  - `equippedWeaponId, offhandId, equippedArmorId` — equipment slots (`''` = empty)
  - `inventory` — ArraySchema of item id strings
  - `hotbar` — ArraySchema[10] of ability/consumable ids or `''`
  - `conditions` — ArraySchema of active condition id strings
  - `secondWindAvailable, blessRemainingMs, longstriderRemainingMs, falseLifeRemainingMs, tempHp`
  - `rageRemainingMs, rageUsesRemaining` — Barbarian rage tracking (synced for HUD ring + inventory)
  - `gold` — run-scope wallet; committed via `playerStore.commitExtract` on extract, lost on death/disconnect
  - `str, dex, con, int, wis, cha` — ability scores; set on join from client point-buy (validated server-side via `validateAbilityScores` in `shared/logic/character.js`); fall back to `classDef.baseAbilityScores` if invalid. Mutable during run. Call `recomputeStats(player)` (from `shared/logic/equipment.js`) after any change.
  - `elevation` — 0 = ground, 1 = elevated. Synced. Seeded on join + descend by `DungeonRoom._spawnElevation(x, y)`; mutated each tick by `MovementSystem.tryAutoClimb`. See `docs/agent-context/geometry-elevation.md`.
- `server/state/EnemyState.js` — synced enemy schema:
  - `lootGold, lootItems, looted` — populated on first tick after death via `rollLoot`; `looted` bidirectional (flips back if items dropped in)
  - `lockedBy` — sessionId of player holding loot-window lock (`''` = free); cleared by `tickContainerLocks` or `releaseLocksHeldBy`
  - `elevation` — same semantics as PlayerState. Seeded by `_loadFloor`.
- The specific file being modified
- A structural reference file if creating something new

## Deferred Features (intentional gaps in the current build)
Marked as **DEFERRED** in relevant agent-context docs. When you add code that overlaps with one, drop a `// TODO(deferred): <description> — see docs/agent-context/<file>.md` comment.

- Kill attribution — `PlayerState.kills` not implemented; `run_history.kills` always 0. See `agent-context/combat.md`.
- Debug Mode OFF (production gameplay path) — locked toggle, awaits matchmaking + production loot tuning. See `agent-context/hub-economy.md`.

## Keeping Docs Current
After completing any task, flag to the user if the changes warrant updates. Triggers:
- Files added/removed → `docs/PROJECT_STRUCTURE.md`
- New fields on `PlayerState` or other synced state → `docs/agent-context/combat.md` (or relevant topical)
- New message protocol entry or changed payload → `docs/agent-context/protocol.md`
- New patterns (new registry, new system, new architectural convention) → relevant agent-context file
- New feature shipped → flip status frontmatter on the relevant doc; archive the sprint plan to `docs/archive/`

Don't update the docs unprompted — flag it and let the user decide.

**Before doing non-trivial doc work** (new agent-context file, restructure, new sprint plan) read [`docs/DOC_PRINCIPLES.md`](docs/DOC_PRINCIPLES.md). It captures the principles + reasoning behind the current docs structure — what is canonical where, why agent-context vs archive, how "See also" should be written, what frontmatter conventions to use. Helps avoid drift as the project grows.

## Doc Status Convention
Every doc carries YAML frontmatter:
```yaml
---
status: shipped | in-progress | deferred | design-only | archived
updated: YYYY-MM-DD
purpose: one-line summary
---
```
Treat `design-only` and `archived` docs as context, not binding spec — current behavior lives in `PROJECT_STRUCTURE.md` and `agent-context/`.

## Code Style
- ES modules (`import`/`export`), not CommonJS
- Pure functions in `shared/logic/` — no side effects, no framework deps
- Randomness injected via optional rng parameter for deterministic testing
- Named constants for ALL numeric values — no bare literals in logic files
- Phaser scenes are singletons: `scene.stop()` destroys gfx but the JS instance persists, so instance fields populated in `create()` outlive the session. Any field that's set conditionally (loot-mode-only widgets, panel-tab-only rows) must be reset on `shutdown` or unconditionally re-initialized at the top of the next `create()` — otherwise `_refresh` touches destroyed gfx and Phaser throws inside `updateText`/`drawImage`.
