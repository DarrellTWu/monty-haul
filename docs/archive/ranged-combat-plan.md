---
status: archived
updated: 2026-05-17
purpose: Sprint plan for ranged combat (shortbow + longbow), LoS, and the advantage/disadvantage tri-state refactor. Shipped — archived for reference.
---

# Ranged Combat Sprint Plan

## Goal

Add SRD shortbow and longbow to the game. When a bow is equipped, SPACE fires an arrow at the selected target (target-selection from the previous sprint is the gate). Walls and locked doors block line of sight; platform perimeters do not. Long range and adjacent hostiles impose disadvantage per SRD; high-ground still grants advantage; multiple sources cancel per the 5e rule.

This sprint also lands the advantage/disadvantage tri-state refactor described in `docs/advantage-architecture-plan.md`. That work is no longer speculative — ranged combat is the trigger condition the plan called for, and the cancellation rule means a single boolean is no longer expressive enough.

## Design decisions (confirmed with user)

- **Advantage refactor lands now, in this sprint.** Plus both SRD ranged disadvantage sources (long-range, ranged-into-melee). High-ground advantage and these disadvantages cancel per SRD.
- **Locked doors block LoS, unlocked doors do not.** Mirrors movement: locked door = wall, unlocked door = passage.
- **Tab cycles enemies within the equipped weapon's long range; LoS is not checked at selection time.** Selection ring may sit on a target you can't currently hit; `attack_denied` at fire time supplies the feedback. Avoids ring flicker as enemies move behind cover.
- **Arrows are cosmetic.** Server resolves the to-hit instantly at fire time and broadcasts a generic `projectile_fired` event (with a `style` discriminator so future bolts / thrown daggers / firebolts / magic missiles share the same wire shape); clients tween a sprite from attacker → target for flavour. No state-schema projectile entities.
- **Ranged weapons require an explicit target reference.** For v1 that target is always an enemy id (`targetId`), but the rule is phrased per-weapon — not as a global "ranged combat" invariant — so future ranged things can target environmental features (destructible barrels, levers, breakable doors), points on the floor (aoe spell anchors), or the caster itself (Shield, self-buffs). The `attack` payload's target field stays a single string id for now; broadening to `{ kind, id? | x?, y? }` is the cleanest forward path when non-creature targeting lands.

Infinite arrows assumed for v1. No ammunition item, no quiver slot.

## Out of scope

- Ammunition / arrow items.
- Cover (half / three-quarters / full beyond LoS yes-no).
- Other ranged weapon types (crossbows, slings, thrown daggers/handaxes/javelins). The weapon shape introduced here (explicit `kind` + optional `thrown` sub-block, see §4) is designed so they slot in without further refactor.
- Archery fighting style (+2 attack rolls). Not in any class def today.
- Ranged sneak attack / extra dice on ranged hits.
- Friendly-fire / arc / aoe.
- Non-creature target references (environment objects, points, self). The `kind: 'ranged'` constraint is "requires a target", not "requires a creature" — future target kinds drop in at the message layer without touching combat logic.

## SRD baseline → engine values

Project converts feet to pixels at 5 px/ft (`BASE_SPEED_PX_PER_SEC = 150` for 30 ft). Add a `PX_PER_FOOT = 5` constant and `ft(n) => n * PX_PER_FOOT` helper to `shared/data/constants.js` so weapon defs read as SRD (`range: { normal: ft(80), long: ft(320) }`) and can't be silently fat-fingered.

| Weapon | Damage | Type | Properties | Normal range | Long range |
|---|---|---|---|---|---|
| Shortbow | 1d6 | piercing | two-handed | `ft(80)` → 400 px | `ft(320)` → 1600 px |
| Longbow | 1d8 | piercing | two-handed, heavy | `ft(150)` → 750 px | `ft(600)` → 3000 px |

Attack/damage ability: **DEX**. Longbow's long range exceeds floor 1's width (1600); that's fine — the long-range gate is per-shot, and the player rarely has that line on floor 1 anyway.

Also add `ADJACENT_FOE_PX = MELEE_HIT_RANGE_PX` constant — the SRD "5 ft" adjacency check for ranged-into-melee disadvantage. Aliased rather than duplicated so it tracks if melee reach is tuned, but renamed so a future sprite-radius tune doesn't silently change SRD semantics.

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
- **Weapon typedef gains an explicit `kind`** (`shared/types/weapon.js`):
  ```js
  /** @typedef {{
   *   id: string,
   *   kind: 'melee' | 'ranged',           // the canonical attack-mode discriminator
   *   damageDice: DiceDef,
   *   damageBonus: number,
   *   damageType: string,
   *   enhancement: number,
   *   attackAbility: 'str' | 'dex',
   *   properties: string[],
   *   range?: { normal: number, long: number },   // required when kind === 'ranged'
   *   thrown?: { range: { normal: number, long: number }, ability?: 'str' | 'dex' }
   *     // optional — present on melee weapons that can also be thrown (handaxe, dagger,
   *     // javelin). Damage dice + damageType reuse the melee top-level values; only
   *     // the range gate and (optionally) the ability override differ.
   * }} Weapon
   */
  ```
