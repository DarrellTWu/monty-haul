# Monty Haul — Development Changelog

Tracks completed work, decisions, open questions, and deferred todos by session.
Entries are newest-first within each session.

---

## Session 4 — 2026-04-12

### Completed

#### SRD correctness: armor-derived AC and weapon damage display

**Problem 1 — Magic-number AC:** `FIGHTER.baseAC = 16` had no armor data behind it.
**Fix:** Created `shared/data/armor/armor.js` with all SRD armor definitions and `computeAC(armorDef, dexMod, hasShield)`. Added `startingArmorId: 'chain_mail'` to `FIGHTER`. Server now calls `computeAC(ARMOR_REGISTRY['chain_mail'], dexMod)` on join to derive `player.ac = 16`.

**Decision:** Chain Mail (heavy armor, baseAC 16, STR 13 requirement) is the SRD item that produces AC 16 with no DEX contribution. Heavy armor was chosen over medium + shield (Breastplate 14 + DEX +2 + shield = 18 would be too high) or half-plate because it matches a starting fighter loadout and the exact AC value of 16.

**Problem 2 — Weapon damage label:** `WEAPON_DISPLAY.longsword.detail` was `'1d8+3 slashing'`, presenting the STR modifier as if it were a weapon property.
**Fix:** Changed to `'1d8 slashing'`. The STR modifier is now computed from `FIGHTER_SCORES.STR` in `_refresh()` and appended as a separate label (`+3 STR`) on the equipped weapon button.

**Files changed:**
- `shared/data/armor/armor.js` — new file; all SRD armors + `computeAC` + `ARMOR_REGISTRY`
- `shared/data/classes/fighter.js` — removed `baseAC: 16`, added `startingArmorId: 'chain_mail'`
- `server/state/PlayerState.js` — added `equippedArmorId: 'string'` to schema
- `server/rooms/DungeonRoom.js` — imports `ARMOR_REGISTRY` + `computeAC`; computes AC on join; sets `player.equippedArmorId`
- `client/src/scenes/InventoryScene.js` — fixed weapon detail string; STR modifier displayed separately; armor row added to equipment panel reading from `player.equippedArmorId`

---

## Session 3 — 2026-04-11

### Completed

#### Playable room: Fighter vs. two Goblins

Built the full server-authoritative game loop to prove out the engine.

**Server:**
- `server/state/PlayerState.js` / `EnemyState.js` / `GameState.js` — Colyseus `@Schema` classes using `createRequire` + `defineTypes` pattern (required because `colyseus` and `@colyseus/schema` are CJS builds that Node.js ESM named-export synthesis cannot analyze statically)
- `server/systems/MovementSystem.js` — applies player velocity (normalized direction × `BASE_SPEED_PX_PER_SEC`) and enemy velocity (px/sec stored directly in `vx/vy`) to positions each tick; clamps to room bounds
- `server/systems/AISystem.js` — idle→aggro transition on `COMBAT_DETECTION_RADIUS`; moves toward nearest player at `def.speed` px/sec; triggers `enemyAttack` when within `MELEE_HIT_RANGE_PX`
- `server/systems/CombatSystem.js` — `playerAttack` reads weapon from `WEAPON_REGISTRY[player.equippedWeaponId]`; `enemyAttack` constructs weapon-shaped object from enemy def fields; both call `resolveAttack` + `applyDamage` from `shared/logic/combat.js`
- `server/rooms/DungeonRoom.js` — full `onCreate`/`onJoin`/`onLeave`; spawns fighter at (800,600) and two goblins at (300,300) and (1300,900); handles `move`, `stop`, `attack`, `equip`, `unequip` messages; `setSimulationInterval` ticks at `SERVER_TICK_RATE_HZ.tier1`

**Client:**
- `client/src/network/ColyseusClient.js` — singleton module; `joinDungeon()`, `sendMove()`, `sendStop()`, `sendAttack()`, `sendEquip()`, `sendUnequip()`, `getRoom()`
- `client/src/input/InputHandler.js` — WASD + arrows → move, Space → attack (keydown only), Tab → `onTabDown` callback; `this.enabled` flag suppresses move/attack while inventory is open; Tab fires through disabled state
- `client/src/scenes/DungeonScene.js` — async `create()`, joins room, renders players and enemies as colored circles (`Phaser.add.arc`) with `Graphics` HP bars; camera follows own player (gold tint); launches `HUDScene`; `_toggleInventory()` manages `InventoryScene`
- `client/src/scenes/HUDScene.js` — fixed-camera overlay; attack timer ring (circumference drawn clockwise over 3-second cooldown); color shifts orange → yellow → lime → green as ready; "ATK" label and countdown/READY text
- `client/src/scenes/InventoryScene.js` — Tab to open/close; left panel: name, level, HP, AC, ability scores; right panel: weapon slot (click = unequip) + bag (click = equip); refreshes from server state each frame

