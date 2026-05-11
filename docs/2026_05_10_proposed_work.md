# Proposed Work — 2026-05-10
*Internal reference. Captured at the close of the Phase 3 hardening session. Treat as input, not commitment.*

---

## Context at the time of writing

Phase 3 server-persistence hardening is fully complete:
- Per-player mutation lock, server-authoritative pricing, `run_history` writes, retry/backoff, dead-letter queue, atomic-safe sync via UPSERT + DELETE-NOT-IN.
- 232 tests passing across the project.
- See `docs/server-persistence-plan.md` for the full history.

The persistence layer is no longer the bottleneck. The project's two arcs sit like this:

- **Design arc** — itemization, monsters, graphics, maps, content. Biggest pent-up demand. `run_history` now lands data, combat/loot are solid, hub economy works, registries are pure data. Nothing infrastructural blocks adding content.
- **Infrastructure arc** — multi-crawler runs. Gated on matchmaking, which is its own greenfield project. Late-join weirdness was the visible symptom. Not worth touching until you actually want multi-crawler playtests.

---

## Candidates ranked by leverage

| # | Item | Effort | Why this slot |
|---|---|---|---|
| 1 | **Conditions refactor → `shared/logic/conditions.js`** | ~2 hrs | Condition timer code is hand-rolled and scattered across `_useConsumable`, `_tickConditions`, `_longRest` in `DungeonRoom.js`. Every new ability duplicates the pattern. Extracting now pays for itself the moment subclasses or new potions land. Pure refactor, no behavior change. |
| 2 | **First subclass (one of the three existing classes)** | ~1 day | Class schema is already clean. SRD has obvious material (Champion Fighter, Berserker Barbarian, Open Hand Monk). Validates the schema can carry subclass-specific abilities. Best done AFTER #1 — abilities use the new conditions module. Visible playtest value. |
| 3 | **Floor 3 as real designed content** | ~half day | Floor 2 is "tuned for combat testing — not final design." Authoring a thematic floor 3 stress-tests whether floor data is expressive enough (new enemy types? new chest semantics?). Pure data work. |
| 4 | **Kill attribution + populate `kills` in `run_history`** | ~2 hrs | Column exists, always 0. Decide attribution model (last-hit recommended), thread through `CombatSystem`. Now-useful for design analytics. |
| 5 | AI module → `shared/logic/ai.js` | 2–3 days | Current chase-and-attack in `server/systems/AISystem.js` is shallow. Extracting to a pure-logic module would unlock ranged enemies, kiting, formations. Big effort; defer until #1–#3 saturate. |
| 6 | Recipe acquisition system (per `docs/gdd_crafting.md`) | 2+ days | Gated on a design pass for rates/economy. Currently all recipes are statically available. Per the GDD, players should find recipes in dungeons. |
| 7 | Matchmaking / lobby | 3+ days | Gated on real multi-crawler intent. Big effort; designs needed for party formation, lobby UI, late-join policy, disconnect/reconnect. |

---

## Strongest recommendation

**Do #1 then #2 as a pair.**

- The refactor is low-risk and the subclass is the proof point that validates it.
- Together they unlock the next 2–5 subclasses as mostly data work — the highest-leverage shape for design iteration.
- Hits the design arc squarely, where pent-up demand is largest.

**Alternative shape** if the goal is pure content with no system surface area: **#3 (floor 3)** is the most contained "fresh thing to playtest" you can ship. Doesn't unblock as much downstream, but lower commitment.

**Quick wins available any time** if a partial-day slot opens up: **#4 (kill attribution)** or polish on the dead-letter recovery flow.

---

## Items NOT on the list (and why)

- **More persistence work.** The plan in `docs/server-persistence-plan.md` is complete; the only follow-ups (auto-replay of dead-letter, gear_events table, RLS policies, Supabase Auth) are explicitly deferred pending real users.
- **CI / test runner adoption.** Tests run cleanly via `node` at the moment. Adopting jest/vitest is on the spec roadmap but adds a build step without changing what's testable.
- **Asset pipeline / Cloudflare R2.** High visual impact but premature without art direction decided.
- **TypeScript migration.** Spec is explicit: plain JS with JSDoc. Don't revisit.
- **Floor generator.** Designs in the spec, but procedural floors are downstream of having enough authored content to know what "good" looks like.

---

## Open design questions worth flagging

These don't gate any specific item above, but show up as soon as you start adding content:

- **Kill attribution semantics.** Last-hit is simplest but punishes support play. Damage-share-weighted is fairer but more state. Decide before #4.
- **Subclass acquisition.** Spec mentions subclasses as a meta-progression unlock. Currently the class registry is open access. Before #2, decide whether the first subclass is hub-purchasable, run-rewarded, or auto-available at level 3.
- **What does "level" mean in this game?** PlayerState has a `level` field that's always 1. SRD subclass features kick in at levels 3 / 6 / 10. Pick a leveling model (XP? per-floor? hub-purchased?) before features that key off it.

---
*This file is a snapshot, not a backlog. Feed it into future planning as needed.*
