---
status: design-only
updated: 2026-07-13
purpose: Dynamic-combat Pillar 2 — environmental gameplay design. Clouds, pools, ground hazards, breakables, set pieces, the element interaction matrix, biome object catalog, and phasing. Collaboration draft — decision points marked ⚑. No implementation yet.
---

# Environmental Gameplay — Pillar 2 Design

**Vision:** the room is a weapon. Pillar 1 made position a resource; Pillar 2 makes
the environment the payoff for spending it. The register is Divinity: Original Sin's
surface-and-cloud chemistry filtered through the D&D-movie's improv comedy — the
fight where someone shoves a goblin into the brazier, the brazier tips into the oil,
the oil runs under the bookcase, and now everyone is making very different decisions.

**Design principles**

1. **Knockback is the delivery mechanism.** Most environmental payoffs should be
   reachable by shoving — an enemy into a hazard, an object onto a surface. Click-to-
   use is the fallback interaction, not the primary one.
2. **Everything is data on the existing shapes.** Areas are circles/rects with a type
   and a timer; objects are entities with HP and an on-break table; set pieces are
   knockback targets. No new physics — the engine already sweeps circles against
   rects.
3. **Readable before deep.** Every element has one color, one silhouette, one verb.
   A player who has never seen coal dust must correctly guess "that will explode"
   from its look. Chemistry depth comes from *combining* legible pieces, never from
   hidden rules.
4. **Nonmagic parity through improvisation.** Casters (Wave 2+) will trigger elements
   with spells; martials do it with carried consumables (torch, oil flask, fire pot)
   and the environment itself (knock the brazier onto the oil). Every matrix
   interaction must be reachable without a spell slot.
5. **Comedy is a mechanic.** Chain reactions are allowed to be slightly too big.
   Friendly fire is real (⚑ see Open Questions). The extraction-stakes tension is
   what keeps slapstick from being noise.

---

## The Five Object Families

### 1. Effect clouds (airborne volumes)

Circle areas that tick effects on entities inside, drift nowhere (v1), and dissipate
on a timer. Clouds are the **line-of-sight layer**: most block or degrade ranged
targeting, which makes them tools for both aggressor and escapee.

| Cloud | Color/read | Effect while inside | Duration | Element tags |
|---|---|---|---|---|
| **Poison gas** | sickly green | `poisoned` DoT (1 dmg/s) + lingers 3 s after leaving | 12 s | `gas`, `flammable` (detonates) |
| **Spore pollen** | gold motes | `disoriented` — attack rolls at disadvantage | 10 s | `gas`, `flammable` (flash-burns) |
| **Smoke / dust** | grey | blocks ranged LoS (`isLineBlocked` treats as obstacle); melee unaffected | 8 s | `gas`, smothers fire it passes over |
| **Water vapor / steam** | white | none by itself; light obscurement (ranged disadvantage through it) | 8 s | `wet`, `conductive` |

Cloud sources: vents (periodic emitters placed in floor data), breakables (urns,
puffballs), consumables (smoke bomb), and matrix reactions (water + fire → steam).

### 2. Liquid pools (ground surfaces)

Circle/blob areas that apply effects on **standing** contact and transform via the
element matrix. Pools are the **surface layer** — the things you set on fire,
electrify, or shove people into.

| Pool | Color/read | Effect standing in it | Duration | Element tags |
|---|---|---|---|---|
| **Oil** | glossy black | `slowed` 30% (viscous); slippery — knockback through it travels +25% farther | 60 s or until ignited | `flammable`, `liquid` |
| **Burning oil** | black + flame | `burning` — 1d4 fire/s while in, keeps burning 2 s after leaving | 10 s, then leaves scorched (inert) | `fire` |
| **Water** | blue sheen | douses `burning`; applies `wet` 6 s (vulnerable to shock, immune to burning) | persistent (placed) / 30 s (spilled) | `wet`, `conductive` |
| **Electrified water** | blue + arcs | `shocked` — 1d6 lightning on entry + attack timer staggered | arcs for 4 s then reverts to water | `shock` |
| **Blood** | dark red | cosmetic v1 — combat residue; slippery variant deferred (⚑) | 45 s | `liquid` |
| **Ooze / nutrient sludge** | bile green | `slowed` 50%; caustic — 1 acid/s | 30 s | `liquid`, `caustic` |

### 3. Ground hazards (persistent solids)

The existing spike trap generalized into a family. Hazards are small areas with
enter/stand triggers; unlike pools they don't transform — they're the reliable,
"dumb" layer that rewards forced movement most directly.