**Decisions:**
- Placeholder graphics (colored circles) used throughout; sprite replacement will be a separate pass
- Placeholder room (bordered rectangle); tilemap system (pre-built rooms + procedural combination) is a future task
- Enemy velocity stored as px/sec in `vx/vy` so `MovementSystem` applies it uniformly; player velocity stored as normalized direction and scaled in `MovementSystem`
- `vite.config.js` updated with `server: { fs: { allow: ['..'] } }` so client scenes can import from `shared/` via relative paths

**Known deferred issue:**
- Canvas appears blurry on high-DPI displays because Phaser does not set `devicePixelRatio` on the canvas by default. Fix: set `resolution: window.devicePixelRatio` in Phaser config and update scale mode accordingly. Deferred until more UI/graphics are in place.

---

#### Weapon and armor data

- `shared/data/weapons/melee.js` — `LONGSWORD`, `SHORTSWORD`, `HANDAXE`, `GREATAXE`, `UNARMED`; `damageBonus: 0` on all (ability modifier added at call site in `resolveAttack`, not baked into weapon)
- `shared/data/enemies/tier1.js` — `GOBLIN` (hp 7, ac 15, flat attackBonus 4)
- `shared/data/classes/fighter.js` — `FIGHTER` with base ability scores, `getStartingHp(conMod)`, proficiency via `getProficiencyBonus(level)` in `combat.js`

---

## Session 2 — 2026-04-10

### Completed

#### `shared/logic/combat.js` — Pure combat resolution
Implemented the full attack resolution module as specified in tech_spec.md §4 and gdd.md §3.

**Functions:**
- `rollDice(count, sides, rng)` — NdX roller; rng-injected for deterministic testing
- `getModifier(abilityScore)` — Standard SRD formula: `Math.floor((score - 10) / 2)`
- `getProficiencyBonus(level)` — Standard SRD table: `Math.floor((level - 1) / 4) + 2`
- `resolveAttack({ attacker, target, weapon, conditions, rng })` — Full d20 attack resolution
- `applyDamage({ target, damage, damageType })` — Resistance, minimum-1, overkill

**Decisions made:**
- **Natural 1 early return:** On a natural 1, the function returns immediately before consuming rng for condition bonuses (e.g., Bless d4). This avoids burning rng values on an already-resolved result. `roll` returns the raw d20 (1), not a computed total.
- **Crit mechanics:** Crit doubles the dice count via `CRIT_MULTIPLIER` (e.g., 1d8 becomes 2d8). Flat bonuses — ability modifier, enhancement, damageBonus — apply once regardless of crit. This matches SRD standard and is the most common real-table interpretation.
- **Minimum-1 in `applyDamage`, not `resolveAttack`:** `resolveAttack` returns raw damage. This lets callers distinguish "low roll" (e.g., 0 from a tiny weapon + negative modifier) from "resistance floored to 0". Both are clamped to 1 by `applyDamage`.
- **Enemy vs. player attacker detection:** Presence of `attacker.abilityScores` determines which code path runs. Players compute attack bonus from ability scores + proficiency + enhancement; enemies use a pre-computed flat `attackBonus`. No separate function or type guard needed.
- **`conditions` parameter vs. `attacker.conditions`:** The explicit `conditions` param is the canonical source for a given resolution call and overrides `attacker.conditions`. If omitted, falls back to `attacker.conditions`. This lets the caller override conditions for hypothetical calculations without mutating player state.
- **`weapon` for enemy attacks:** Not resolved in this session. Enemies carry `damageDice`/`damageBonus`/`damageType` directly. If `weapon` is null/undefined, `resolveAttack` falls back to reading those fields from `attacker`. The CombatSystem.js caller can also construct a weapon-shaped object from enemy fields — both paths work.

**TODOs left in code:**
- Vulnerability (double damage) — not in scope for Wave 1 enemies; `// TODO` comment in `applyDamage`
- Further condition attack bonuses (Guidance, Bardic Inspiration) — `// TODO` in `resolveAttack`
- Enemy attack normalization convention — `// TODO` comment at top of file for CombatSystem.js author

---

