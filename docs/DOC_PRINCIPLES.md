---
status: shipped
updated: 2026-05-14
purpose: Principles + reasoning behind the docs structure. Read before adding a new doc, restructuring existing docs, or introducing a new system that needs documentation.
---

# Documentation Principles

These are **principles, not rules.** Each one includes the reasoning so you can judge when it applies and when an exception is warranted. The structure they describe was established 2026-05-14 (see `architecture-review-2026-05-14.md` and the same-day restructure commits). Push back on any of them if a specific situation makes them harmful — but do so deliberately, not by accident.

---

## 1. Three-layer doc model

```
docs/
├── agent-context/    LIVE  — current behavior, loaded on demand
├── archive/          FROZEN — completed sprint plans, design rationale, "what was rejected"
└── design/           INTENT — GDDs describing scope ahead of build
```

**Why three layers, not one:** these directories carry **different freshness contracts**. Agent-context tracks current code; archive is frozen at sprint completion; design describes intent that may or may not ship. Mixing them in one folder forces every reader to read frontmatter or filenames carefully to know which is which. Separating them lets the directory name itself signal the contract.

**When to break this:** if a doc genuinely spans layers (e.g. a partially-shipped sprint that still has active TODO items), don't force it into one bucket — split it.

---

## 2. CLAUDE.md is orientation, not depth

CLAUDE.md is loaded into every prompt. Every line costs tokens × every agent × every task.

**Keep in CLAUDE.md:** principles (Think Before Coding, Simplicity First, etc.), tech stack one-liners, key commands, architecture rules, the "Agent Task Context" pointer list, code style, deferred-feature inventory.

**Move out of CLAUDE.md:** any feature deep-dive that an agent only needs when working in that specific area. Geometry details, persistence internals, hub economy mechanics, protocol message tables — all live in `agent-context/*.md` and are loaded on demand.

**Why:** the dominant CLAUDE.md cost is "every agent reads it whether or not they need the geometry section." Pushing depth into agent-context lets each agent load only what their task needs.

**Target:** CLAUDE.md ≤ 200 LOC. Currently at 165.

**When to break this:** if a piece of context is genuinely cross-cutting (every task touches it), it belongs in CLAUDE.md. The "Agent Task Context" list of `PlayerState` fields is a good example — almost any game-logic task needs it.

---

## 3. Frontmatter on every doc

```yaml
---
status: shipped | in-progress | deferred | design-only | archived
updated: YYYY-MM-DD
purpose: one-line summary of when to read this doc
---
```

**Why:** without `status`, agents can't tell which docs describe current behavior. The doc that says "platforms have radius-based step circles" might be true (current code), might be archived (a model that was replaced), or might be design intent (planned but not built). Frontmatter makes this unambiguous in a single line.

**The `purpose` field is doing real work.** It's what `docs/README.md`'s "which doc for which task" table reads from — and it's what an agent skimming a directory listing uses to decide whether to open the file.

