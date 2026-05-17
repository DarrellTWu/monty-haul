---
status: archived
updated: 2026-05-17
purpose: Plan for evolving advantage/disadvantage from a single boolean into a multi-source resolver. Executed in the ranged-combat sprint when long-range and foe-adjacent disadvantage became the trigger. Archived for design history.
---

# Advantage / Disadvantage Architecture Plan

## Trigger condition

**Do not start this work until a second advantage or disadvantage source is being added.** Today there is exactly one source (high-ground, `server/systems/CombatSystem.js:108` and `:226`), and the current `advantage: boolean` parameter on `resolveAttack` is the right shape for that. Touching it sooner is speculative abstraction.

The trigger is any of:
- A condition that grants advantage (e.g. Reckless Attack, attacking a prone target in melee).
- A condition that imposes disadvantage (e.g. attacker is prone, target is invisible, ranged attack into melee).
- An item/weapon property that grants advantage.
- An environmental source beyond elevation (cover, lighting).

When one of these is on the next sprint, this plan kicks in.

## The real design problem

The reason a refactor is needed at all is the 5e cancellation rule: **any number of advantage sources + any number of disadvantage sources = a normal roll.** You cannot OR booleans together. A second source forces a tri-state.

This is the load-bearing consideration. Every choice below flows from it.

## Plan

### 1. Tri-state in `resolveAttack` (`shared/logic/combat.js:95`)

Replace `advantage: boolean` with `rollMode: 'normal' | 'advantage' | 'disadvantage'`.

- Add a 2d20-keep-lower branch beside the existing keep-higher branch.
- `advantageRolls` stays as the field name on the result (already plumbed into combat-log labels at `server/systems/CombatSystem.js:52` and `:256`); consider renaming to `modeRolls` *only* if you are touching every call site anyway.
- Natural 1 / natural 20 logic: with disadvantage, nat-1 auto-miss fires if *either* die is 1; nat-20 crit fires only if *both* dice are 20. Mirror of the current advantage rules at `combat.js:107`.

### 2. Pure resolver in `shared/logic/combat.js`

```
resolveRollMode(sources) → 'normal' | 'advantage' | 'disadvantage'
```

`sources` is `Array<{ kind: 'advantage' | 'disadvantage', reason: string }>`. The function applies the cancellation rule. `reason` is kept so the combat log can render `[adv: a, b — high-ground]` instead of just `[adv: a, b]`.

Pure, no framework deps, deterministic — fits the `shared/logic/` rules in `CLAUDE.md`.

### 3. Sources stay where they're computed — do NOT centralize

This is the most important architectural call. Resist the urge to build a registry or a "source provider" abstraction.

- **Environment (high-ground today, cover/lighting later):** assembled in `CombatSystem.js` next to the existing elevation check. The current `advantage = player.elevation === 1 && target.state.elevation === 0` becomes a `sources.push(...)` when true.
- **Condition-driven (Reckless Attack, prone, restrained, invisible):** read off `attacker.conditions` / `target.conditions` near the existing `conditionBonus` logic inside `resolveAttack`, or in a small helper alongside it. Probably belongs *inside* `resolveAttack` since the attack data is already there.
- **Item-driven (weapon properties):** read off the weapon def in `CombatSystem.js` when assembling the call — same place weapon stats are already gathered.

Each call site builds a local `sources` array and passes it through `resolveRollMode` once per attack. Mainhand/offhand/martial-arts already share the `advantage` value today (`CombatSystem.js:108, 143, 185`); that pattern carries forward unchanged — same `sources` array, three calls.

### 4. Disadvantage path

Comes for free once step 1 lands. No additional plumbing.

## Explicit non-goals

- **No registry / plugin system for advantage sources.** Three to five call sites in two files do not need indirection. If sources grow past ~10 we can revisit.
- **No "advantage" condition object on `PlayerState`.** Advantage is computed per-attack from existing state (elevation, conditions, equipment); it is not itself a persisted condition. Storing it would create two sources of truth.
- **No preemptive move of high-ground out of `CombatSystem.js`.** Elevation lives there; the check belongs there.
- **No combat-log schema change in this refactor.** Append the `reason` to the existing label string; don't restructure events.

## Test plan

Extend `shared/tests/combat.test.js`:
- Advantage cancels disadvantage → normal roll (one of each source).
- Two advantage + one disadvantage → still normal (cancellation is binary, not counted).
- Two advantage, zero disadvantage → advantage.
- Disadvantage path: keep-lower, nat-1-on-either, nat-20-only-on-both.

Existing high-ground tests must still pass with the input shape migrated from `advantage: true` to `sources: [{ kind: 'advantage', reason: 'high-ground' }]`.

## Estimated size

One small PR, roughly:
- `resolveAttack` signature + disadvantage branch: ~30 lines in `combat.js`.
- `resolveRollMode` helper: ~15 lines in `combat.js`.
- Migrate the four `advantage = ...` sites in `CombatSystem.js` to build `sources` arrays: ~20 lines diff.
- Tests: ~40 lines.

Total well under 150 lines. Worth doing in one shot when the trigger fires; not worth doing on spec.

## See also

- `shared/logic/combat.js` — `resolveAttack` (the only function that changes shape).
- `server/systems/CombatSystem.js` — all current advantage call sites.
- `docs/agent-context/combat.md` — combat-system narrative; update when this ships.
- `docs/agent-context/geometry-elevation.md` — describes the high-ground rule that motivated the original boolean.
