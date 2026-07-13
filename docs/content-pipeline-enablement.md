---
status: design-only
updated: 2026-07-07
purpose: Plan + playbook for getting the project to the point where designers (human or agent-assisted) can author floors, monsters, and visuals without touching engine code. Assessment of the current pipelines, the capability gaps, the agentic workflows that close them, and pointers to the roadmap sprints that build the tooling.
---

# Content Pipeline Enablement — Floors, Monsters & Art

**The bar for "designer-ready":** a designer authors content as declarative data (or a written brief an agent compiles to data), gets machine feedback in seconds — validation errors, a visual preview, a balance report — and never reads engine code or boots the full game until final in-game review. Everything below is measured against that bar.

Companion docs: sprint sequencing in [`roadmap-2026-07.md`](roadmap-2026-07.md) (Sprints E–G); current floor/enemy behavior in `agent-context/floors.md` and `agent-context/geometry-elevation.md`.

---

## 1. Where the pipelines stand today

### Monsters — closer than expected

Adding a monster today takes four touches, all data:

1. A def file in `shared/data/enemies/` — `goblin.js` is an exemplary structural reference: full SRD stat block (identity, defense, ability scores, traits, actions) *plus* a clearly-separated "Engine values" section (`attackBonus`, `damageDice`, `speed`, `detectionRadius`, `canClimb`) that the runtime actually reads.
2. An export line in the tier barrel (`tier1.js`).
3. A loot table entry in `shared/data/loot/tier1.js` (schema is documented in-file; pool refs like `@potion_any` supported).
4. Placement on a floor (`enemies: [{ id, type, x, y }]`).

**What blocks a designer:**

- **No enemy validator.** `items.test.js` guards item/loot/vendor/recipe integrity, but nothing checks that an enemy def carries the engine-required fields, that every enemy has (or deliberately lacks) a loot table, or that every `type` placed on a floor resolves in the enemy registry. A typo'd def fails at first aggro, at runtime, in-game.
- **The engine ignores most of the stat block.** AI is a single melee-chaser state machine (`idle → aggro → pursue → melee`). The goblin's SRD shortbow action is inert data. A designer can currently create exactly one *kind* of monster — a melee chaser with different numbers. Ranged attackers, fleeing, patrols, pack behavior: all engine work first (Sprint F).
- **No visual identity.** `DungeonScene` renders every enemy with the shared `ENEMY_COLOR` circle. Defs need `color`/`radius` (placeholder-graphics era) so a floor with three monster types is readable; when sprites land this becomes a `sprite` key.
- **No balance feedback.** Whether a new monster is a pushover or a party-wiper is discoverable only by playing. Yet `shared/logic/combat.js` is pure and RNG-injected — a headless Monte Carlo simulator (level-N class with loadout X vs. monster Y → hit rates, time-to-kill both directions, death probability) is a small script away, and it is the single highest-leverage tool for both human and agent designers (Sprint G).

### Floors — the real gap

