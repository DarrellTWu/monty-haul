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
- shared/ is the source of truth. All game logic and balance data lives here.
- Server never trusts client. Clients send inputs only; server resolves outcomes.
- No Phaser.Physics. Client renders positions from server state only.
- All tuning values are named constants in shared/data/constants.js or subclass files.
- One module per agent session. Never touch unrelated files.

## Key Commands
- `npm start` — starts both server and client together (via concurrently)
- `npm run dev` — starts Vite dev server (client) only
- `npm run server` — starts Colyseus server only
- `node shared/tests/combat.test.js` — run combat tests

## Current File Structure (Actual)
Many files in docs/tech_spec.md are planned, not yet built. What actually exists:

**Server**
- `rooms/DungeonRoom.js` — message routing + equip/loot/hotbar/trap logic
- `systems/` — CombatSystem.js, MovementSystem.js, AISystem.js (called from tick loop)
- `state/` — PlayerState, EnemyState, GameState, ChestState, TrapState
- `persistence/`, `matchmaking/` — not yet built

**Client** (no `rendering/` or `ui/` subdirectories)
- `scenes/HubScene.js` — entry point (auto-starts); stub transitions directly to DungeonScene
- `scenes/DungeonScene.js` — gameplay rendering, input wiring; receives `{ class }` via init(data)
- `scenes/HUDScene.js` — conditions, cooldown rings, hotbar overlay
- `scenes/InventoryScene.js` — equipment slots, bag, hotbar assignment UI
- `network/ColyseusClient.js` — `joinDungeon(opts)` forwards opts (incl. class) to server
- `input/InputHandler.js`

**Shared**
- `data/` — constants.js, weapons/melee.js, armor/armor.js, items/(consumables+shields), enemies/tier1.js, classes/fighter.js, classes/index.js (CLASS_REGISTRY)
- `logic/combat.js` — full attack resolution
- `tests/combat.test.js`
- `types/` — player.js, enemy.js, weapon.js
- `data/subclasses/`, `logic/conditions.js`, `logic/ai.js`, `logic/loot.js` — not yet built

## Agent Task Context
Before any game logic task, read these files:
- `shared/types/player.js` and `shared/data/constants.js` (data shapes and tuning)
- `server/state/PlayerState.js` — authoritative runtime schema. Key fields:
  - `x, y, vx, vy` — position and velocity
  - `hp, maxHp, ac, level, alive`
  - `class` — class id string (e.g. `'fighter'`); set on join from join options
  - `equippedWeaponId, offhandId, equippedArmorId` — equipment slots ('' = empty)
  - `inventory` — ArraySchema of item id strings
  - `hotbar` — ArraySchema[10] of ability/consumable ids or ''
  - `conditions` — ArraySchema of active condition id strings
  - `secondWindAvailable, blessRemainingMs, longstriderRemainingMs, falseLifeRemainingMs, tempHp`
- The specific file being modified
- A structural reference file if creating something new

## Client-Server Message Protocol
All messages handled in `DungeonRoom.js` onCreate.

**Client → Server**
- `move` `{ dx, dy }` — normalized movement direction (-1..1 each axis)
- `stop` — zero player velocity
- `attack` — attempt melee attack
- `equip` `{ itemId, slot? }` — slot: `'weapon'|'offhand'|'armor'` or omit for auto-detect
- `unequip` `{ slot }` — slot: `'weapon'|'offhand'|'armor'`
- `loot` `{ chestId }` — open chest (server validates range)
- `assign_hotbar` `{ itemId, slot }` — bind ability/consumable id to hotbar index 0–9
- `use_hotbar` `{ slot }` — activate hotbar slot 0–9

**Server → Client**
- `combat_log` `{ message }` — text line pushed to the HUD combat log

## Reference Docs (read when relevant to the task)
- docs/tech_spec.md — Full technical architecture, file structure, module details
- docs/gdd.md — Game design document, combat system, class roster, items

## Keeping Docs Current
After completing any task, flag to the user if the changes warrant updates to CLAUDE.md or docs/tech_spec.md. Triggers include:
- Files added/removed that appear in the file structure lists
- New fields on PlayerState or other synced state
- Changes to the scene entry point or scene graph
- New message protocol entries (new messages, changed payloads)
- New patterns established (new registry, new system, new architectural convention)

Don't update the docs unprompted — flag it and let the user decide.

## Code Style
- ES modules (import/export), not CommonJS (require)
- Pure functions in shared/logic/ — no side effects, no framework deps
- Randomness injected via optional rng parameter for deterministic testing
- Named constants for ALL numeric values — no bare literals in logic files