| Hazard | Trigger | Effect | Notes |
|---|---|---|---|
| **Spike trap** (exists) | enter, cooldown 5 s | 4 dmg, DEX save half | Current `_checkTraps` behavior — becomes the family's reference implementation |
| **Spike pit** | enter | 2d4 + `prone` beat (0.75 s no move/attack) | No cooldown — it's a pit; knock enemies in |
| **Caltrops** | enter | 1d4 + `slowed` 40% for 4 s | Player-deployable consumable; enemies path through unaware (until AI hazard-awareness lands) |
| **Debris / rubble** | standing | `slowed` 25% | Created by collapses (see set pieces); shapes the arena mid-fight |
| **Scroll pile** | standing | `slowed` 25%; **highly** `flammable` — ignites into a fast fire pool | Bookcase product; the Library's signature floor state |
| **Bone pile** | enter | trip check (DEX save or `prone` beat) | Crypt flavor debris |

### 4. Breakables (objects → areas)

Entities with small HP pools (or a knockback-slam threshold — ⚑ below) that convert
into an area when destroyed. Breakables are how floor authors *stock* a room with
potential energy.

| Object | HP / break trigger | On break | Biome home |
|---|---|---|---|
| **Oil barrel** | 5 hp, or slammed | Oil pool (r ≈ 60 px) | Mines, Warrens |
| **Water barrel / cistern** | 5 hp | Water pool | Sewer, Mines |
| **Crate** | 4 hp | Debris patch + (loot-table roll — crates double as minor containers) | everywhere |
| **Funerary urn** | 1 hp | Dust cloud (smoke-type) + occasional loot | Crypt |
| **Spore puffball** | 1 hp, or stepped on | Pollen cloud | Fungal Deep |
| **Gas bladder / nutrient pipe** | 3 hp | Poison gas cloud + ooze dribble | Sewer Delve |
| **Coal cart** | 6 hp, or shoved (it rolls! ⚑ v2) | Coal-dust cloud — the explosive one | Mines |
| **Alchemical shelf** | 3 hp | Random: one of poison gas / oil / small fire pool — the gamble shelf | Library, Crucible |

Breakables take damage from any hit (they have AC ~5, auto-hittable) and from
knockback: an enemy **slammed into a breakable** breaks it — the Pillar 1 wall-slam
check already knows "pinned against this rect"; breakables are slammable rects that
give way. Slamming someone *through* a barrel is the whole fantasy.

### 5. Set pieces (one-shot interactables)

Large objects that change the room state once, dramatically. Primary trigger is
knockback (shove a character into them / shove them over); secondary is attack
damage; some have a use-key interaction. Each is authored in floor data like chests.

| Set piece | Trigger | Result | Biome home |
|---|---|---|---|
| **Standing brazier** | knocked over (slam or 3 hp) | Fire pool (r ≈ 50 px) in the tip direction; the room's default ignition source | Crucible, Crypt, everywhere |
| **Toppling statue** | slam a character into it, or attack (8 hp) | Falls along tip direction: 3d6 to anything under, leaves debris line; brief windup so it reads | Crypt, Manifold Core |
| **Crumbling wall** | character slammed into it (counts as wall slam first) | Wall section becomes debris + opens the gap — rooms can be *remodeled* mid-fight; slammed victim takes the slam bonus twice | Warrens, Mines |
| **Bookcase** | knocked over (slam or 4 hp) | Scroll-pile hazard in a line; anything under takes 2d4 and is `prone` a beat | Library |
| **Chandelier / hanging fixture** | shoot the anchor (ranged only — the Rogue/ranged payoff) | Drops: 3d6 + fire pool if lit | Library, Crypt |
| **Ore-cart rail stop** | use-key or shove | Sends the cart rolling down its rail — moving hazard, 2d6 + big knockback to anything hit | Mines |
| **Valve wheel** | use-key, 2 s channel | Vents steam cloud / floods a channel (water pool) on a fixed line — the utility set piece | Sewer, Crucible |
| **Charged conduit** | attack or slam | Arcs: electrifies all `conductive` areas within 100 px for 4 s | Manifold Core, Crucible |

---

## The Element Matrix (the chemistry)

Interactions are **data**: `(trigger element) × (area tag) → transformation`. This
table is the single source of truth; everything else is delivery.

| Trigger ↓ / Target → | Oil pool | Water pool | Poison gas | Pollen | Smoke | Steam | Scroll pile |
|---|---|---|---|---|---|---|---|
| **Fire** (torch, fire pot, burning entity, fire pool contact) | → **burning oil** | → steam cloud (small) | → **detonation** (2d6 burst, cloud gone) | → **flash burn** (1d6 burst in area, cloud gone) | no effect | no effect | → **fire pool** (fast, brief) |
| **Shock** (conduit, shock wand, electrified contact) | no effect | → **electrified water** | no effect | no effect | no effect | → **arc burst** — 1d6 to everyone in cloud, cloud gone | no effect |
| **Water** (water barrel, valve flood) | washes away (shrinks) | merges | no effect | knocks down → gone | no effect | merges | dampens (not flammable 20 s) |
| **Smother** (smoke over fire) | — | — | — | — | — | — | extinguishes burning pools it overlaps |

