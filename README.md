# Monty Haul's Dungeon Crawl

2D PvPvE dungeon-crawl extraction roguelike. Browser-based, multiplayer-first.
D&D 5e SRD mechanics adapted for real-time play.

Phaser 3 client · Colyseus authoritative server · Supabase persistence · plain JS monorepo (npm workspaces).

## Quick start

```
npm install
npm start        # server (:2567) + client (:5173) together
npm run test:all # offline test suites
```

The server needs `server/.env` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Docs

- [`CLAUDE.md`](CLAUDE.md) — principles, commands, agent task context
- [`docs/README.md`](docs/README.md) — docs index ("which doc do I need?")
- [`docs/deployment-guide.md`](docs/deployment-guide.md) — hosted deployment
