---
status: shipped
updated: 2026-05-16
purpose: Implementation plan for extracting condition timer logic from DungeonRoom into shared/logic/conditions.js. Pure refactor, no behavior change. Shipped 2026-05-16; manual smoke-tested by user.
---

# Conditions Refactor — `shared/logic/conditions.js`

## Why now

The `TODO(deferred)` marker is live at `server/rooms/DungeonRoom.js:578`, and condition bookkeeping is duplicated across three call sites with one shared mapping (`condition id → mirror `*RemainingMs` field`) re-encoded in each:

- **Apply** — `_useConsumable` (lines ~620–648) and `_activateRage` (~707–717): each does `push to conditions[]` (with idempotency check) → set `*RemainingMs` mirror field → set `_conditionTimers.set(\`${sid}_${cond}\`, ms)`.
- **Tick** — `_tickConditions` (~580–606): re-encodes the mirror-field mapping in two parallel branches (expire vs. decrement).
- **Clear** — `_longRest` (~483–490): re-encodes the same mirror fields a third time, plus a custom `startsWith` sweep of the timers Map.

Adding a sixth potion or any subclass with a timed buff would compound the duplication. Pure refactor, no behavior change.

## Design

New module: **`shared/logic/conditions.js`** — pure, framework-free, no Colyseus deps.

```js
// Static table — single source of truth for the mirror mapping.
export const CONDITION_DEFS = {
  rage:        { mirrorField: 'rageRemainingMs',        onExpireLog: (p) => `${cap(p.class)}'s Rage ends.` },
  bless:       { mirrorField: 'blessRemainingMs' },
  longstrider: { mirrorField: 'longstriderRemainingMs' },
  false_life:  { mirrorField: 'falseLifeRemainingMs',   onExpire: (p) => { p.tempHp = 0; } },
};

// timers: Map<`${sessionId}_${conditionId}`, remainingMs>  (caller-owned, e.g. room-scoped)
export function applyCondition(player, conditionId, durationMs, timers, sessionId) { ... }
export function tickConditions(players, timers, dt) { /* returns string[] expiry logs */ }
export function clearPlayerConditions(player, timers, sessionId) { ... }
```

### Key decisions

- **Keep the room-owned `Map` for timers.** Pushing it into `PlayerState` would change sync behavior; this refactor is no-behavior-change. The module receives the Map by reference.
- **Keep per-condition `*RemainingMs` mirror fields on `PlayerState`.** HUDScene + InventoryScene read them — schema changes are out of scope.
- **Logs returned, not broadcast.** Pure module returns strings; `DungeonRoom` broadcasts. Mirrors how `AISystem.update` already returns log arrays.
- **`onExpire` hook in the def table** absorbs the `false_life → tempHp = 0` and `rage → log` special cases without `if (condition === 'x')` branches in the tick loop.

## Implementation steps

1. **Add `shared/logic/conditions.js`** with `CONDITION_DEFS`, `applyCondition`, `tickConditions`, `clearPlayerConditions`. ~70 LOC.
2. **`DungeonRoom._tickConditions`** → one-liner delegating to `tickConditions(this.state.players, this._conditionTimers, dt)` then broadcasting returned logs. Remove the per-condition `if` ladder.
3. **`DungeonRoom._useConsumable`** → replace the three condition branches' bookkeeping with `applyCondition(...)`. Keep type-specific bits (heal roll, tempHp roll, extract phase) and the combat-log messages — those carry per-type formatting and stay at the call site.
4. **`DungeonRoom._activateRage`** → call `applyCondition(player, 'rage', RAGE_DURATION_MS, this._conditionTimers, sessionId)` instead of the manual 3 lines.
5. **`DungeonRoom._longRest`** → replace the per-field zeroing + `while pop` + prefix sweep with a call that wipes all known conditions for that session.
6. **Remove the deferred TODO comment** at `DungeonRoom.js:578` and the bullet in `CLAUDE.md` §Deferred Features.

## Test plan

### Unit tests — new `shared/tests/conditions.test.js`

~100 LOC, follows the `node:assert` style of the existing suites:

- `applyCondition` adds id once (idempotent re-apply refreshes timer, doesn't duplicate the array entry).
- `applyCondition` sets the mirror field for each of the four conditions; unknown id is a no-op.
- `tickConditions` decrements the timer and updates the mirror field each tick.
- `tickConditions` removes the condition + zeros the mirror at expiry; `false_life` expiry zeros `tempHp`; `rage` expiry returns the log string.
- `clearPlayerConditions` wipes all four conditions + mirrors + timer entries for one session; leaves another session's entries untouched.
- Cross-player non-interference (two fake players with overlapping condition ids).

### Existing suites must still pass

- `node shared/tests/combat.test.js`
- `node shared/tests/loot.test.js`
- `node shared/tests/character.test.js`
- `node shared/tests/equipment.test.js`

No shape changes expected.

### Manual smoke (Colyseus + broadcast wiring — can't be unit-tested)

1. `npm start`.
2. Drink each of: Healing, Bless, Longstrider, False Life potion. Confirm combat-log line appears, HUD ring/icon starts at full duration, ticks down, expires with same UI behavior as before.
3. Activate Rage on Barbarian → log fires, ring shows, expiry broadcasts `Rage ends`.
4. Descend stairs while two conditions are active → log shows long-rest line, both rings vanish, `tempHp` (from false_life) returns to 0.
5. Two players, both with active Bless, one descends ahead — verify parity with current behavior (single-room model: descend reloads floor for everyone).

## Doc updates after merge

- `CLAUDE.md` §Deferred Features — drop the `shared/logic/conditions.js — not built` bullet.
- `docs/PROJECT_STRUCTURE.md` — add `shared/logic/conditions.js` and `shared/tests/conditions.test.js`.
- `docs/architecture-review-2026-05-14.md` §3.4 — mark conditions deferred-marker resolved.
- Archive this plan to `docs/archive/` once shipped.

## Risks / out-of-scope

- **No `PlayerState` schema changes.** Don't consolidate the four `*RemainingMs` fields into a MapSchema — that's a sync-protocol change and a client refactor, not this task.
- **Don't reshape `_conditionTimers` key format.** It's a private cache; churn without benefit.
- **Combat-log message strings stay verbatim.** Behavior-no-change means the player can't tell a refactor happened. The expiry-log strings move into `CONDITION_DEFS.onExpireLog`; eyeball them against the current text in `_tickConditions`.

## Estimate

~2 hrs: ~30 min module + ~30 min DungeonRoom edits + ~45 min tests + ~15 min manual smoke + docs.