#### `shared/data/constants.js`
Created with all values from tech_spec.md §4. Constants included:
`SERVER_TICK_RATE_HZ`, `HP_MULTIPLIER`, `OOC_REGEN_RATE`, `OOC_REGEN_DELAY_MS`,
`COMBAT_DETECTION_RADIUS`, `ATTACK_COOLDOWN_MS`, `MELEE_ATTACK_RANGE_PX`,
`CRIT_MULTIPLIER`, `BASE_SPEED_PX_PER_SEC`, `DASH_SPEED_MULTIPLIER`,
`RITUAL_DURATION_MS`, `RITUAL_RADIUS_PX`, `LEVER_RESET_MS`,
`BANK_SLOTS_PER_RUN`, `LONG_REST_ON_LEVEL_UP`.

---

#### `shared/types/` — JSDoc typedefs
Three new type files, scoped to only the fields `combat.js` reads:

- **`player.js`** — `AbilityScores` + `Player` (id, hp, maxHp, ac, abilityScores, level, conditions, weaponSlot)
- **`enemy.js`** — `Enemy` (id, hp, maxHp, ac, attackBonus, damageDice, damageBonus, damageType, resistances)
- **`weapon.js`** — `DiceDef` + `Weapon` (id, damageDice, damageBonus, damageType, enhancement, attackAbility, properties)

`DiceDef` is `{ count: number, sides: number }` — explicit struct rather than a string like `"2d6"` so `rollDice` can consume it directly without parsing.

`attackAbility: 'str' | 'dex'` on Weapon tells `resolveAttack` which ability score to pull from `attacker.abilityScores`. This side-steps finesse logic for now — the caller is responsible for setting the correct value per weapon instance.

---

#### `shared/tests/combat.test.js` — 23 tests, all passing
Test runner: plain `node:assert/strict`, no framework. Run with `node shared/tests/combat.test.js`.

**RNG approach:** A `seq(...vals)` helper builds a sequence-rng from explicit float values. Each float maps to a die result via `Math.floor(rng() * sides) + 1`. A `die(n, sides)` helper computes the correct float for a target result. The `seq` rng throws if exhausted, catching under-specified tests.

**Test coverage:**
| Scenario | Tested via |
|---|---|
| Clear hit, low-AC target | `resolveAttack` |
| Clear miss, high-AC target | `resolveAttack` |
| Natural 1 auto-miss (despite math suggesting hit) | `resolveAttack` |
| Natural 20 auto-hit (despite unhittable AC) + crit double-dice | `resolveAttack` |
| Enhancement applies to attack roll and damage | `resolveAttack` |
| Bless condition via explicit `conditions` param | `resolveAttack` |
| Bless condition via `attacker.conditions` fallback | `resolveAttack` |
| Standard damage application | `applyDamage` |
| Resistance halves damage (floor) | `applyDamage` |
| Resistance does not apply to non-matching type | `applyDamage` |
| Minimum 1 damage (resistance floors 1-damage hit to 0) | `applyDamage` |
| Overkill calculated correctly | `applyDamage` |
| Exact-HP kill: newHP=0, overkill=0 | `applyDamage` |
| `getModifier` at key score values (10, 16, 8, 1) | utility |
| `getProficiencyBonus` at key level breakpoints (1, 4, 5, 17) | utility |
| `rollDice` boundary values and multi-die sums | utility |

---

#### Root `package.json` — test script added
```json
"test": "node shared/tests/combat.test.js"
```

---

## Session 1 — 2026-04-10

### Completed

#### Monorepo dependency setup
- `client/package.json` — added `phaser@^3.87.0`, `vite@^6.0.0` (dev); set `"type": "module"`
- `server/package.json` — added `colyseus@^0.15.0`, `@supabase/supabase-js@^2.0.0`; set `"type": "module"`
- `shared/package.json` — set `"type": "module"`, no runtime dependencies
- Root `package.json` — added `dev` (Vite) and `server` (Colyseus) scripts

All packages changed to `"type": "module"` (ES modules) per CLAUDE.md code style rules.

**Decision:** `@supabase/supabase-js` was installed in `server` only. The task explicitly deferred Supabase connection setup, and the client-side Supabase client (`network/SupabaseClient.js`) is a future task. The package can be added to `client` when that module is implemented.

---

#### `client/vite.config.js`
Standard Vite config, port 5173. No custom `define` block needed — Vite auto-exposes all `VITE_`-prefixed env vars to client code as `import.meta.env.*`.

---

#### `client/.env.development` and `client/.env.production`
Created with values from tech_spec.md §3.3:
- Dev: `VITE_ASSET_BASE_URL=http://localhost:5173/assets`, `VITE_COLYSEUS_URL=ws://localhost:2567`
- Prod: `VITE_ASSET_BASE_URL=https://assets.montyhaulgame.com`, `VITE_COLYSEUS_URL=wss://server.montyhaulgame.com`

These values are placeholders for the production URLs — the actual domain will need to be confirmed when Railway/Fly.io and Cloudflare R2 are provisioned.

