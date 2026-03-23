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
- `npm run dev` — starts Vite dev server (client)
- `npm run server` — starts Colyseus server
- `node shared/tests/combat.test.js` — run combat tests

## Agent Task Context
Before any game logic task, read these files:
- shared/types/player.js and shared/types/item.js (data shapes)
- shared/data/constants.js (tuning values)
- The specific file being modified
- A structural reference file if creating something new

## Reference Docs (read when relevant to the task)
- docs/tech_spec.md — Full technical architecture, file structure, module details
- docs/gdd.md — Game design document, combat system, class roster, items

## Code Style
- ES modules (import/export), not CommonJS (require)
- Pure functions in shared/logic/ — no side effects, no framework deps
- Randomness injected via optional rng parameter for deterministic testing
- Named constants for ALL numeric values — no bare literals in logic files