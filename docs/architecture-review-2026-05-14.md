---
status: shipped
updated: 2026-05-14
purpose: Architecture + documentation review. Findings only — no code/doc changes made by the review itself. Driver for the doc restructure in this commit.
---
# Architecture & Documentation Review — 2026-05-14

Scope: full project walk-through of `C:\projects\monty-haul`. Findings only — no code or doc changes made.

---

## 1. Top-Level Layout

Monorepo via npm workspaces: `client/` (Phaser + Vite), `server/` (Colyseus + Express), `shared/` (pure JS logic + data + tests), `supabase/` (migrations), `docs/` (11 files, ~4115 LOC). Plain JS + JSDoc, ES modules throughout. Stack matches the spec in CLAUDE.md.

File sizes worth flagging up front:

| File | LOC | Verdict |
|---|---|---|
| `client/src/scenes/HubScene.js` | ~1200 | **Oversized** |
| `server/rooms/DungeonRoom.js` | ~816 | **God object** |
| `client/src/scenes/DungeonScene.js` | ~701 | Borderline |
| `docs/tech_spec.md` | ~853 | Largely duplicates CLAUDE.md |
| `CLAUDE.md` | ~254 | Token-heavy in places |
| Pure logic modules (combat/loot/geometry/loot-window) | 84–270 each | Exemplary |

---

## 2. Architecture Critique

### 2.1 `DungeonRoom.js` is a god object (HIGH)
Bundles three responsibilities in one 816-line file:
1. Colyseus lifecycle (onCreate / onJoin / onLeave / onDispose)
2. ~11 message handlers (move, attack, equip, unequip, open/close/take/drop, descend, hotbar) — ~400 LOC
3. Tick simulation orchestration + loot rolling + trap activation + stair unlock + floor swap + long rest

Equip/unequip slot logic is duplicated inline rather than living in a `shared/logic/equipment.js`. Descend logic hardcodes floor swap + spawn + long rest inline at the handler site instead of calling a `descendTo(state, floor)` function. The room violates the project's own stated rule: "one module per agent session."

**Suggested split:** `equipment.js` (pure), `descendHandler.js` (server-side), `lootDeath.js`. Reduces `DungeonRoom` to a thin router (~300 LOC).

### 2.2 `HubScene.js` is a UI framework masquerading as a scene (HIGH)
1200 lines housing: login screen, class panel + 27-pt point-buy UI, stash panel, shop panel, craft panel, raider config panel, settings modal (two modes: menu / rename) with its own keyboard handler. Each sub-panel is a 50–150-LOC private method (`_buildClassPanel`, `_buildStashPanel`, etc.). A single `create()` is unreadable.

**Suggested split:** dedicated `LoginPanel.js`, `ClassPanel.js`, `StashPanel.js`, `ShopPanel.js`, `CraftPanel.js`, `SettingsPanel.js` files. `HubScene` becomes a ~300 LOC orchestrator.

### 2.3 `DungeonScene.js` (MEDIUM)
701 lines is borderline. The lifecycle/sync code is clean. The ~150 LOC of room rendering (`_drawRoom`, `_drawDoorBand`, platform/step/wall painting) should be extracted to a `RoomRenderer.js` so visual-constant changes are isolated from scene logic.

### 2.4 `playerStore.js` is well-designed (no action)
Per-player `_withLock` correctly serializes mutations. Write-through cache pattern is clean. Dead-letter on persistence failure is good defensive design. Minor nit: no lock-contention or wait-time logging.

### 2.5 Pure logic modules are excellent (no action)
`shared/logic/combat.js`, `geometry.js`, `loot.js`, `loot-window.js` — all framework-free, RNG-injected, well-commented. Tests exercise them directly. This is the layer the rest of the codebase should be modeled after.

---

## 3. Cross-Cutting Issues

### 3.1 Inconsistent async return shapes (LOW)
`renameUser()` returns `{ ok, username?, error? }`; `buyItem()`/`sellItem()`/`craftRecipe()` return plain booleans. UI can't show specific error messaging for buy/sell/craft failures. Normalize to `{ ok, error? }` everywhere — single mapping layer in `HubAPI.js`.