- **Why `kind` instead of `presence of range`:** the next ranged-adjacent feature is almost certainly thrown weapons. `HANDAXE` and `DAGGER` already exist with `properties: ['thrown']`; they're melee weapons that *also* have a ranged mode. If "has `range`" meant "is ranged", adding the thrown range would silently break their melee path. The `kind` field keeps the question explicit.
- **Existing melee weapons** in `shared/data/weapons/melee.js` get `kind: 'melee'` added. No other shape change.
- **`SHORTBOW` / `LONGBOW`** carry `kind: 'ranged'`, `attackAbility: 'dex'`, `range: { normal: ft(N), long: ft(M) }`. Properties: `['two-handed']` (plus `'heavy'` for longbow). **No `'ammunition'` property** — we don't model arrows.
- **`pickAttackMode(weapon, distance)` helper** (in `shared/logic/combat.js` next to `resolveAttack`): given a weapon and the attacker→target distance, returns `'melee' | 'ranged' | 'thrown' | null`. Today only `'melee'` and `'ranged'` ever return; the `'thrown'` branch is wired for the thrown-weapon sprint. Returns `null` if the distance is beyond every mode's reach (caller treats as out-of-range). `CombatSystem.playerAttack` calls this once at the top and branches on the result.
- New barrel `shared/data/weapons/index.js` exporting a unified `WEAPON_REGISTRY` (melee ∪ ranged) and re-exporting `UNARMED`. Existing imports from `shared/data/weapons/melee.js` (`equipment.js`, `CombatSystem.js`, `DungeonRoom.js`) migrate to the barrel. `melee.js` keeps the per-weapon exports but drops its own `WEAPON_REGISTRY` export.

`equipItem` keeps working unchanged — bows are two-handed weapons, the existing path auto-unequips offhand on equip.

### 4a. Forward note — ranged enemies

`CombatSystem.enemyAttack` currently builds a weapon-shaped object inline from `enemyDef.damageDice/damageBonus/damageType`. When the first ranged enemy lands, the same `pickAttackMode` branch in §6 needs to apply on the enemy path too — meaning enemies will need either a ref into `WEAPON_REGISTRY` or an inline `kind: 'ranged'` weapon shape on their stat block. This sprint doesn't ship that, but the seam is one helper call (`pickAttackMode` is symmetric across player/enemy). One paragraph in `agent-context/combat.md` after this ships, calling out the seam.

### 5. Line of sight (`shared/logic/geometry.js`)

Implement `isLineBlocked(x1, y1, x2, y2, walls, doors)`:

- Iterates wall rects and locked-door rects, returns true if the segment intersects any. Unlocked doors are skipped.
- Uses segment-vs-AABB test. Cheapest correct form: clip the segment against each rect using the Liang-Barsky parameter; if `t_enter <= t_exit` and the overlap intersects `[0, 1]`, the segment hits the rect.
- Pure, deterministic, no allocations beyond a few scalars per rect.

Caller passes `state.doors` (a MapSchema) or an array; helper iterates whatever shape with a `for…of` (works for both).

### 6. Ranged attack path in `CombatSystem.js`

In `playerAttack`, call `pickAttackMode(weapon, distance)` once at the top (after target resolution). Branch on the result:

- **`mode === 'ranged'`:**
  - **Target reference required.** Without a `targetId`, bows refuse to fire — `{ denied: 'no_target' }`. (Rule lives on the weapon's `kind: 'ranged'`, not on "ranged combat" generally. A future weapon with `kind: 'ranged'` that legally targets the floor would need to flip a `targetKind` allow-list on the weapon def. For all v1 ranged weapons, target is an enemy id.)
  - **Distance gate**: > `weapon.range.long` → `denied: 'out_of_range'`. (Note that `pickAttackMode` returning `'ranged'` already implies the target is within `weapon.range.long`; this re-check is defensive against state drift between selection and fire.)
  - **LoS gate**: `isLineBlocked(player.x, player.y, target.x, target.y, walls, lockedDoors)` → `denied: 'no_line_of_sight'`.
  - **Source assembly** per §3.
  - Single attack (no offhand, no monk MA).
  - Broadcast `projectile_fired` (see §8).
- **`mode === 'melee'`:** existing behaviour. Migrated to the `sources` array form.
- **`mode === null`:** target is beyond every viable mode → `denied: 'out_of_range'`.
- **`mode === 'thrown'`:** unreachable in this sprint; reserved branch (returns `denied: 'invalid_target'` defensively if it somehow fires, with a TODO comment pointing to the future thrown-weapons sprint).

`DungeonRoom._tick`-time data (`_floorWalls`, `state.doors` filtered to locked) is passed into `playerAttack` so the LoS check can see them. New signature:
`playerAttack(state, sessionId, enemyDefs, targetId, geometry)` where `geometry = { walls, lockedDoors }`. (The handler does the locked-door filter once per attack rather than the shared helper iterating a MapSchema — keeps `isLineBlocked` framework-agnostic with a plain rect-array contract.)

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
| `projectile_fired` | `{ attackerId, fromX, fromY, toX, toY, hit, style }` | Broadcast to room for any instant-resolution flying thing. `style`: `'arrow'` for bows in this sprint; future values include `'bolt'`, `'thrown'`, `'firebolt'`, `'magic_missile'`, etc. Client switches on `style` for sprite/colour/tween shape. `hit` lets the client play impact vs miss-flyby. (Area-effect spells will use a *different* message — area effects aren't projectiles.) |

### 8. Client

`client/src/network/ColyseusClient.js`: no API changes (`sendAttack(targetId)` already covers ranged). Route `projectile_fired` in `DungeonScene`.

`client/src/scenes/DungeonScene.js`:

- **Tab range becomes weapon-aware**. `_cycleTarget` reads the local player's `equippedWeaponId` → looks up `WEAPON_REGISTRY`. If `weapon.kind === 'ranged'` → use `weapon.range.long`. Else → `MELEE_SELECT_RANGE_PX` (unchanged). Reading the `kind` field rather than checking for `range` presence is what makes this future-safe for thrown weapons.
- **`projectile_fired` listener**: switch on `style`. For `'arrow'`: spawn a thin Graphics line/triangle at `from`, tween to `to` over ~250 ms, destroy at end. On `hit === false`, overshoot slightly so a miss reads visually. No physics. A `_renderProjectile(style, from, to, hit)` helper keeps the switch shallow as more styles land.
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

Extend `shared/tests/combat.test.js` for `pickAttackMode`:
- Melee weapon at any distance → `'melee'`.
- Ranged weapon within normal range → `'ranged'`.
- Ranged weapon within long-range band → `'ranged'` (caller adds the disadvantage source).
- Ranged weapon beyond long range → `null`.
- Melee weapon with `thrown` sub-block, target out of melee but within thrown range → `'thrown'` (forward test; only need to assert the dispatch — `'thrown'` resolution itself is a future-sprint test).

New `server/tests/ranged-combat.test.js`:

1. Bow equipped, target in range, LoS clear → attack resolves; cooldown consumed.
2. Bow equipped, no `targetId` → `{ denied: 'no_target' }`; no cooldown.
3. Bow equipped, target beyond long range → `{ denied: 'out_of_range' }`; no cooldown.
4. Bow equipped, wall between attacker and target → `{ denied: 'no_line_of_sight' }`; no cooldown.
5. Bow equipped, target in long-range band → resolves; result includes a disadvantage source for `'long range'`.
6. Bow equipped, target in normal range with adjacent enemy → result includes `'foe adjacent'` disadvantage source.
7. High-ground (advantage) + long range (disadvantage) → cancels → normal roll (verified via deterministic rng injection: kept die === first roll).
8. Melee regression: longsword path still works after migration to `sources` array.
9. `projectile_fired` broadcast: on successful ranged attack, the test harness's broadcast spy captures one `projectile_fired` event with `style: 'arrow'` and matching coords.

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

- `docs/agent-context/protocol.md` — new `attack_denied` reasons (`'no_line_of_sight'`, `'no_target'`), new `projectile_fired` message.
- `docs/agent-context/combat.md` — Ranged Combat section; update Target Selection note that `kind: 'ranged'` weapons require an explicit target reference (broadened from "creature"); migrate the Attack Resolution section to describe the tri-state resolver; one paragraph on the ranged-enemy seam (§4a).
- `docs/agent-context/geometry-elevation.md` — remove `isLineBlocked` from V1 Known Limitations; add a paragraph on the LoS rule (walls + locked doors, not platforms).
- `docs/PROJECT_STRUCTURE.md` — `shared/data/weapons/ranged.js`, `shared/data/weapons/index.js` (new), test files, drop the `isLineBlocked` stub note.
- `docs/advantage-architecture-plan.md` — flip `status: design-only` → `archived`; this sprint executed it.
- `CLAUDE.md` — drop the `isLineBlocked` line from Deferred Features.
- `CHANGELOG.md` — Session 6 entry.
- Move this file to `docs/archive/` once shipped.
