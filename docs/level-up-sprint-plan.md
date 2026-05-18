---
status: design-only
updated: 2026-05-17
purpose: Sprint plan — wire character level-up to each dungeon descent, with multiclass-only level choices as the MVP gameplay surface. Architecture is built to absorb subclasses, ASIs, and per-level class features later without rework.
---

# Level-Up-on-Descent + Multiclass MVP

## 1. Vision Recap (from `docs/design/gdd.md` §2, §3)

- Every run starts at level 1.
- Reaching each new floor grants one character level + a long rest.
- Gearless cap of level 3 per class → multiclassing is the gearless skill expression.
- Subclasses and prestige classes are gated behind gear/meta progression (out of MVP scope).

## 2. MVP Scope

What ships:

- On descend, each player is forced to pick a class to take a level in **before** they can act on the new floor.
- The choice set is **the two classes the player has not yet leveled in** (MVP rule — see §6 for why). Run 1 of a Fighter ends with Fighter 1 / Barbarian 1 / Monk 1 across three descents.
- No new class features beyond the level-1 features already in `classDef.classFeatures`. Multiclassing **into** a class for the first time grants that class's level-1 features (rage, Second Wind, etc.).
- Long rest already fires on descend — keep that behavior; no change.
- HP scales: per-level HP gain = `floor((hitDie/2 + 1 + conMod) * HP_MULTIPLIER)`, using SRD average (no rolling).
- Proficiency bonus already reads `player.level` in `shared/logic/combat.js:57` — just keep `player.level` as a synced cache of total level.

