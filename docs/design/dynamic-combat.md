---
status: in-progress
updated: 2026-07-13
purpose: The dynamic-combat vision — Pillar 1 (knockback & positioning, full spec, shipped) and Pillar 2 (environmental gameplay, signposted). Canonical rules + formulas + tuning rationale; current behavior is mirrored in agent-context/combat.md §Knockback once shipped.
---

# Dynamic Combat — Movement, Positioning, Environment

**Vision:** combat that embodies the madcap, improvisational spirit of tabletop play —
the action/adventure/comedy register of the recent D&D movie. Fights should read as
choreography through the room, not stat exchanges at arm's length. Two pillars get us
there: (1) every hit moves someone, so position is a spendable resource; (2) the room
is full of things worth moving someone into. Pillar 1 is specified and shipped below.
Pillar 2 is a signpost awaiting its own design pass.

---

## Pillar 1 — Knockback & Positioning (shipped)

### Base rule

Every **melee** hit pushes the target `KNOCKBACK_BASE_PX` away along the
attacker→target line. Ranged hits do not push (arrows don't yeet people; also keeps
the kiting classes from self-defeating by pushing their target out of their own
threat). Every hit in a multi-hit Attack event pushes independently — two-weapon
fighting, Frenzy, Martial Arts, and Flurry strikes each shove again (a deliberate
identity point for multi-hit builds; see Open questions if it overtunes).

### Wall slam

If the push is **pinned** — the target's actual displacement ends up ≤
`WALL_SLAM_BLOCKED_RATIO` (0.5) of the intended push, with intended ≥
`WALL_SLAM_MIN_INTENDED_PX` — the target is slammed: it takes **half again the hit's
damage** (`floor(finalDamage × WALL_SLAM_DAMAGE_RATIO)`, min 1) as bonus damage.
Sliding along a wall is not a slam (displacement stays large); being driven into a
corner or head-on into a wall is. Locked doors and the arena boundary slam like
walls; platform side-walls slam ground-level targets. Slams can kill and credit the
attacker's kill count.

### Ledge drop

Knockback displacement runs the same perimeter-crossing elevation rules as movement
(`tryAutoClimb`): an elevated target pushed across a platform edge **falls to ground
level**, and the attacker still on the platform now has high-ground advantage on
every subsequent attack — the existing advantage source, no new rule. Pushes never
move a ground-level target *up* onto a platform: knockback treats platform perimeters
as walls for everyone at elevation 0 (climbing is voluntary; being punched up a wall
is not) — which is exactly what makes platform side-walls slammable.

### Class interactions

| Class | Interaction | Scaling |
|---|---|---|
| Barbarian | **Push farther on hit**: +`KNOCKBACK_BARBARIAN_PER_LEVEL_PX` per Barbarian level | Bonus × levelScale(barbarian level vs target level) |
| Fighter | **Braced**: pushed `KNOCKBACK_RESIST_PER_FIGHTER_LEVEL` (15%) less per Fighter level; +`KNOCKBACK_RESIST_SHIELD_BONUS` (20%) with a shield equipped; total capped at `KNOCKBACK_RESIST_CAP` (80%) | Resist × levelScale(fighter level vs attacker level) |
| Monk | **Vertical mobility** (existing `canClimb`) with **climb fatigue**: climbing a platform wall on a floor deeper than your climb level applies a slow — see below | Fatigue = f(floor − climb level) |
| Rogue | No new mechanic — Sneak Attack eligibility (advantage / skirmish both-moving) already pays for movement and flanking, and scales inherently with Rogue levels | — |

### Underlevel dissipation (the multiclass governor)

`levelScale(ownLevel, opposingLevel) = clamp(ownLevel / opposingLevel,
UNDERLEVEL_SCALE_FLOOR, 1)` with floor 0.4.

- The **base push** scales by attacker *total* level vs target level — a level-1
  anything barely budges a level-3 enemy; deep-floor monsters have heft.
