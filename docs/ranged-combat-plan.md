---
status: in-progress
updated: 2026-05-16
purpose: Sprint plan for ranged combat (shortbow + longbow), LoS, and the advantage/disadvantage tri-state refactor that ships alongside it.
---

# Ranged Combat Sprint Plan

## Goal

Add SRD shortbow and longbow to the game. When a bow is equipped, SPACE fires an arrow at the selected target (target-selection from the previous sprint is the gate). Walls and locked doors block line of sight; platform perimeters do not. Long range and adjacent hostiles impose disadvantage per SRD; high-ground still grants advantage; multiple sources cancel per the 5e rule.

This sprint also lands the advantage/disadvantage tri-state refactor described in `docs/advantage-architecture-plan.md`. That work is no longer speculative — ranged combat is the trigger condition the plan called for, and the cancellation rule means a single boolean is no longer expressive enough.

## Design decisions (confirmed with user)

- **Advantage refactor lands now, in this sprint.** Plus both SRD ranged disadvantage sources (long-range, ranged-into-melee). High-ground advantage and these disadvantages cancel per SRD.
- **Locked doors block LoS, unlocked doors do not.** Mirrors movement: locked door = wall, unlocked door = passage.
- **Tab cycles enemies within the equipped weapon's long range; LoS is not checked at selection time.** Selection ring may sit on a target you can't currently hit; `attack_denied` at fire time supplies the feedback. Avoids ring flicker as enemies move behind cover.
- **Arrows are cosmetic.** Server resolves the to-hit instantly at fire time and broadcasts an `arrow_fired` event; clients tween a sprite from attacker → target for flavour. No state-schema projectile entities.

Infinite arrows assumed for v1. No ammunition item, no quiver slot.

## Out of scope

- Ammunition / arrow items.
- Cover (half / three-quarters / full beyond LoS yes-no).
- Other ranged weapon types (crossbows, slings, thrown daggers/handaxes/javelins). The `range` property is shaped so they slot in later.
- Archery fighting style (+2 attack rolls). Not in any class def today.
- Ranged sneak attack / extra dice on ranged hits.
- Friendly-fire / arc / aoe.

## SRD baseline → engine values

Project converts feet to pixels at 5 px/ft (`BASE_SPEED_PX_PER_SEC = 150` for 30 ft).

| Weapon | Damage | Type | Properties | Normal range | Long range |
|---|---|---|---|---|---|
| Shortbow | 1d6 | piercing | ammunition, two-handed | 80 ft → **400 px** | 320 ft → **1600 px** |
| Longbow | 1d8 | piercing | ammunition, two-handed, heavy | 150 ft → **750 px** | 600 ft → **3000 px** |

Attack/damage ability: **DEX**. Longbow's long range exceeds floor 1's width (1600); that's fine — the long-range gate is per-shot, and the player rarely has that line on floor 1 anyway.

Cooldown: same `ATTACK_COOLDOWN_MS` (3000 ms) as melee for v1. Tune later if bows feel oppressive.

## Implementation

### 1. Advantage / disadvantage refactor (`shared/logic/combat.js`)

Follows `docs/advantage-architecture-plan.md` exactly:

- `resolveAttack` signature: replace `advantage: boolean` with `sources: Array<{ kind: 'advantage' | 'disadvantage', reason: string }>`. Default `[]` = normal roll.
- New pure helper `resolveRollMode(sources) → 'normal' | 'advantage' | 'disadvantage'`. Cancellation is binary: any advantage + any disadvantage = normal; otherwise the side that has entries wins.
- 2d20 keep-lower branch on disadvantage. Nat-1 auto-miss fires if either die is 1; nat-20 crit fires only if both are 20. Mirror of current keep-higher logic.
- Return field stays `advantageRolls: [kept, discarded]` — works for both modes. Combat log decides the label.
- `conditionBonus` (Bless +1d4) untouched.

### 2. Combat-log labels (`server/systems/CombatSystem.js`)

`rollStr()` currently renders `d20:N [adv: a, b]` when `result.advantageRolls` is set. Extend to render `[adv: a, b — high-ground]` or `[dis: a, b — long range]` based on a new `rollMode + sourceReason` on the result. The architecture plan calls this out as the only string change.