What is explicitly **deferred** (architecture supports them, code doesn't ship them yet):

- Level-2+ class features (Action Surge, Reckless Attack, Ki, etc.).
- Subclass selection (level 3 per SRD; gear-gated per GDD §5).
- Ability Score Improvements at levels 4/8/12.
- Wave 2 classes (Ranger, Paladin) and their level-1 features.
- Gear-driven class-level ceiling (the "Unlocks Fighter level 4" item pattern from GDD §5).
- Same-class re-leveling in the level-up UI (the underlying system permits it; only the choice filter restricts).

## 3. Data Model

### `PlayerState` (`server/state/PlayerState.js`)

Add three synced fields, keep `level` as a cache:

| Field | Type | Purpose |
|---|---|---|
| `classLevels` | `MapSchema<string, number>` | Per-class totals. Source of truth for build state. |
| `levelUpHistory` | `ArraySchema<string>` | Ordered class ids — index `i` = class chosen at level `i+1`. Length always equals total level. |
| `pendingLevelUp` | `boolean` | True from descend until `choose_level_up` resolves. Client gates input. |
| `level` | `number` (existing) | Cached `sum(classLevels.values)`. Recomputed alongside any mutation. |

`levelUpHistory` is the canonical ordering — used to decide "is this the first time this player has taken a level in class X?" for the multiclass-grants-features rule.

### Class definitions (`shared/data/classes/*.js`)

Stable shape today is "level 1 stats only." To stop hard-coding level 1 throughout the codebase, introduce an explicit `levels` table on each class def. MVP fills only level 1; levels 2+ are stubs that consciously grant nothing:

```js
// shared/data/classes/fighter.js
export const FIGHTER = {
  id: 'fighter',
  hitDie: 10,
  baseAbilityScores: { ... },
  saveProficiencies: ['str', 'con'],
  startingWeaponId: 'longsword',
  startingArmorId: 'chain_mail',
  canClimb: false,

  // NEW — per-level progression table.
  // MVP only fills level 1; 2/3 are explicit stubs so future expansion is additive.
  levels: {
    1: { features: ['second_wind'], grants: { fightingStyle: 'dueling', feat: 'alert' } },
    2: { features: [] },
    3: { features: [] }, // subclass slot — deferred (GDD §5: gated by gear unlock)
  },

  // Gearless cap per class (GDD §3). Will become gear-dependent later.
  gearlessLevelCap: 3,
};
```

`fightingStyle`, `feat`, `classFeatures` are folded into `levels[1].features` / `levels[1].grants`. The old top-level keys can be removed in the same change (single-pass migration; no compatibility shim — see CLAUDE.md "no backwards-compatibility hacks"). Existing tests/joins that read `classDef.fightingStyle` / `classDef.feat` switch to reading `levels[1].grants`.

`rageUses: 2` on Barbarian stays at top level — it's a per-class resource pool, not a per-level grant.

### New module: `shared/logic/class-progression.js`

Pure, RNG-free, framework-free — same convention as `combat.js` / `equipment.js`:

```js
// All read-only helpers operate on a player-shaped object with classLevels + levelUpHistory.
totalLevel(player)                  // → number
getClassLevel(player, classId)      // → number (0 if untaken)
getGrantedFeatures(player)          // → Set<string> — class features unlocked given history
                                    //   Rule: features from level[n] of class X granted only if
                                    //   getClassLevel(player, X) >= n AND first level in X
                                    //   was taken (for n=1) before counting.
getMaxLevelForClass(player, classId, ctx?)
                                    // → number. MVP returns classDef.gearlessLevelCap (=3).
                                    //   `ctx` is the future hook: pass inventory to read gear unlocks.
getEligibleClassChoicesForLevelUp(player)
                                    // → string[]. MVP: every class in CLASS_REGISTRY where
                                    //   getClassLevel(player, id) === 0 AND classLevels.size < 3.
                                    //   Single rule swap to enable same-class leveling later.
applyClassLevel(player, classId)    // → { ok, error?, features? }. Mutates classLevels,
                                    //   levelUpHistory, level. Calls computeHpForLevel() to
                                    //   bump maxHp. Caller is responsible for then calling
                                    //   recomputeStats(player) and the long-rest fill.
computeHpGainForLevel(classDef, conMod) // → number. (hitDie/2 + 1 + conMod) * HP_MULTIPLIER, floor.
```

Why a new module and not extending `equipment.js`: class-progression has no equipment slot concerns and will grow significantly (subclasses, ASIs, feature lookups). Keeping it separate keeps each module ~one job.

### `shared/data/constants.js`

```js
// Existing: LONG_REST_ON_LEVEL_UP = true (already there)
export const STARTING_CHARACTER_LEVEL = 1;  // floor 1 spawn level — already implicit; name it.
```

No new tuning constants required; HP math reuses `HP_MULTIPLIER`.

## 4. Server Flow Changes

### `DungeonRoom.onJoin`

1. Resolve class from join opts as today.
2. Seed `player.classLevels.set(classId, 1)`, `player.levelUpHistory.push(classId)`, `player.level = 1`, `player.pendingLevelUp = false`.
3. Apply level-1 features per `classDef.levels[1]` (hotbar seeding for `second_wind` / `rage` — same code path as today, just read from the new location).
4. HP computation unchanged at join — `classDef.getStartingHp(conMod)` already gives the doubled level-1 max.

### `DungeonRoom._descendTo(toFloor)` (`server/rooms/DungeonRoom.js:448`)

Insert one line after `_longRest`:

```js
p.pendingLevelUp = true;
```

That's the entire descend-side change. The long rest already runs; the level itself is **not** incremented here — incrementing is deferred to the `choose_level_up` handler so the level transition coincides with the player's class choice. This means while `pendingLevelUp` is true, the player is on floor N at their pre-descent total level. Acceptable because the next handler resolves synchronously on the player's input.

### New message: `choose_level_up { classId }`

Handler in `DungeonRoom.onCreate`:

1. Resolve player by `client.sessionId`. If `!player.pendingLevelUp`, silently drop (matches "Validation Discipline" in `docs/agent-context/protocol.md` §Validation).
2. Validate `classId` is in `getEligibleClassChoicesForLevelUp(player)`. Reject silently otherwise.
3. Call `applyClassLevel(player, classId)`:
   - Append to `levelUpHistory`, bump `classLevels`, bump `level`.
   - Add level-1 features of `classId` to hotbar if this is the player's first level in that class (the multiclass features rule). Hotbar wiring reuses today's `onJoin` seeding helper.
   - Bump `maxHp` by `computeHpGainForLevel(classDef, conMod)`. Set `hp = maxHp` (level-up long rest fully heals; already aligned with `_longRest` semantics).
   - Recompute derived stats (`recomputeStats(player)` from `shared/logic/equipment.js`) in case a feature changed AC inputs (Unarmored Defense etc.).
4. Set `pendingLevelUp = false`.
5. Broadcast a `combat_log` line: `"<name> took a level in <class> (now <build summary>)"`. Build summary = `levelUpHistory` formatted, e.g. "Fighter 1 / Barbarian 1".

### Protocol additions (`docs/agent-context/protocol.md`)

| Direction | Message | Payload | Notes |
|---|---|---|---|
| C→S | `choose_level_up` | `{ classId }` | Only honored while `player.pendingLevelUp`. Silently dropped otherwise. |

New `PlayerState` fields: list under combat.md per CLAUDE.md "Keeping Docs Current".

## 5. Client Flow Changes

### `DungeonScene`

1. Watch `state.players[mySessionId].pendingLevelUp`. When it flips true, open the level-up modal.
2. While the modal is open: suppress WASD input and attack input. (Cleanest: gate the dispatch in `InputHandler` on a `_inputLocked` flag owned by `DungeonScene`.)
3. Other players' avatars still render — they may move freely; the gate is per-player.

### New: `client/src/ui/level-up/LevelUpModal.js`

Following the `ui/hub/` panel module convention (one `render*Panel(scene)` function, gfx tracked via `_l`/`_r` or local equivalent). It does **not** need to be a separate Phaser scene — overlaying it on `HUDScene` or `DungeonScene` is fine and avoids scene-switch teardown.

Contents:

- Title: "Level <newTotal>"
- One button per eligible class. Each shows: class name, level-1 feature summary (read from `classDef.levels[1]`), hit die contribution, HP gain preview.
- On click → `client.sendChooseLevelUp(classId)`. Modal closes when server state shows `pendingLevelUp: false` (state-driven, not optimistic — matches existing client discipline of never predicting state).

### `client/src/network/ColyseusClient.js`

```js
sendChooseLevelUp(classId) { this.room?.send('choose_level_up', { classId }); }
```

## 6. Why "Force Choose from Untaken Classes" for MVP

Three reasons, in order:

1. **It makes the feature visible.** Re-leveling Fighter→Fighter→Fighter in MVP would grant zero new features (level 2+ deferred), zero new hotbar slots, just +HP. That's invisible to playtesters and won't validate the system.
2. **It maps cleanly to the GDD pillar.** GDD §3 explicitly frames gearless mastery as multiclass identification. Forcing the multiclass on descent is the most direct possible test of that premise.
3. **It's a one-line change to remove later.** `getEligibleClassChoicesForLevelUp` owns the rule. Dropping `getClassLevel(player, id) === 0` from the filter is the entire reversal.

Surfaced tradeoff: a player who wants to push toward a Monk 3 build cannot start that journey in MVP. That's the trade — we lose vertical specialization in exchange for a feature that exercises the breadth of the class roster. Worth flagging in the playtest brief.

## 7. Step-by-Step Build Plan

Each step ends with a verification. Designed so a step can land as one commit.

1. **`shared/data/classes/*` — refactor to `levels` table.**
   Move `classFeatures` / `fightingStyle` / `feat` into `levels[1]`. Add `gearlessLevelCap: 3`. Update join logic in `DungeonRoom.onJoin` to read from the new location. Add level-2 and level-3 stubs.
   → Verify: `node shared/tests/combat.test.js` and existing join smoke still pass; hotbar still seeds rage/Second Wind correctly in a manual run.

2. **`shared/logic/class-progression.js` — new module + tests.**
   Implement the seven helpers in §3. Add `shared/tests/class-progression.test.js`. Cover: total level, eligibility filter, `applyClassLevel` mutation, HP gain formula, `getGrantedFeatures` honoring the "first level in class" rule, gearless cap denial.
   → Verify: `node shared/tests/class-progression.test.js` passes.

3. **`server/state/PlayerState.js` — schema additions.**
   Add `classLevels: MapSchema<number>`, `levelUpHistory: ArraySchema<string>`, `pendingLevelUp: boolean`. `defineTypes` entries. Update `server/state/PlayerState.js` and any state-mirroring tests.
   → Verify: server boots; client receives the new fields without schema mismatch.

4. **`DungeonRoom.onJoin` — seed level-1 state through the new model.**
   Use `applyClassLevel`-equivalent seeding for level 1 (or a dedicated `seedLevel1(player, classId)` helper to keep the join path simple). Confirm starting HP / hotbar unchanged.
   → Verify: smoke join → player has `classLevels: { fighter: 1 }`, `level: 1`, `pendingLevelUp: false`.

5. **`DungeonRoom._descendTo` — set `pendingLevelUp = true` after `_longRest`.**
   → Verify: descend manually → both players have `pendingLevelUp: true` in state.

6. **`DungeonRoom.choose_level_up` handler.**
   Validate eligibility, call `applyClassLevel`, re-fill HP, recompute stats, clear flag, broadcast combat-log line. Hotbar seeding for newly-granted features uses the first empty slot; if every slot is bound, skip assignment and broadcast a combat-log line (`"<feature> learned — drag to hotbar to use"`).
   → Verify: `server/tests/level-up-flow.test.js` (new). Test cases: pendingLevelUp gates the message; ineligible class id is rejected; valid choice mutates state and grants the new class's level-1 features; hotbar-full case skips assignment and emits the notify line.

7. **Client — gate input + render modal.**
   Wire `pendingLevelUp` → input lock + modal show. Three class buttons, feature preview, HP delta preview. Send `choose_level_up` on click; close modal when server state clears the flag.
   → Verify: manual two-player run — both players descend, both see the modal, both must choose before they can move. Combat-log line appears for each choice.

8. **Doc updates (per CLAUDE.md "Keeping Docs Current").**
   - `docs/agent-context/combat.md` — list the three new `PlayerState` fields and the multiclass features rule.
   - `docs/agent-context/floors.md` — descend now sets `pendingLevelUp`; level-up resolves on choice.
   - `docs/agent-context/protocol.md` — `choose_level_up` row.
   - `docs/PROJECT_STRUCTURE.md` — new files: `shared/logic/class-progression.js`, `shared/tests/class-progression.test.js`, `client/src/ui/level-up/LevelUpModal.js`, `server/tests/level-up-flow.test.js`.
   - Flip this plan's frontmatter to `status: shipped` and update `docs/README.md` task map (or archive this file to `docs/archive/`).

## 8. Test Matrix

| File | Cases |
|---|---|
| `shared/tests/class-progression.test.js` | `totalLevel` sums correctly; eligibility filter excludes already-taken classes; eligibility excludes class at `gearlessLevelCap`; `applyClassLevel` updates all three fields; **`player.level === sum(classLevels.values)` invariant holds after every `applyClassLevel` call**; HP gain matches `floor((hitDie/2 + 1 + conMod) * HP_MULTIPLIER)`; `getGrantedFeatures` returns Fighter+Barbarian features only when both first-leveled; ineligible classId returns `{ ok: false, error }`. |
| `server/tests/level-up-flow.test.js` | `pendingLevelUp` set on descend; ineligible classId silently dropped; eligible classId mutates state; HP filled to new max; combat-log emission; subsequent message attempts (already resolved) silently dropped. |
| `shared/tests/combat.test.js` | Unchanged tests stay green; add one: `getProficiencyBonus` reads `player.level === sum(classLevels)` after `applyClassLevel`. |

## 9. Resolved Decisions

All confirmed 2026-05-17:

- **Timing.** Modal opens after arrival on the new floor.
- **Forced-multiclass MVP rule.** Yes.
- **HP rule.** SRD average × `HP_MULTIPLIER` per level.
- **`_longRest` on descend clears active buffs.** Unchanged.
- **Disconnect with `pendingLevelUp: true`.** `commitDeath` runs as today; no special handling.
- **Damage during modal.** No invulnerability. Floor design provides a safe spawn zone.
- **Hotbar collision.** Assign new feature to first empty slot; if none, skip and notify via combat log.
- **Cached `level` invariant.** Asserted in unit test; `applyClassLevel` is the only legal mutator (comment on `PlayerState.level` + module note).

## 9a. Deferred — Will Be Resolved by Future Architecture

Not problems for MVP; documented so the next reviewer doesn't re-raise them:

- **Descend race when one player still has pending.** Resolved by the future architecture that decouples player floor position from room floor (crawlers can be on different floors of the same dungeon).
- **Choice exhaustion at total level 4.** Not reachable in MVP — new classes will land before the dungeon has enough floors to expose it.
- **Late-joiner level mismatch.** Future architecture: late joiners start on floor 1 regardless of room state.
- **SRD multiclass save proficiencies** (only first class grants saves). MVP ignores; all level-1 grants apply. Revisit when player saves get heavier use (Wave 2 casters).
- **`run_history.class_levels` capture for analytics.** Defer; revisit before first playtest if multiclass-adoption data is wanted.

## 10. Future Expansion Hooks (Touchpoints Only — Not Built Here)

The architecture is shaped so each of these is additive, not a rewrite:

- **Per-level class features.** Fill out `classDef.levels[n].features`. `getGrantedFeatures` already iterates the table. Hotbar seeding extends to additional indices.
- **Subclass at level 3.** `classDef.levels[3]` carries a `subclassSlot: true` marker; when `applyClassLevel` hits a level with that marker, the level-up payload requires `{ classId, subclassId }`. Modal gains a second step. Eligible subclasses sourced from a new `shared/data/subclasses/` package (already listed in `PROJECT_STRUCTURE.md` "Not yet built").
- **Gear-driven level caps.** `getMaxLevelForClass(player, classId, ctx)` reads `ctx.inventory` for items with a `classUnlock: { classId, maxLevel }` field. The "Hunter's Masterwork Bow" pattern in GDD §5 drops in here.
- **ASIs at 4/8/12.** `classDef.levels[4].grants.abilityImprovement = 2`. Modal opens a stat-bump sub-step. Ability score validation reuses `shared/logic/character.js`.
- **Wave 2 classes (Ranger, Paladin).** Add to `CLASS_REGISTRY`. Their level-1 features land in `levels[1]`. Eligibility filter picks them up automatically.
- **Same-class re-leveling.** Drop the `=== 0` clause from `getEligibleClassChoicesForLevelUp`. Modal already handles a single-option case.

The bet: every one of these is an additive change against a table-driven data shape and a small, well-tested progression module. Nothing in this MVP locks us out of any of them.