Propagation rules (keep them dumb and legible):
- **Contact spreads fire**: a burning entity standing in oil ignites it; a fire pool
  touching an oil pool ignites it after 1 s (visible fizz — players get one beat to move).
- **`burning` entities** are walking triggers: an enemy shoved through burning oil
  and then into the pollen cloud sets off the flash. This is the chain-reaction
  engine and it needs no extra rules — conditions carry element tags.
- **One transformation per area per tick** — no infinite loops (steam → water → steam).
- Detonations never destroy walls or set pieces (only the crumbling wall reacts to
  its specific trigger). Scope stays combat, not terrain deformation. (⚑)

## Conditions this adds

Reuses the existing conditions system; the engine gap is that **enemies currently
have no condition list** — that's the first implementation dependency.

| Condition | Effect | Cure |
|---|---|---|
| `burning` | 1d4 fire/s, spreads to flammables you touch | enters water, 3 s timeout, (roll on the ground — ⚑ a Dash-key "drop and roll"?) |
| `poisoned` | 1 dmg/s | leave the source + 3 s |
| `wet` | immune to `burning`, +1d6 taken from shock, douses on apply | 6 s |
| `shocked` | attack timer staggered (reuse Open Hand stagger mechanics) | instant (on-hit effect) |
| `slowed` | speed × (1 − X), source-defined X | leave the surface |
| `disoriented` | attack disadvantage | leave cloud + 2 s |
| `prone` (beat) | 0.75 s no move/attack — a knockdown beat, not a stance | timer |

## Player tools (martial improvisation kit)

New consumables (all use the reserved `thrown` branch in `pickAttackMode` — thrown
items target a **point**, not an entity, the first non-entity targeting case):

- **Torch** — offhand-equippable (light source later; fire *trigger* now). Throwable:
  ignites what it lands on. Cheap, buy 3.
- **Oil flask** — thrown: creates a small oil pool. The setup half of the combo.
- **Fire pot (alchemist's fire)** — thrown: small fire pool + ignition. The payoff half.
- **Smoke bomb** — thrown: smoke cloud. The Rogue's disengage button and the
  anti-archer tool.
- **Caltrop bag** — deployed at feet: caltrop hazard. The Fighter's zone control.
- **Water bladder** — thrown: douses burning allies / makes a conductive puddle.
  The unglamorous lifesaver.
- Existing **single-use wands** (GDD §5) slot in as element triggers: firebolt wand =
  ranged fire trigger; a shock wand joins the list. Wands are the martial's "spell
  for a day" — the matrix makes them dramatically better than their damage line.

Class synergy notes (no new class mechanics needed — the kits already interact):
Barbarian shoves things over and through (brazier bowling); Fighter braces and
zone-controls (caltrops + the only one who can stand his ground in a slick);
Monk's mobility bait-and-switches enemies across hazards (climb away, they path
through the fire); Rogue's skirmish rewards fighting *through* clouds and slicks,
and ranged chandelier/anchor shots are theirs.

## Biome environmental identity

Each biome gets a signature loadout so rooms *feel* like their faction. (Biomes per
`gdd_crafting.md` §3.)

| Biome | Signature objects | Element bias | The set-piece moment |
|---|---|---|---|
| **The Warrens** (intro) | Crates, junk debris, crude spike pits, one oil barrel — the tutorial chemistry set | neutral | First barrel someone breaks teaches "objects become surfaces" |
| **Sewer Delve** | Nutrient pipes (gas), ooze pools, water channels, valve wheels | poison / water | Flood the channel while enemies wade it |
| **Fungal Deep** | Spore puffballs everywhere, bioluminescent caps (light), ooze | pollen / caustic | One torch into the spore field — the biome-scale flash |
| **The Mines** | Oil barrels, coal carts + rails, support-beam crumbling walls, lantern posts | fire / collapse | The rolling ore cart; coal-dust detonation |
| **Elemental Crucible** | Braziers, steam vents, charged crystals, fire rivulets (authored fire pools) | fire / shock / steam | Conduit arc electrifying the vent steam mid-fight |
| **The Crypt** | Urns, bone piles, embalming-fluid pools (flammable!), toppling sarcophagi | dust / fire | Statue topple down the burial row |
| **Haunted Library** | Bookcases, scroll piles, candelabras, chandeliers, the alchemical shelf | fire (catastrophically) | The whole wing goes up — the Library WANTS to burn, which is why its loot is knowledge items you must extract intact (⚑ items damaged by fire?) |
| **Manifold Core** | Conduits, coolant pools (water), collapsing pillars, detonating construct cores | shock / collapse | Chain: core detonation → pillar → debris field reshaping the endgame arena |