### 3.2 Ability score validation duplicated, server-side incomplete (MEDIUM)
- HubScene: point-buy UI enforces 27 budget + 8–16 range.
- DungeonRoom `_validateAbilityScores`: only checks the keys exist; does **not** enforce the budget or range.

A crafted client could send `{ str: 20, ... }` and have it accepted. Move to `shared/logic/character.js` `validateAbilityScores(scores)`, import in both places. This is the one spot I found where the "server never trusts client" rule is materially weak.

### 3.3 Elevation flow is implicit (LOW)
Elevation is set in 4 places (DungeonRoom `_spawnElevation`, MovementSystem `tryAutoClimb`, DungeonScene render depth, data flags `canClimb`). The causal chain isn't centrally documented. CLAUDE.md describes the *what* but not the *flow*.

### 3.4 Deferred features are unmarked (LOW)
- Kills attribution: always 0, no `TODO`.
- `isLineBlocked` in geometry.js: stub returning false, no `TODO`.
- `shared/data/conditions.js`: referenced in CLAUDE.md as planned, doesn't exist; condition timers hand-rolled in DungeonRoom.

Add explicit `// TODO` markers — agents reading the code can't currently tell stubbed-future-feature from finished code.

### 3.5 Floor data has no schema validation (LOW)
`_loadFloor` assumes `floor.enemies`, `floor.platforms`, etc. all exist. A malformed floor file crashes at iteration. A `validateFloorData()` at server startup would catch authoring errors early.

---

## 4. Test Coverage

| Layer | Tests | Verdict |
|---|---|---|
| Shared pure logic | 138 (combat, loot, geometry, with-retry, dead-letter) | Excellent |
| Server state / locks | 56 (container, loot-flow) | Good |
| Server + Supabase smoke | 116 (supabase, concurrency, anti-cheat, rename, run-history) | Good |
| AISystem | 0 | **Gap** |
| Client (any scene) | 0 | **Gap** |
| Client↔server integration | 0 | **Gap** |

Phaser UI testing is awkward but the critical flows (login → class select → enter dungeon, stash mutations, rename modal) could be exercised with a thin Phaser mock. AISystem (elevation routing, room-aware pursuit, wall sliding) is only covered implicitly via manual play.

---

## 5. Documentation Review

### 5.1 `docs/` inventory

| File | LOC | Status | Issue |
|---|---|---|---|
| `tech_spec.md` | 853 | Current | **Duplicates CLAUDE.md "Current File Structure" almost verbatim** |
| `gdd.md` | 524 | Mar 2026 | No timestamp; class ability scores drift from code |
| `gdd_crafting.md` | 604 | Conceptual | Ahead of implementation; 4 of 6 benches are placeholders |
| `server-persistence-plan.md` | 704 | Complete | Historical audit trail; should be marked archived |
| `geometry-sprint-plan.md` | 421 | Current | Matches code; good template for sprint docs |
| `hub-settings-plan.md` | 271 | Current | Matches code |
| `inventory-system-plan.md` | 215 | Current | Matches code |
| `loot-system-plan.md` | 176 | Current | Matches code |
| `character-creation-plan.md` | 171 | Current | Matches code |
| `floor-2-plan.md` | 109 | Current | Matches code |
| `2026_05_10_proposed_work.md` | 67 | **Stale** | No completion markers; status unclear |

### 5.2 Doc-level problems

1. **`tech_spec.md` and `CLAUDE.md` duplicate the file structure section.** Pick one as source of truth. Recommend extracting it to `PROJECT_STRUCTURE.md` and having both reference it. Currently if structure changes, two files drift.
2. **No timestamps on most docs.** `gdd.md` references "March 2026" in prose only.
3. **Sprint plan archival is ad-hoc.** Completed sprints (persistence, hub-settings, geometry) live alongside active conceptual docs (`gdd_crafting.md`). Move completed to `docs/archive/` or add an explicit `Status: complete` header line.
4. **`2026_05_10_proposed_work.md` is orphaned.** Either close it, link the resulting commits/PRs, or move to archive.