- The **Barbarian bonus** scales by *Barbarian* level vs target level.
- The **Fighter resist** scales by *Fighter* level vs *attacker* level.

The 0.4 floor is the "dissipated, not useless" guarantee: a splashed level always
keeps ≥40% of its knockback value. Dedicated 3-level investment against an even-level
opponent keeps 100%.

Worked examples (constants at current values):
- Barbarian 3 hits a level-1 goblin: 20 + 12×3 = **56 px** — across most of a melee ring.
- Barbarian 1 hits a level-3 enemy: 20×0.4 + 12×0.4 ≈ **13 px** — a stumble.
- Level-3 enemy hits Fighter 3 + shield: 20 × (1 − 0.65) = **7 px** — braced.
- Level-3 enemy hits Fighter 1 + shield: 20 × (1 − 0.35×0.4) = **17 px** — modest.

### Monk climb fatigue

Climbing a platform **wall** (perimeter crossing outside a step gap — steps never
fatigue anyone) on floor `N` checks the climber's **climb level** = highest class
level among taken classes that grant `canClimb` (Monk, Rogue). If climb level < N,
apply the `climb_fatigue` condition: speed × `CLIMB_FATIGUE_SPEED_MULT` (0.5) for
`(N − climbLevel) × CLIMB_FATIGUE_MS_PER_FLOOR_DEFICIT` (1000 ms per floor of
deficit), capped at `CLIMB_FATIGUE_MAX_MS` (4000). A Monk who keeps pace never slows;
a Monk-1 splash on floor 6 clambers up and is vulnerable for a beat. Enemies never
fatigue (their `canClimb` is a def flag, not a skill).

### Tuning constants (shared/data/constants.js)

| Constant | Value | Feel target |
|---|---|---|
| `KNOCKBACK_BASE_PX` | 20 | Visible stumble, ~⅓ of melee ring (64) |
| `KNOCKBACK_BARBARIAN_PER_LEVEL_PX` | 12 | Barb 3 ≈ full melee-ring eject |
| `KNOCKBACK_RESIST_PER_FIGHTER_LEVEL` | 0.15 | Fighter 3 = 45% |
| `KNOCKBACK_RESIST_SHIELD_BONUS` | 0.20 | Sword-and-board identity |
| `KNOCKBACK_RESIST_CAP` | 0.80 | Never fully immovable |
| `UNDERLEVEL_SCALE_FLOOR` | 0.4 | "Dissipated, not useless" |
| `WALL_SLAM_DAMAGE_RATIO` | 0.5 | "Half again" per the pillar |
| `WALL_SLAM_MIN_INTENDED_PX` | 12 | Tiny pushes can't slam |
| `WALL_SLAM_BLOCKED_RATIO` | 0.5 | Pinned = ≤ half the push landed |
| `KNOCKBACK_STEP_PX` | 8 | Swept-push sub-step (walls are thin — no tunneling) |
| `CLIMB_FATIGUE_MS_PER_FLOOR_DEFICIT` | 1000 | |
| `CLIMB_FATIGUE_SPEED_MULT` | 0.5 | |
| `CLIMB_FATIGUE_MAX_MS` | 4000 | Splash-monk worst case |

Enemy stat blocks carry a `level` field (goblin 1, dog 1, skeleton 2) feeding both
sides of the scaling. New monsters must declare it (validator-enforced when
`enemies.test.js` lands in Sprint F).

### Architecture (for future agents)

- **`shared/logic/knockback.js`** — pure module, RNG-free: `levelScale`,
  `computeKnockbackPx` (all scaling math), `resolveKnockback` (stepped swept push
  against obstacle rects + bounds, elevation via `tryAutoClimb`, slam
  classification). Never mutates game state.
- **`shared/logic/class-progression.js`** — `getKnockbackProfile(player, hasShield)`
  → `{ bonusPx, bonusClassLevel, resistFraction, resistClassLevel }`. The only place
  class identity enters the system.