---

#### `client/index.html`
Minimal HTML entry point. Canvas centering is delegated to Phaser's scale manager (`CENTER_BOTH`) rather than CSS flexbox, so the body only needs `width/height: 100%` and `overflow: hidden`.

---

#### `client/src/main.js` — Phaser boot
Initial: 800×600, `Phaser.AUTO`, empty scene.
Updated (same session): 1280×720, `Phaser.Scale.FIT`, `Phaser.Scale.CENTER_BOTH`. Canvas scales to fill the browser window while preserving 16:9 aspect ratio.

**Decision:** `backgroundColor: '#1a1a2e'` (dark navy) used as placeholder until art direction is confirmed for the dungeon boot screen.

---

#### `server/rooms/DungeonRoom.js`
Bare `Room` subclass with empty `onCreate`, `onJoin`, `onLeave`, `onDispose` lifecycle hooks. No state schema attached yet — that is `server/state/GameState.js` (future task).

---

#### `server/index.js`
Colyseus `Server` instance, registers `'dungeon'` room, listens on port 2567.

**Decision:** Used `colyseus@^0.15.0` (the meta-package). The 0.15.x API exposes `Server` directly from `'colyseus'` and provides a `gameServer.listen(port)` method returning a Promise. No separate `http.createServer()` call is required at this entry-point level.

---

## Open Questions & Future Decisions Needed

### Combat system
- **Advantage/Disadvantage:** Not yet implemented. Reckless Attack (Barbarian), Help action, and several conditions grant advantage (roll 2d20, take higher) or disadvantage (take lower). `resolveAttack` will need an `advantage` / `disadvantage` boolean parameter. Design question: when both apply simultaneously, they cancel out (SRD rule) — confirm this is the intended behavior before implementing.
- **Saving throws:** The SRD uses saving throws for many conditions (Stunned, Frightened, etc.). No saving throw function exists yet. Likely a thin wrapper over `rollDice(1, 20)` + ability mod + proficiency (if proficient) vs. a DC. Implement when the first condition that requires it (e.g., Wand of Entangle → Restrained) is added.
- **Sneak Attack:** Rogue's core feature. Requires knowing whether an ally is adjacent to the target OR whether the attacker has advantage. Neither adjacency nor advantage is tracked in combat.js yet. Will need positional data passed in, or a pre-computed `sneakAttackEligible` boolean from MovementSystem.
- **Vulnerability:** `applyDamage` has a `// TODO` for double-damage vulnerability. No Wave 1 enemies or items use it, but it should be added before Wave 2 (Paladin Divine Smite interacts with undead vulnerability to radiant).
- **Unarmed strikes:** `weaponSlot: null` is valid on Player, but `resolveAttack` currently requires a weapon for player attackers. Monks need unarmed strike support. Simplest path: synthesize a `weapon`-shaped object from class data (1+STR mod bludgeoning, no enhancement) at call site in CombatSystem.

### Server
- **`GameState.js` / `PlayerState.js` / `EnemyState.js`:** Colyseus `@Schema` classes for authoritative state sync. These are the next server-side task before any gameplay logic can be tested end-to-end.
- **`CombatSystem.js`:** The multiplayer wrapper that calls `resolveAttack` and broadcasts results. Needs to handle multi-attack (call `resolveAttack` N times), collect results, and apply them to `GameState`. Depends on `GameState` existing first.
- **Colyseus version:** Using `colyseus@^0.15.0`. If the project upgrades to a future major version, the `Room` import and `Server` API may change.

### Client
- **`BootScene.js`:** First real scene needed — asset preload and auth check. Depends on Supabase client setup and at least one sprite asset existing.
- **`ColyseusClient.js`:** Network layer connecting the client to the server. Until this exists, `client/src/main.js` cannot receive game state.
- **Supabase client in `client`:** `@supabase/supabase-js` is not yet installed in the `client` workspace. Add it when `network/SupabaseClient.js` is implemented.

### Infrastructure
- **Production URLs:** `VITE_ASSET_BASE_URL` and `VITE_COLYSEUS_URL` in `.env.production` are placeholders. Finalize when Railway/Fly.io (server) and Cloudflare R2 + CDN (assets) are provisioned.
- **`.gitignore`:** Not yet created. At minimum: `node_modules/`, `client/dist/`, `.env.local`, `.env.*.local`.
- **CI/CD:** Not yet configured. The tech spec mentions Vercel auto-deploy for client and Railway auto-deploy for server on merge to `main`. GitHub Actions or platform-native CI needed.
- **Wrangler CLI:** Required for R2 asset deployment (`npx wrangler r2 object put`). Not yet installed or configured.