### 5.3 `CLAUDE.md` critique (token efficiency for coding agents)

CLAUDE.md is loaded into every agent context. ~7500 tokens currently. Strengths: "General Good Code Practices" (lines 1–51) is gold — every agent should read this. "Agent Task Context" pointing at specific files before coding is exactly right.

Weaknesses for token efficiency:

- **"Current File Structure (Actual)" (~50 lines)** is dense paragraph prose. A table form would be ~15 lines. ~10% of CLAUDE.md savable.
- **`DungeonRoom.js` paragraph** is a 200-word run-on. Bullet form would halve length and improve scannability.
- **`playerStore.js` paragraph** packs cache + sync + lock + pricing + run history + dead-letter into two paragraphs. Bullets, again.
- **Test file enumeration** with per-file line counts is reference data, not orientation data — better as a one-line summary ("11 test files, 263 tests; see `server/tests/` and `shared/tests/`").
- **Floor system / Hub economy / Geometry sections** are excellent for an agent doing those features, but every agent loads them every time. Consider: a slim core CLAUDE.md (~80 lines) + a `docs/agent-context/{geometry,floors,economy}.md` set, with CLAUDE.md telling agents *which* doc to read for which task.

Rough estimate: a restructured CLAUDE.md could drop to ~150 LOC (~4500 tokens) without losing any agent-actionable info, by moving feature-specific deep-dives into pointed reference docs.

### 5.4 Doc setup score for coding agents

**Strengths**
- CLAUDE.md is opinionated about *how* to code (principles + style).
- "Agent Task Context" tells agents *which files to read first* — high-value pattern.
- Sprint plan docs are concrete and code-accurate.
- "Reference Docs" section gives a manifest, not just a folder dump.

**Weaknesses**
- Duplication between CLAUDE.md and `tech_spec.md` doubles maintenance cost and risks drift.
- No archive boundary between "current" and "historical" docs.
- CLAUDE.md tries to be both quick-orientation and deep-reference; the deep-reference parts inflate every prompt.
- GDD-level design docs describe scope larger than what's built; no marker distinguishing "intended" from "implemented" — agents may treat both as binding.

---

## 6. Prioritized Recommendations

**High (do before next major feature)**
1. Extract equip/unequip + descend handlers out of `DungeonRoom` into shared/server modules.
2. Split `HubScene` into per-panel modules.
3. Add server-side ability-score validation (budget + range) in `shared/logic/character.js`.

**Medium**
4. Extract `RoomRenderer` from `DungeonScene`.
5. Normalize client mutation return shape to `{ ok, error? }`.
6. Consolidate `tech_spec.md` "Files That Exist Today" with CLAUDE.md "Current File Structure" into a single `PROJECT_STRUCTURE.md`; both reference it.
7. Move completed sprint plans to `docs/archive/`; add `Status:` header to each plan doc.
8. Mark deferred features with explicit `TODO` comments at the code site (kills, `isLineBlocked`, conditions module).

**Low**
9. Trim CLAUDE.md to a ~150-LOC core + topical reference docs in `docs/agent-context/`.
10. Add floor data schema validation at server startup.
11. Add a minimal client test harness for HubScene flows + AISystem unit tests for elevation/room routing.
12. Add timestamps + `Status:` header to all docs.

---

## 7. Summary Scorecard

| Area | Status |
|---|---|
| Shared logic + data | Excellent |
| Persistence layer (playerStore, withRetry, dead-letter) | Excellent |
| Test coverage (shared + server) | Good |
| `DungeonRoom.js` | **God object — needs split** |
| `HubScene.js` | **Oversized — needs split** |
| `DungeonScene.js` | Borderline; geometry rendering extractable |
| Client mutation API consistency | Inconsistent |
| Server-side ability score validation | **Incomplete — material trust gap** |
| Client tests / AI tests / integration tests | Absent |
| CLAUDE.md | Comprehensive but token-heavy |
| Docs directory | Useful but redundant w/ CLAUDE.md, no archive boundary |
| Sprint plan docs | Exemplary |
| Deferred-feature signaling in code | Missing TODOs |