- **`server/systems/CombatSystem.js`** — applies knockback at every melee
  damage-application site (main / offhand / frenzy / MA / flurry / enemyAttack),
  mutates target position/elevation/hp, emits log fragments. Needs `terrain`
  (walls, locked doors, platforms, bounds) passed from `DungeonRoom` /
  `AISystem`; without terrain, pushes still apply but nothing slams (how the
  pre-knockback tests keep passing).
- **`server/systems/MovementSystem.js`** — climb-fatigue detection (perimeter-wall
  crossing up, not step) + the fatigue speed multiplier; emits events for
  `DungeonRoom` to convert into conditions + log lines.
- Client: **zero required changes** — positions/elevation are already synced and
  interpolated; log lines ride combat_log. (Watch: entity render depth on elevation
  change — verify the client re-depths on the elevation field, not only at spawn.)

### PvP flags

- Knockback is symmetric in PvP (when player-vs-player attacks land): a Barbarian
  chain-shoving a player into a corner is the fantasy, but corner-stunlock feel needs
  a playtest; the lever is a brief per-target push-immunity window after a slam.
- Flurry (2 pushes) + Open Hand stagger is a strong pin combo — watch alongside the
  existing stagger flags in `open-hand-progression.md`.
- Wall-slam damage in PvP multiplies burst; if TTK drops too far, scale
  `WALL_SLAM_DAMAGE_RATIO` down for player targets only.

### Open design questions

1. Per-hit vs per-event push: multi-hit builds currently shove per hit. If dual-wield
   becomes the degenerate shove build, collapse to "strongest single push per event."
2. Should heavy weapons (greatsword) carry an inherent push bonus, making weapon
   choice part of the shove game? (Natural follow-up; data-only once `pushBonusPx`
   is read off the weapon def.)
3. Ranged push exceptions — a future heavy crossbow or thunderwave-style effect wants
   push; when one lands, add an opt-in `push` field on the weapon/effect rather than
   revisiting the melee-only default.
4. Fall damage on ledge drops — currently dropping is positional punishment only.
   A small HP bite (1d6?) would sharpen it, but risks double-punishing with
   high-ground advantage. Playtest first.
5. Knockback on the final killing blow is skipped (corpses stay where they died, loot
   stays reachable). Revisit if "kicking the body off the ledge" turns out to be a
   comedy beat worth having.

---

## Pillar 2 — Environmental Gameplay (signpost — design pass pending)

The Divinity: Original Sin register: dungeons dense with interactable objects that
turn positioning wins into environmental payoffs. **Not yet specified** — this
section reserves the shape so Pillar 1 code leaves the right seams.

- **Object families to explore:** torches/braziers (fire, light), oil pools/barrels
  (surface + ignition combo), effect clouds (poison, fog — LoS interaction), pushable
  furniture (dynamic cover, blockades), chandeliers/ropes (traversal + drop attacks),
  the existing spike trap generalized into a hazard family.
- **The core interaction loop:** knockback (Pillar 1) is the delivery mechanism —
  shove the goblin *into the brazier*, off the ledge *into the oil*. Environmental
  objects should read as knockback targets first, click-to-use objects second.
- **Engine seams Pillar 1 already leaves:** the wall-slam obstacle test takes
  arbitrary rects (a crate is just a slammable rect that can also break); the hazard
  check in `_checkTraps` generalizes to a hazard registry; `unlock.js` shows the
  data-driven-condition pattern environmental triggers will reuse.
- **Dependencies:** Sprint F behavior palette (enemies reacting to hazards), Sprint V
  art (objects need to read visually), floor-authoring builders (Sprint E) so objects
  are declared in floor data like chests/traps are today.

The dedicated design doc now exists: **`environmental-gameplay.md`** — object
families, the element interaction matrix, biome catalog, engine sketch, and phasing
(Waves E1–E3). This section stays as the pillar summary; that doc is canonical. Do
not build object types before its open questions (⚑) are resolved with the designer.