A floor file today is raw pixel coordinates plus hand-maintained *correlated* geometry: walls must be manually split into segments that leave gaps exactly where door rects sit; `rooms[].doors` must list the right door ids; platform steps must sit on perimeter midpoints; stairs/chests must not overlap interact ranges (the floor-3 plan's "Risk" section documents exactly this fragility). Floor 3 shipped as a 200-LOC verbatim clone of floor 2, including duplicated helper functions. There is no schema validation (a malformed file crashes mid-`_loadFloor`) and no way to *see* a floor without booting server + client.

**What a designer needs, in dependency order:**

1. **Builders** (Sprint E): `shared/data/floors/builders.js` — `walledRoom({center, half, doors: ['n','e']})` emits consistent wall segments + door rects + room entry; `platform`, `enemyCluster`/`arm` helpers likewise. Floors become short declarative files; the correlated-geometry problem disappears into tested helpers.
2. **Validator** (Sprint C, boot-time): required keys, stair `toFloor` targets exist or are `permanentLock`, chest items resolve, enemy types resolve, door/room id cross-references hold, geometry rects well-formed. Turns runtime crashes into named authoring errors.
3. **Preview renderer** (Sprint E ride-along): a node script — `node scripts/render-floor.js 3 > floor3.svg` — that draws walls, doors, platforms, steps, spawns, enemies (color-coded), chests, stairs to SVG from the floor data alone. Cheap (pure data → rects), and it changes the authoring loop from "boot the game and walk around" to "look at the picture." This is also what lets an *agent* check its own floor-authoring work.
4. **Not now: a visual editor.** Tiled-tilemap integration is the long-range intent (`tech_spec.md` §3.4/§4) and the right call *when sprites and tilemaps exist*. Building editor tooling before the floor format stabilizes (unlock conditions, elevation, future hazards) would lock in today's format. The builders + preview + agent-as-compiler combination below covers the gap until then. Note this is about Tiled as an *authoring format* — rendering floors *with tiles* is a separate, much cheaper thing (see next section) and is not deferred.

### Art — from placeholder circles to sprites and tiles (Sprint V)

The client currently loads **zero** assets — no preload step, no `this.load.*` call anywhere, no assets directory. Every entity is a colored circle (`DungeonScene`), every floor a set of tinted rects (`RoomRenderer`), every UI element text-on-rectangle. That blank slate is an advantage: nothing to migrate, and the pipeline can be built lean from day one.

**The critical split — three tiers with very different costs:**

1. **Entity/item sprites** (players, enemies, chests, stairs, item icons) — *cheap*. Pure client change: a preload step, `add.sprite` instead of `add.circle`, a `spriteKey` field on enemy defs and `ITEM_REGISTRY` entries (default = the id). The server never knows; the data format barely changes.
2. **Floor tiles as a visual skin over existing rect data** — *moderate*. A tile-painter in `RoomRenderer` that auto-tiles ground/walls/platforms *from the same rects the server already uses for collision*. No authoring-format change, no server change; the floor builders + SVG preview plan (Sprint E) stays fully valid. Visual fidelity of a tilemap without the format migration.
3. **Tiled tilemaps as the authoring format** — *expensive, still deferred* (see #4 above). Do not conflate with tier 2.

**Pipeline decisions that keep it lean:**

- **No R2 yet.** Assets go in `client/public/assets/`; Vite copies them into `dist/` and Cloudflare Pages serves them CDN-fronted for free. The R2 pipeline (`tech_spec.md` §3.4) earns its keep when assets get heavy (audio, many atlases) or need swapping without a client redeploy — neither is true for a first art pass. `VITE_ASSET_BASE_URL` can still be honored with a `''` default so the R2 move later is config, not code.
- **Fallback-first rendering.** The sprite path checks `textures.exists(spriteKey)` and falls back to today's colored circle/rect. Art lands incrementally; a missing sprite is a visual note, never a crash or a blocked sprint. Pair with an **asset-coverage validator** in the house style: every enemy/item id resolves to a shipped texture or is explicitly listed as placeholder — a report, not a hard failure.
- **`pixelArt: true`** (+ appropriate zoom) in the Phaser config the moment pixel-art tiles land, or everything will render blurry-scaled.
- **Where art comes from — a taste gate, then automation.** The fastest legitimate route is CC0 packs: Kenney (huge, coherent), 0x72 DungeonTileset II (16 px dungeon set, thematically on the nose), DungeonCrawl Stone Soup tiles (32 px, enormous monster coverage). A **human picks the pack** (art direction is taste, and one coherent pack beats mixed sources); everything after the pick is agent work (W6). Gaps in a pack are filled by agent-authored SVG (W7) until real art replaces them.

## 2. Agentic workflows

These assume Claude Code sessions against this repo, and lean on two things the project already does well: goal-driven execution (CLAUDE.md — every task gets a machine-checkable success criterion) and structural-reference prompting (`tech_spec.md` §7 templates). The tooling sprints exist precisely to give these workflows their verification loops — **an agent workflow without a validator/preview/sim to check itself against is just faster guessing.**

### W1. Monster Smith (agent does the mechanics, human owns the numbers' intent)

Designer writes a brief — three lines is enough:

> *Concept: Giant Rat. SRD-based, CR 1/8, tier 1. Role: fast, fragile swarmer — spawns in packs of 4–6, low damage. Drops: rat pelt (new material, ~2 gp), no gold.*

Agent session then: creates the def from `goblin.js` as structural reference (SRD block + engine values) → adds the loot table + any new material item → runs `items.test.js` + the enemy validator → runs the balance sim vs. reference loadouts → returns a one-screen report (stat summary, TTK table, validator results) for the designer to approve or adjust. The designer iterates in *numbers and intent*, never in JS.

Prompt template:
> *"Create `shared/data/enemies/<id>.js` using `goblin.js` as the structural reference — keep both the SRD block and the Engine values section. Brief: [paste]. Add the loot table to `shared/data/loot/<tier>.js` and register both. Run `node shared/tests/items.test.js` and `node shared/tests/enemies.test.js` until green, then run the balance sim vs. a level-1 fighter (longsword+shield, chain mail) and a level-1 monk, and report TTK both directions. Do not place it on any floor — placement is a separate task."*

### W2. Floor Architect (agent as compiler, preview as the shared language)

Designer supplies a sketch — ASCII art, a bullet list ("central walled room, four doors; east arm escalating skeleton packs; locked stair south"), or a marked-up screenshot of the SVG of an existing floor. Agent: authors the floor via builders → boot-time validator passes → renders the SVG preview → **posts the preview back to the designer** → iterates on the picture until approved → only then runs the in-game smoke (spawn, walk each arm, F-interact each entity). The preview-render step is what makes this a conversation a non-programmer can steer.

### W3. Balance Auditor (agent-alone, recurring)

With the sim harness in place: an agent session (or CI job, or scheduled task) runs the full matrix — every class/level-1-loadout vs. every monster, plus representative pack sizes — and emits a difficulty report (markdown table, checked in or posted). Designers set explicit targets in a small data file (e.g. *"goblin: level-1 fighter TTK 2–4 attacks; player death probability vs. lone goblin < 2%"*), and the report flags out-of-band pairs. Tuning then becomes a goal-driven agent task: *"Bring giant_rat within its declared bands by adjusting only its def; re-run the sim to verify"* — a self-checking loop with no human babysitting.

### W4. Content wave with human gates (batch ideation)

For roster expansion: agent proposes N monster concepts as a table (name, CR, role, gimmick, which engine behaviors it needs) — human picks and annotates — agent implements the picks via W1, one session per monster (respecting "one module per agent session"). The valuable part is the *middle gate*: concepting is cheap for the agent and taste is cheap for the human; neither wastes the other's time. The "which engine behaviors it needs" column doubles as the demand signal for the AI-behavior backlog.

### W5. Designer onboarding brief (write once, in Sprint G)

When the first non-programmer designer joins: a short `docs/design/authoring-guide.md` — the W1/W2 brief formats, how to read the sim report and SVG preview, the vocabulary of available engine behaviors (and how to request new ones), and what agents will and won't decide for them (agents own mechanics and registration; humans own identity, role, and target bands). Written *at* Sprint G, not before, so it documents real tooling instead of intentions.

### W6. Asset Wrangler (agent does everything after the taste gate)

Human decision: which CC0 pack, and the mapping intent ("goblin → the small green one; skeleton → skeleton_humanoid_small"). Agent session then: downloads the pack and **captures the license file into the repo** (`client/public/assets/LICENSES.md` — provenance per source, even for CC0) → slices/renames spritesheet frames to registry ids (or generates a texture atlas + JSON via a script) → adds `spriteKey` to defs where the id-default doesn't match → wires the preload manifest → runs the asset-coverage validator → **boots the game and screenshots hub + dungeon** to verify sprites render, depth order holds (ground=2/elevated=4), and no missing-texture artifacts appear. The screenshot step is the non-negotiable one — asset bugs are visual, and an agent that can't see the result is guessing.

Prompt template:
> *"Integrate [pack] for tier-1 enemies + chest + stairs. Mapping: [paste]. Assets under `client/public/assets/sprites/`, license captured in `LICENSES.md`. Add preload + spriteKey wiring per the fallback-first pattern — placeholder circle must still render for any id without a texture. Run the coverage validator, then start the app and screenshot floor 1 to verify. Do not touch server files or floor data."*

### W7. SVG Sprite Smith (agent-generated interim art)

For gaps no pack covers (a bespoke monster from W4, item icons, UI elements): the agent authors SVG directly — Phaser loads it natively (`this.load.svg(key, url, { width, height })` rasterizes at load). SVG-as-code is versionable, diffable, and iterable by prompt ("make the pelt browner, add a notch"). Honest calibration: good for icons, items, and simple top-down entities; adequate-not-great for characters — treat it as scaffolding that keeps the coverage validator green until W6-grade art replaces it. External AI image generation is also viable behind the same human taste gate, but style coherence across mixed sources is hard; prefer one pack + SVG gap-fill for the testing era.

### W8. Visual verification loop (assist to every workflow above)

Once sprites exist, "boot and screenshot" becomes the standard closing step for *any* client-touching agent session (W2's floor review, W6, W7): run the app, join a dungeon, screenshot, compare against the previous state. Cheap insurance that placeholder-era habits (verifying by test suite alone) don't let visual regressions through.

### Anti-patterns to reject in these workflows

- Agent invents stats without an SRD citation or explicit designer numbers → require the brief or source in the prompt.
- Agent hardcodes behavior in `AISystem` for one monster ("if type === 'giant_rat'") → behaviors are data-declared from the palette (Sprint F); a new behavior kind is an *engine* sprint task, never a content-session side effect.
- Skipping the sim because "the numbers are from the SRD" → SRD balance assumes turn-based parties; the sim is the check that real-time adaptation didn't break it (the goblin's own `speed` is already hand-tuned down from SRD for feel).
- One session touching def + floor + engine behavior at once → violates one-module-per-session; split it.
- Assets landing without provenance → every art source, even CC0, gets an entry in `LICENSES.md` in the same commit; "found it on itch" is not a license.
- Sprite integration that removes the placeholder fallback → the fallback is what lets art land incrementally; deleting it turns every coverage gap into a crash.
- Mixing art sources without the human taste gate → one coherent pack + SVG gap-fill beats a patchwork of styles; agents don't get to decide art direction.

## 3. What this changes in the sprint plan

Engine/tooling prerequisites, mapped to [`roadmap-2026-07.md`](roadmap-2026-07.md):

| Capability | Sprint | Unblocks |
|---|---|---|
| Floor boot-time validator | C (already planned) | W2's error loop |
| Asset pipeline foundation: preload, `spriteKey` on defs/registry, fallback-first rendering, coverage validator, first CC0 pack integrated | V (new) | W6, W7; every playtest thereafter |
| Floor tile skin from existing rect data; `pixelArt` config | V (second half) | Tile-level visuals with no format migration |
| Floor builders + floor 4 | E (already planned) | W2 authoring |
| SVG floor preview script | E (ride-along, new) | W2's review loop |
| Enemy validator suite; per-def visual identity (`spriteKey` if V has landed, else `color`/`radius`) | F (new) | W1's error loop; readable floors |
| AI extraction to `shared/logic/ai.js` + tests; data-driven behavior palette (ranged attacker first — goblin's shortbow makes it the natural pilot) | F (new) | Monster *variety*; W4's behavior vocabulary |
| Balance sim harness + target-band file + report | G (new) | W1's numbers loop; W3 entirely |
| First content wave via W1/W2/W4 + authoring guide | G | Proves the pipeline end-to-end |

Sequencing note: Sprints V and E–G are independent of the auth sprint (D). Sprint V is client-only and touches none of the server surfaces C/D modify, so it can slot anywhere after A — recommended right after B so every hosted playtest benefits. If designer capacity shows up before public-URL plans do, run V/E–G ahead of D — the only hard rule is that D lands before the URL leaves the trusted-tester circle.