**When to break this:** the architecture review doc itself is borderline (it's a one-shot artifact, not living guidance), but even there the frontmatter declared "no changes made by the review itself" which gave readers immediate calibration.

---

## 4. Single source of truth

If two docs both describe the same thing, they will drift. Pick one as canonical and link from the other.

**Current canonicals:**
- File layout → `PROJECT_STRUCTURE.md` (CLAUDE.md and tech_spec.md link here, don't duplicate)
- "Which doc do I need?" routing → `docs/README.md` (CLAUDE.md has a brief version; README is canonical)
- Current behavior of a system → the matching `agent-context/*.md` (archive references the agent-context file for current state; never the reverse)

**Why:** the failure mode is silent. Two copies of the file structure look fine right up until one is updated and the other isn't. By the time you notice, agents may have read either version and made decisions on stale information.

**When to break this:** truly tiny duplications (a one-line reminder) are fine. The rule fires when a section is more than a few lines and explains the same thing two places.

---

## 5. Design rationale lives in agent-context, not archive

Archive docs are frozen at sprint completion. They contain the build plan + decision rationale + rejected alternatives. The temptation is to leave the rationale there and point at it from code comments / agent-context.

**Don't.** If a design decision is important enough that a future reader needs it (e.g. "why is `canClimb` a class flag and not a skill?"), pull the rationale forward into the matching `agent-context/*.md`. Archive becomes the *historical* record of how the decision was made (alternatives considered, sprint discussion, etc.) — but the *current intent* lives in agent-context where it stays maintained.

**Why:** archive docs explicitly say "do not edit; may be stale." Pointing readers there for current intent is a stale-content trap waiting to spring. Pulling rationale forward also enforces that important context survives the "this sprint is done" mental boundary.

**Concrete example:** the `canClimb` stub rationale moved from `archive/geometry-sprint-plan.md` §"Open Questions" #12 into `agent-context/geometry-elevation.md` §"Why this is a stub (DEFERRED)" during the 2026-05-14 restructure. The archive still has the original discussion; the agent-context version is the source of truth for "what does this mean today."

---

## 6. "See also" signposts should be specific, not generic

**Bad:** *"For more, see `archive/X.md`."*

**Good:** *"`archive/X.md` — the original Open Questions list (#1–#15 with when-to-revisit triggers), the abandoned step-circle model, and the build-order log. Read only if you need design history."*

**Why:** a generic signpost encourages speculative reads ("maybe more is there"). A specific one tells the agent *what* is there and *when* it would matter. The reader can decide in one glance whether to follow the link.

**When to break this:** if there's genuinely nothing notable in the linked doc beyond what the linker says, don't add the signpost. Empty signposts are worse than no signposts.

---

## 7. Deferred features get TODO comments at the code site

Stubs, placeholders, and "always returns 0" fields should be tagged in code with:

```js
// TODO(deferred): <short description> — see docs/<path>#<section>
```

**Why:** without this, an agent reading the code cannot distinguish "this is finished" from "this is a placeholder awaiting a future system." The TODO + doc link makes the gap explicit and routes the reader to the deferred-feature inventory in CLAUDE.md or the relevant agent-context section.

**Current sites (as of 2026-05-16):**
- `server/rooms/DungeonRoom.js:_buildRunMeta` — kill attribution
- `shared/logic/geometry.js:isLineBlocked` — awaiting LoS/ranged combat

CLAUDE.md §"Deferred Features" maintains the full inventory.

---

## 8. Don't auto-update docs

When a task changes code, **flag** the need for doc updates; don't update unilaterally. CLAUDE.md §"Keeping Docs Current" lists the triggers (new files, new state fields, new message types, new patterns, new shipped features). The user decides whether the update happens in this session or later.

**Why:** doc updates often involve judgment calls (where does this new section live? does this change warrant a sprint-archive entry?). Surfacing the call to the user keeps human judgment in the loop and avoids reactive doc churn.

---

## Adding a new system — checklist

When a new system (new sprint, new feature area) is being introduced:

1. **During build:** create a `*-plan.md` in `docs/` root (not yet archived). Frontmatter `status: in-progress`. Captures decisions, build order, open questions.
2. **At ship:** create `agent-context/<system>.md` capturing current behavior. Pull forward any design rationale future readers will need. Add a "See also — historical context" pointing at the soon-to-be-archived plan.
3. **At ship:** move the `*-plan.md` to `docs/archive/`, flip frontmatter to `status: archived`. Add the cross-reference back to the agent-context file.
4. **At ship:** add a row to `docs/README.md`'s "which doc for which task" table.
5. **At ship:** if any new field/message/registry was introduced, update `PROJECT_STRUCTURE.md`.
6. **At ship:** if any feature is shipping as a stub or placeholder, add `// TODO(deferred):` at the code site and a §"Deferred Features" entry in CLAUDE.md.

This sequence keeps the three-layer model intact and ensures no agent in a future session has to reverse-engineer where a system's docs live.

---

## When in doubt

Default to **fewer docs, denser docs, in the right layer.** A new agent-context file is justified when there's a clear feature surface that other docs would otherwise have to repeatedly cross-reference. A new principle in this guide is justified only when the decision was non-obvious and would otherwise be re-litigated.

If you find yourself writing a doc to "track what we did" rather than "help a future reader do something," reconsider — that's usually a commit message, not a doc.