If multiple sources contributed on the winning side, concatenate reasons with `, `. The display reason comes from the resolved-mode sources only (cancelled-out sources don't clutter the log).

### 3. Source-assembly sites (`server/systems/CombatSystem.js`)

Each call site that currently computes `advantage = ...` builds a local `sources` array:

- **Player main-hand attack** (`playerAttack`):
  - High-ground: `{ kind: 'advantage', reason: 'high-ground' }` when `player.elevation === 1 && target.elevation === 0`.
  - Long range (ranged only): `{ kind: 'disadvantage', reason: 'long range' }` when `dist > weapon.range.normal` and `dist <= weapon.range.long`.
  - Ranged into melee (ranged only): `{ kind: 'disadvantage', reason: 'foe adjacent' }` when any living enemy other than the target is within `MELEE_HIT_RANGE_PX` of the attacker.
- **Player offhand attack** and **monk MA**: same high-ground source as today. Melee, so no ranged sources.
- **Enemy attack** (`enemyAttack`): high-ground only (enemies don't wield bows in v1).

### 4. Weapons & registry

- New file `shared/data/weapons/ranged.js` exporting `SHORTBOW`, `LONGBOW`.
- Each carries `range: { normal: number, long: number }` (px) and `attackAbility: 'dex'`. Properties include `'two-handed'`; longbow also `'heavy'`. **No `'ammunition'` property string** — we don't model arrows.
- `shared/types/weapon.js`: extend the typedef with `range?: { normal: number, long: number }`. Presence of `range` is the canonical "this is ranged" check.
- New barrel `shared/data/weapons/index.js` exporting a unified `WEAPON_REGISTRY` (melee ∪ ranged) and re-exporting `UNARMED`. Existing imports from `shared/data/weapons/melee.js` (`equipment.js`, `CombatSystem.js`, `DungeonRoom.js`) migrate to the barrel. `melee.js` keeps the per-weapon exports but drops its own `WEAPON_REGISTRY` export.

`equipItem` keeps working unchanged — bows are two-handed weapons, the existing path auto-unequips offhand on equip.

### 5. Line of sight (`shared/logic/geometry.js`)

Implement `isLineBlocked(x1, y1, x2, y2, walls, doors)`:

- Iterates wall rects and locked-door rects, returns true if the segment intersects any. Unlocked doors are skipped.
- Uses segment-vs-AABB test. Cheapest correct form: clip the segment against each rect using the Liang-Barsky parameter; if `t_enter <= t_exit` and the overlap intersects `[0, 1]`, the segment hits the rect.
- Pure, deterministic, no allocations beyond a few scalars per rect.

Caller passes `state.doors` (a MapSchema) or an array; helper iterates whatever shape with a `for…of` (works for both).

### 6. Ranged attack path in `CombatSystem.js`

Add a `weaponIsRanged(weapon)` predicate (presence of `range`). In `playerAttack`:

- Branch early on `weaponIsRanged(weapon)`. For ranged:
  - **Target validation upgrade**: even with `targetId` set (selection requires it for ranged — see §7), check distance against `weapon.range.long`. Beyond → `denied: 'out_of_range'`.
  - **LoS gate**: `isLineBlocked(player.x, player.y, target.x, target.y, walls, doors)` → `denied: 'no_line_of_sight'`.
  - **Source assembly** per §3.
  - Single attack (no offhand, no monk MA).
  - Broadcast `arrow_fired` (see §8).
- For melee: existing behaviour, just migrated to the `sources` array form.

`DungeonRoom._tick`-time data (`_floorWalls`, `state.doors`) is passed into `playerAttack` so the LoS check can see them. New signature:
`playerAttack(state, sessionId, enemyDefs, targetId, geometry)` where `geometry = { walls, doors }`.

**Ranged requires an explicit target.** Without a `targetId`, bows refuse to fire — `{ denied: 'no_target' }`. The "fire at nearest" nearest-enemy fallback only makes sense for melee. Combat log line: "Select a target before firing."

### 7. Protocol additions

`docs/agent-context/protocol.md` after the code lands:

**Client → Server**

| Message | Payload | Change |
|---|---|---|
| `attack` | `{ targetId? }` | No payload change. Server-side semantics differ for ranged: explicit target required; LoS + range gates run. |

**Server → Client**

| Message | Payload | Notes |
|---|---|---|
| `attack_denied` | `{ reason }` | New reasons: `'no_line_of_sight'`, `'no_target'`. Existing: `'out_of_range'`, `'invalid_target'`. |
| `arrow_fired` | `{ attackerId, fromX, fromY, toX, toY, hit }` | Broadcast to room. Client tweens an arrow sprite over a short fixed duration. `hit` lets the client play different end animations (impact vs miss-flyby). |

### 8. Client

`client/src/network/ColyseusClient.js`: no API changes (`sendAttack(targetId)` already covers ranged). Add an `onArrowFired(fn)` subscription helper or just route the message in `DungeonScene`.

`client/src/scenes/DungeonScene.js`:

- **Tab range becomes weapon-aware**. `_cycleTarget` reads the local player's `equippedWeaponId` → looks up `WEAPON_REGISTRY`. Ranged weapon → use `weapon.range.long`. Melee/empty → use `MELEE_SELECT_RANGE_PX` (unchanged).
- **`arrow_fired` listener**: spawn a small arrow Graphics (a thin line or simple triangle) at `from`, tween position to `to` over ~250 ms, destroy at end. On `hit === false`, overshoot the target by a small amount so a miss reads visually. No physics; purely cosmetic.
- **New denial reasons**: `'no_line_of_sight'` → "No line of sight." `'no_target'` → "Select a target before firing." Plumbed through the existing `attack_denied` handler.

`MELEE_SELECT_RANGE_PX` stays in `shared/data/constants.js`; range-by-weapon is read off the weapon def at the call site.

### 9. Floor 1 chest

`shared/data/floors/floor1.js`: append `'shortbow'` and `'longbow'` to the chest's `items` array. Players grabbing a bow auto-unequips a melee weapon (existing equip path).

## Testing

### Pure unit tests (`shared/tests/`)

`shared/tests/combat.test.js` — extend with the advantage-refactor cases the architecture plan called for:
- Advantage cancels disadvantage → normal roll (one of each).
- Two advantage + one disadvantage → still normal (cancellation is binary).
- Two advantage, zero disadvantage → advantage.
- Disadvantage path: keep-lower, nat-1-on-either, nat-20-only-on-both.
- Migration check: the existing high-ground cases pass when expressed as `sources: [{ kind: 'advantage', reason: 'high-ground' }]`.

`shared/tests/geometry.test.js` — extend with `isLineBlocked` cases:
- Clear segment through empty space → false.
- Segment crosses a wall rect → true.
- Segment crosses a locked door → true.
- Segment crosses an unlocked door → false.
- Segment ends inside a wall (e.g. target embedded in geometry) → true.
- Segment grazes wall corner: edge case, document the chosen behaviour in the test name.
- Platform rects passed in `walls` list are NOT used — `isLineBlocked` is called with `walls + locked-door rects` only; the caller does the filtering. (Test verifies the function honours its input rect list rather than inventing a platform exception.)

### Server-side tests

New `server/tests/ranged-combat.test.js`:

1. Bow equipped, target in range, LoS clear → attack resolves; cooldown consumed.
2. Bow equipped, no `targetId` → `{ denied: 'no_target' }`; no cooldown.
3. Bow equipped, target beyond long range → `{ denied: 'out_of_range' }`; no cooldown.
4. Bow equipped, wall between attacker and target → `{ denied: 'no_line_of_sight' }`; no cooldown.
5. Bow equipped, target in long-range band → resolves; result includes a disadvantage source for `'long range'`.
6. Bow equipped, target in normal range with adjacent enemy → result includes `'foe adjacent'` disadvantage source.
7. High-ground (advantage) + long range (disadvantage) → cancels → normal roll (verified via deterministic rng injection: kept die === first roll).
8. Melee regression: longsword path still works after migration to `sources` array.

Existing `server/tests/target-selection.test.js` keeps passing — `targetId` semantics for melee are unchanged.

### Manual playtest checklist

Run `npm start`, fighter class, loot the chest, equip a bow.

- [ ] **Equipping a bow** auto-unequips any offhand item (shield or weapon). Inventory reflects the change.
- [ ] **No-target fire** — SPACE without a selection → combat log shows "Select a target before firing." No cooldown burnt.
- [ ] **Click distant enemy, SPACE** → arrow tweens from player to enemy; combat log shows hit/miss with attack roll math.
- [ ] **Tab range** — with a bow equipped, Tab reaches enemies farther away than the old melee select range allowed.
- [ ] **LoS gate** — stand behind an interior wall on floor 2 (or behind a locked door), select an enemy on the other side, SPACE → "No line of sight." Arrow does not fire.
- [ ] **Platform doesn't block** — stand off-platform, target an enemy on the platform (or vice versa). Arrow fires.
- [ ] **Long-range disadvantage** — target an enemy beyond normal range but within long range; combat log shows `[dis: a, b — long range]`.
- [ ] **Ranged into melee** — stand next to a goblin, target the other goblin across the room. Combat log shows `[dis: a, b — foe adjacent]`.
- [ ] **Advantage cancels disadvantage** — stand on the platform (high ground) and shoot a ground-level enemy at long range. Combat log shows no advantage label (cancellation, normal roll).
- [ ] **Switch back to melee** — equip a longsword; SPACE attacks the selected target (or nearest with no selection) at melee range as before. No regression.
- [ ] **Multiplayer arrow visibility** — second client sees the arrow tween for the first client's shot.

## Doc updates required after merge

Flag to user; don't update unprompted.

- `docs/agent-context/protocol.md` — new `attack_denied` reasons (`'no_line_of_sight'`, `'no_target'`), new `arrow_fired` message.
- `docs/agent-context/combat.md` — Ranged Combat section; update Target Selection note that ranged requires explicit target; migrate the Attack Resolution section to describe the tri-state resolver.
- `docs/agent-context/geometry-elevation.md` — remove `isLineBlocked` from V1 Known Limitations; add a paragraph on the LoS rule (walls + locked doors, not platforms).
- `docs/PROJECT_STRUCTURE.md` — `shared/data/weapons/ranged.js`, `shared/data/weapons/index.js` (new), test files, drop the `isLineBlocked` stub note.
- `docs/advantage-architecture-plan.md` — flip `status: design-only` → `archived`; this sprint executed it.
- `CLAUDE.md` — drop the `isLineBlocked` line from Deferred Features.
- `CHANGELOG.md` — Session 6 entry.
- Move this file to `docs/archive/` once shipped.