## Engine sketch (design-level — for scoping, not implementation)

- **`EffectAreaState`** — one synced schema for clouds/pools/hazards: `{ id, kind,
  x, y, radius, expiresAtMs }`. Client renders from `kind`; server ticks effects.
  Everything in families 1–3 is this one shape.
- **`shared/data/environment/`** — area defs (effects, tags, durations), object defs
  (hp, onBreak table), the element matrix as data. Validator suite mirrors
  `items.test.js` (every onBreak spawns a known area, every matrix cell names known
  tags — floor 10 must not crash on an unvalidated urn).
- **Hazard tick generalizes `_checkTraps`** — the spike trap becomes the first
  registry entry rather than a special case.
- **Breakables ride EnemyState-adjacent plumbing** — attackable HP-bearing rects;
  wall-slam-into-breakable hooks the existing slam classification (the obstacle rect
  carries `breakable: id`).
- **Set pieces are floor-data entities** like chests/stairs with a trigger def —
  `unlock.js`'s data-driven-condition pattern is the template.
- **Dependencies**: enemy condition lists (none exist today — first build item);
  Sprint F AI hazard-awareness (enemies path through fire obliviously until then —
  acceptable comedy for v1, exploit-grade by v2); Sprint V art (silhouette/color
  language is load-bearing); the `thrown` targeting branch (point-target, first use).
- **Performance budget**: area count cap per floor (~40 active), circle-vs-circle
  tick checks only, no per-pixel surfaces. Fine at 20 Hz tier-1; re-measure at
  tier-4 player counts.

## PvP & balance flags

- **Friendly fire** (⚑ headline question): pools/clouds don't distinguish teams in
  Divinity and shouldn't here — your fire pot burns your Barbarian. This is the
  improv-comedy engine AND a griefing vector. Proposal: full friendly fire from
  *environmental* areas, but a teammate can't *trigger* team damage into you more
  than once per N s (anti-griefing rate limit, exact shape TBD in playtest).
- **Smoke spam** — LoS denial stacking in PvP; cap simultaneous player-thrown clouds.
- **Burning TTK** — `burning` + wall-slam + high-ground can delete a player; tune
  fire DoT last, after Pillar 1 numbers settle.
- **Extraction interaction** — dropping a fire pool on the extraction portal ritual
  radius is legitimate play (60 s channel!) and probably the single best PvP use of
  the whole system. Deliberate; watch it.

## Phasing proposal

- **Wave E1 (MVP chemistry loop):** `EffectAreaState` + hazard registry; oil barrel,
  water barrel, crate; oil / burning-oil / water pools; torch + oil flask + fire pot;
  fire×oil and water×burning matrix cells; enemy `burning`/`slowed`; caltrops.
  *Proves: break → pool → ignite → shove-into, end to end.*
- **Wave E2 (clouds + shock):** the four clouds, LoS integration, gas/pollen
  detonations, conduits + electrified water, smoke bomb, braziers, vents/valves.
- **Wave E3 (set pieces + biome identity):** statues, bookcases, crumbling walls,
  carts, chandeliers; per-biome authoring pass; AI hazard-awareness (with Sprint F);
  chain-reaction polish.

## Open questions for the design session ⚑

1. **Friendly fire policy** — full, none, or the rate-limited proposal above?
2. **Breakables: HP or slam-only?** HP + slam (proposed) lets ranged builds
   participate; slam-only makes positioning mandatory. Leaning HP+slam.
3. **Blood pools** — cosmetic v1 (proposed), or give them the slippery tag and make
   heavy melee fights self-hazarding?
4. **`burning` self-rescue** — auto-timeout only, or a "drop and roll" input (Dash
   key while burning) that rewards attention? The roll is very D&D-movie.
5. **Persistence philosophy** — do scorch marks / debris last the whole floor
   (rooms accumulate history — expensive, wonderful) or fade on timers (proposed)?
6. **Terrain deformation scope** — crumbling walls are the only terrain change
   proposed. Is remodeling rooms a line we hold, or do detonations eventually crack
   floors/doors?
7. **Library loot-vs-fire tension** — should fire damage destroy ground loot in its
   area (the Library dilemma: burn the archers or preserve the scroll drops)?
8. **Rolling objects (ore cart)** — the only *moving* hazard proposed; it needs real
   pathing along a rail. Worth the engine cost in E3, or cut?
