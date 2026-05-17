---
status: shipped
updated: 2026-05-17
purpose: Docs index. First stop for "which doc do I need?"
---

# Docs Index

## Read before any task
- [`../CLAUDE.md`](../CLAUDE.md) — principles, stack, commands, agent task context
- [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) — canonical file layout

## Read before non-trivial doc work
- [`DOC_PRINCIPLES.md`](DOC_PRINCIPLES.md) — principles + reasoning behind the current docs structure. Read this before adding a new doc, restructuring existing docs, or introducing a new system that needs documentation. Includes a checklist for "adding a new system."

## Read when your task involves...

| Task touches… | Read |
|---|---|
| combat resolution, classes, ability scores, loadout | [`agent-context/combat.md`](agent-context/combat.md) |
| walls, doors, platforms, steps, elevation, high-ground advantage | [`agent-context/geometry-elevation.md`](agent-context/geometry-elevation.md) |
| floors, descend, long rest, Scroll of Extraction | [`agent-context/floors.md`](agent-context/floors.md) |
| shop, crafting, hub gold, stash mutations, Debug Mode toggle | [`agent-context/hub-economy.md`](agent-context/hub-economy.md) |
| inventory, hotbar, containers (chests/corpses), loot tables | [`agent-context/inventory-loot.md`](agent-context/inventory-loot.md) |
| Supabase, retry, dead-letter, run history, rename | [`agent-context/persistence.md`](agent-context/persistence.md) |
| client↔server messages or `/hub` HTTP routes | [`agent-context/protocol.md`](agent-context/protocol.md) |

## Architecture & review
- [`tech_spec.md`](tech_spec.md) — high-level architecture, target/planned systems, design rationale
- [`architecture-review-2026-05-14.md`](architecture-review-2026-05-14.md) — current code/docs critique with prioritized recommendations

## Design (intent — not yet implementation)
> These describe scope larger than what is built. Use as design context, not binding spec.
- [`design/gdd.md`](design/gdd.md) — Game design document, combat system, class roster, items
- [`design/gdd_crafting.md`](design/gdd_crafting.md) — Crafting & itemization GDD

## Historical (do not edit; may be stale)
- [`archive/server-persistence-plan.md`](archive/server-persistence-plan.md) — Phase 0–3 persistence build (shipped)
- [`archive/geometry-sprint-plan.md`](archive/geometry-sprint-plan.md) — Walls/doors/platforms/elevation sprint (shipped)
- [`archive/hub-settings-plan.md`](archive/hub-settings-plan.md) — Settings panel sprint (shipped)
- [`archive/inventory-system-plan.md`](archive/inventory-system-plan.md) — Inventory + hotbar sprint (shipped)
- [`archive/loot-system-plan.md`](archive/loot-system-plan.md) — Loot tables + container protocol (shipped)
- [`archive/floor-2-plan.md`](archive/floor-2-plan.md) — Floor system + Scroll of Extraction (shipped)
- [`archive/character-creation-plan.md`](archive/character-creation-plan.md) — Point-buy + ability scores (shipped)
- [`archive/conditions-refactor-plan.md`](archive/conditions-refactor-plan.md) — `shared/logic/conditions.js` extraction (shipped)
- [`archive/target-selection-plan.md`](archive/target-selection-plan.md) — Click + Tab target selection (shipped)
- [`archive/ranged-combat-plan.md`](archive/ranged-combat-plan.md) — Shortbow + longbow + LoS + advantage tri-state (shipped)
- [`archive/advantage-architecture-plan.md`](archive/advantage-architecture-plan.md) — Advantage/disadvantage tri-state design (executed in ranged-combat sprint)
- [`archive/2026_05_10_proposed_work.md`](archive/2026_05_10_proposed_work.md) — Superseded work proposal

## Conventions

### Doc frontmatter
Every doc starts with YAML frontmatter:
```yaml
---
status: shipped | in-progress | deferred | design-only | archived
updated: YYYY-MM-DD
purpose: one-line summary of when to read this doc
---
```

### Deferred-feature signaling
Features that are described in docs but not built should be marked **DEFERRED** in prose and (when work begins) tagged in code with:
```js
// TODO(deferred): <short description> — see docs/agent-context/<file>.md
```
Current deferred items: kill attribution, Debug Mode OFF (production gameplay path).
