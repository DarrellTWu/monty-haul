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
- `node shared/tests/loot.test.js` — run loot tests

## Current File Structure (Actual)
Many files in docs/tech_spec.md are planned, not yet built. What actually exists:

**Server**
- `rooms/DungeonRoom.js` — message routing + equip/loot/hotbar/trap logic; rolls loot on enemy death and handles `loot_corpse`
- `systems/` — CombatSystem.js, MovementSystem.js, AISystem.js (called from tick loop)
- `state/` — PlayerState, EnemyState, GameState, ChestState, TrapState
- `persistence/`, `matchmaking/` — not yet built

**Client** (no `rendering/` or `ui/` subdirectories)
- `scenes/HubScene.js` — entry point (auto-starts); two-panel layout: left cycles sub-screens (Class, Stash), right is persistent Raider Config + Enter Dungeon; screen-level VAULT display (top-right) shows hub gold; passes `{ class, items }` to DungeonScene; auto-opens Stash tab when `init({ view: 'stash' })`
- `scenes/DungeonScene.js` — gameplay rendering, input wiring; receives `{ class, items }` via init(data); detects run complete/death, shows run summary overlay, calls `setRaiderPack` and `addHubGold(player.gold)` on extract; F-key triggers `_tryLootNearby` which dispatches to chest or corpse; lootable corpses render dim gold with an "F: Loot" hint
- `scenes/HUDScene.js` — conditions, cooldown rings, hotbar overlay
- `scenes/InventoryScene.js` — equipment slots, bag, hotbar assignment UI; shows live `GOLD N gp` line under HP/AC; renders materials (skeleton_bone, wolf_pelt) in the bag
- `network/ColyseusClient.js` — `joinDungeon(opts)` forwards opts (incl. class + items) to server; `sendLoot` (chests), `sendLootCorpse` (corpses)
- `input/InputHandler.js`
- `store/stash.js` — localStorage-backed item store; two containers (stash + raider pack) plus persistent hub gold (`mh_hub_gold`); `getStash`, `getRaiderPack`, `stashToRaider`, `raiderToStash`, `getRaiderPackFlat`, `setRaiderPack`, `getHubGold`, `addHubGold`, `setHubGold`; seeded with all items + 0 gold on first load; designed for drop-in Supabase swap

**Shared**
- `data/` — constants.js, weapons/melee.js, armor/armor.js, items/(consumables+shields+materials), enemies/tier1.js, classes/fighter.js, classes/barbarian.js, classes/monk.js, classes/index.js (CLASS_REGISTRY), loot/tier1.js (LOOT_TABLE_REGISTRY)
- `logic/combat.js` — full attack resolution
- `logic/loot.js` — pure `rollLoot(table, rng?)` returning `{ gold, items }`; supports literal item ids and `@pool` references (currently `@potion_any`)
- `tests/combat.test.js`, `tests/loot.test.js`
- `types/` — player.js, enemy.js, weapon.js
- `data/subclasses/`, `logic/conditions.js`, `logic/ai.js` — not yet built

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
  - `rageRemainingMs, rageUsesRemaining` — Barbarian rage tracking (synced for HUD ring + inventory)
  - `gold` — run-scope wallet; transferred to hub via `addHubGold` on extract, lost on death
- `server/state/EnemyState.js` — synced enemy schema. Loot fields:
  - `lootGold, lootItems, looted` — populated on first tick after death from `LOOT_TABLE_REGISTRY[type]` via `rollLoot`; `looted` flips true when a player picks up the corpse via `loot_corpse`
- The specific file being modified
- A structural reference file if creating something new

## Class Definition Schema
Each class file exports a const with these fields (see fighter.js / monk.js as reference):
- `id` — string key matching CLASS_REGISTRY entry
- `hitDie` — e.g. 10 for fighter, 8 for monk
- `baseAbilityScores` — `{ str, dex, con, int, wis, cha }` — used for attack rolls, saves, and AC
- `getStartingHp(conMod)` — function returning starting HP
- `startingWeaponId`, `startingArmorId` — item ids ('' = none)
- `unarmoredDefense` — optional string key into baseAbilityScores (e.g. `'wis'` for monk). When set and player has no armor and no shield, AC = 10 + DEX mod + [stat] mod. Handled in DungeonRoom `onJoin` and `_recomputeAC`.
- `saveProficiencies` — array of ability keys
- `fightingStyle` — string or null; passed to CombatSystem for Dueling bonus etc.
- `classFeatures` — array of ability ids seeded into hotbar slots 0–N on join (e.g. `['rage']`)
- `rageUses` — optional number of rage uses (Barbarian only for now)
- `feat` — starting feat id string

## Loadout Model
`DungeonRoom.onJoin` branches on `options.items.length`:
- **Empty** → class default weapon/armor equipped, bag empty (free starter loadout)
- **Non-empty** → no class defaults; items go to bag, server auto-equips first weapon/armor/shield, auto-assigns consumables to hotbar

Class default gear extracted at run-end enters the raider pack normally and triggers the non-empty branch on the next run.

## Client-Server Message Protocol
All messages handled in `DungeonRoom.js` onCreate.

**Client → Server**
- `move` `{ dx, dy }` — normalized movement direction (-1..1 each axis)
- `stop` — zero player velocity
- `attack` — attempt melee attack
- `equip` `{ itemId, slot? }` — slot: `'weapon'|'offhand'|'armor'` or omit for auto-detect
- `unequip` `{ slot }` — slot: `'weapon'|'offhand'|'armor'`
- `loot` `{ chestId }` — open chest (server validates range)
- `loot_corpse` `{ enemyId }` — take gold + items from a dead enemy (server validates dead, !looted, in range)
- `assign_hotbar` `{ itemId, slot }` — bind ability/consumable id to hotbar index 0–9
- `use_hotbar` `{ slot }` — activate hotbar slot 0–9

**Server → Client**
- `combat_log` `{ message }` — text line pushed to the HUD combat log

## Loot System
- Tables live in `shared/data/loot/tier1.js` keyed by enemy id (LOOT_TABLE_REGISTRY).
- Each table: `{ gold: { dice, bonus } | null, drops: [{ itemId, chance, qty }] }`.
- `itemId` accepts literal ids OR `@pool_name` references resolved by `shared/logic/loot.js` (currently only `@potion_any` → CONSUMABLE_REGISTRY). Add new pools to the POOLS map in loot.js.
- DungeonRoom._tick calls `_rollLootForFreshDeaths()` each tick — idempotent via `_lootRolled` Set guard. Enemies with no table drop nothing silently.
- All numeric tuning (dice, chances, gold ranges) lives in the table file, not in logic.

## Reference Docs (read when relevant to the task)
- docs/tech_spec.md — Full technical architecture, file structure, module details
- docs/gdd.md — Game design document, combat system, class roster, items
- docs/loot-system-plan.md — loot tables, gold tracking, corpse looting design and build plan

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