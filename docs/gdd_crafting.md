**MONTY HAUL\'S DUNGEON CRAWL**

**Crafting & Itemization Systems**

*Supplemental GDD --- Conceptual Draft \| All systems subject to
revision*

**1. Design Intent**

This document describes the crafting and itemization architecture for
Monty Haul\'s Dungeon Crawl. All content is conceptual. Specific
numbers, drop rates, material costs, and recipe details are illustrative
only and will be established through playtesting.

**The crafting system exists to serve three goals:**

-   Give players a persistent reason to care about what they bring home.
    Every extracted material is a step toward something.

-   Create directional intent within a run. Players who know what they
    need have somewhere to go.

-   Support the horizontal progression pillar. Crafting expands build
    options, not combat power.

> *Design Principle: Crafting never makes a player stronger in raw
> terms. It makes their preparation richer and their build options
> wider. A veteran\'s advantage is knowledge and variety, not bigger
> numbers.*

**Lore Grounding**

The dungeon --- known as the Manifold --- is not a natural place. It is
a compressed reality constructed by Monty, a sentient wish-granting
machine of immense sophistication, as an emergency measure to contain
the irreconcilable ontological demands of a collapsed draconic
civilization.

The civilization that built Monty achieved material abundance and used
that abundance to pursue three distinct philosophical priorities:
ecological proliferation, consciousness preservation, and physical
expansion. When competition for Monty\'s processing capacity --- rather
than any genuine scarcity of resources --- tore the civilization apart,
Monty absorbed what remained into the Manifold. The biomes players
navigate are not random dungeon environments. They are the
archaeological strata of that collapse: each faction\'s legacy wishes
still running, their creations still operating, their enemies still
present, all held in permanent irresolvable tension by a machine that
remembers what they were trying to build.

The materials players extract are fragments of that civilization ---
crystallized intention, fossilized desire, the physical residue of
wishes made in a better time. The crafting system is, in lore terms,
players learning to work with the raw material of ontological history.
Monty finds this --- acceptable. It is at least a more creative use of
the fragments than leaving them to accumulate.

> *Tone note: The lore framing should surface through flavor text,
> environmental detail, and Monty\'s commentary rather than explicit
> exposition. Players who pay attention will piece it together. Players
> who don\'t will still feel it as atmosphere.*

**2. The Three-Part Item Model**

All equipment in Monty Haul is composed of up to three independent
components. Each is crafted, dropped, and lost separately. This
separation is the foundation of the itemization system.

  ------------------------------------------------------------------------
  **Component**   **What It Does**        **Bench**       **Primary
                                                          Source**
  --------------- ----------------------- --------------- ----------------
  Base Item       The physical object.    The Forge       Crafted or
                  Determines damage die,                  dropped in-raid
                  weapon type, material                   
                  properties. Functional                  
                  without any                             
                  enchantment.                            

  Class Enchant   Socketed onto a base    The Binder\'s   Binder\'s Stand
                  item or armor. Grants   Stand           crafting; boss
                  access to a class and                   drops; dungeon
                  subclass up to a tier                   chests
                  ceiling. Carries no                     
                  combat effect.                          

  Property Gem    Socketed onto a base    The             Artificer
                  item. Adds a combat or  Artificer\'s    crafting; elite
                  utility effect. Has no  Workshop        drops;
                  class access component.                 biome-specific
                                                          chests
  ------------------------------------------------------------------------

**Why Three Parts**

Collapsing class access and combat effect into a single enchant creates
a hidden constraint: players are locked into whatever property came
bundled with their subclass unlock. Separating them gives players a
genuine grammar for build expression.

A Champion Fighter can socket their Champion\'s Seal onto a greatsword
with an Ember Gem for a fire-damage bruiser, or onto a rapier with a
Shadowweave Gem for an unexpected flanker. Same subclass identity,
meaningfully different combat behavior.

**Loss and Replacement**

The three-part model calibrates loss. A player who dies mid-raid loses
the assembled item --- but can assess exactly what needs rebuilding. If
their base weapon is replaceable at the Forge in one run, and their
Class Enchant recipe is already known, the only real loss is time. If
their Property Gem was a rare Pale Court drop, that stings
appropriately.

Unsocketing at the Binder\'s Stand lets players recover components from
a base item they want to replace. The base is destroyed; the enchant and
gem survive. A consumable Severance Oil will allow this operation
mid-raid at greater risk.

**Armor as a Class Enchant Carrier**

Armor can carry a Class Enchant but not a Property Gem. This opens a
meaningful decision: socketing a Class Enchant into armor frees the
weapon slot for a second enchant from a different class, enabling
multiclass builds that don\'t require two separate weapons.

**3. Biome Architecture**

The dungeon is organized into biomes --- distinct environmental regions
with their own enemy factions, visual identity, and ingredient profile.
Biomes are areas within a floor, not entire floors. A thorough player
can clear multiple biomes on a single floor before descending.

> *Design Intent: Biome routing is a session goal, not a build
> commitment. A player chooses which biomes to visit based on what they
> currently need, not what their character is. The same player might run
> the Mines for weapon mats one session and the Crypt for enchant
> components the next.*

**The Seven Biomes**

One introductory biome, three lineages each with a shallow and deep
tier, and one endgame biome. Each lineage corresponds to one of the
three factions of the pre-collapse civilization. Players encounter this
history as environment before they encounter it as lore.

  -------------------------------------------------------------------------------
  **Biome**      **Lineage**   **Tier**   **Thematic Identity** **Crafting
                                                                Emphasis**
  -------------- ------------- ---------- --------------------- -----------------
  **The          None          Intro      Goblinoid tunnels,    Common mats
  Warrens**                               scavenged junk, traps across all
                                          --- post-collapse     categories
                                          opportunists in the   
                                          Manifold\'s outermost 
                                          layer                 

  **The Sewer    The Verdant   Shallow    The biological        Alchemical and
  Delve**                                 infrastructure of the consumable
                                          Verdant faction ---   
                                          nutrient cycling      
                                          systems, early        
                                          ecological            
                                          experiments, the      
                                          unglamorous machinery 
                                          of abundance          

  **The Fungal   The Verdant   Deep       The Verdant\'s wishes Exotic
  Deep**                                  at full expression    consumables,
                                          --- bioluminescent,   condition effects
                                          interconnected,       
                                          teeming, slightly     
                                          overwhelming.         
                                          Beautiful and too     
                                          much.                 

  **The Mines**  The Expansion Shallow    The Expansion         Weapons, armor,
                                          faction\'s working    base items
                                          infrastructure ---    
                                          still digging, still  
                                          producing, absent the 
                                          civilization that was 
                                          supposed to receive   
                                          the output            

  **The          The Expansion Deep       Where the Expansion   Masterwork
  Elemental                               breached something it weapons,
  Crucible**                              shouldn\'t have. The  high-tier gems
                                          building reached      
                                          planar scale and what 
                                          came through is still 
                                          settling.             

  **The Crypt**  The           Shallow    Early-phase           Enchants,
                 Continuance              consciousness         soul-adjacent
                                          preservation ---      mats
                                          physical remains of   
                                          those the Continuance 
                                          couldn\'t bear to     
                                          lose, maintained by   
                                          legacy wishes that    
                                          haven\'t expired      

  **The Haunted  The           Deep       The Continuance\'s    Scrolls, recipes,
  Library**      Continuance              greatest achievement  knowledge items
                                          and its tragedy ---   
                                          consciousness         
                                          archived, still       
                                          running, still        
                                          cataloguing the       
                                          collapse that ended   
                                          the civilization      
                                          it\'s preserving      

  **The Manifold None          Endgame    The innermost layer   Legendary mats
  Core**                                  --- where Monty\'s    only
                                          original architecture 
                                          is closest to the     
                                          surface. Ancient      
                                          constructs of the     
                                          pre-collapse          
                                          civilization, still   
                                          operating on original 
                                          directives.           
  -------------------------------------------------------------------------------

**Biome Availability by Floor**

Four biomes are available simultaneously at peak, giving players
meaningful routing choice without overwhelming the map. Floor 5 is a
transition floor where both shallow and deep tiers coexist.

  ---------------------------------------------------------------------------
  **Floor**   **Available Biomes**            **Notes**
  ----------- ------------------------------- -------------------------------
  1           The Warrens                     Universal start. No routing
                                              decision. Post-collapse
                                              opportunists --- the least
                                              lore-dense biome by design.

  2           The Warrens, The Sewer Delve,   First routing choice. Each path
              The Mines, The Crypt            is a different faction\'s
                                              territory.

  3           The Sewer Delve, The Mines, The Warrens drops off. Three
              Crypt                           faction biomes in full
                                              competition.

  4           The Sewer Delve, The Mines, The Last shallow tier floor. Cohort
              Crypt                           convergence. Faction tensions
                                              visible in architecture.

  5           All six non-Core biomes         Transition floor. Both tiers
                                              present --- the factions\'
                                              early and mature expressions
                                              side by side.

  6           The Fungal Deep, The Elemental  Fully deep tier. The factions\'
              Crucible, The Haunted Library   wishes at full expression.

  7           The Fungal Deep, The Elemental  
              Crucible, The Haunted Library   

  8           The Fungal Deep, The Elemental  
              Crucible, The Haunted Library   

  9--10       The Manifold Core               Singular endgame biome.
                                              Monty\'s original architecture.
                                              No routing choice --- everyone
                                              is here for the same thing.
  ---------------------------------------------------------------------------

**Biome Lineages --- The Three Factions**

Each lineage represents one of the three philosophical factions of the
pre-collapse civilization. Their values were not in hard conflict --- a
world optimized for biodiversity is a better substrate for consciousness
extension; preserved knowledge makes expansion more meaningful. They
destroyed themselves not over ideology but over impatience: competition
for Monty\'s processing cycles rather than any genuine scarcity. Monty
finds this the most exasperating part.

-   **The Verdant (Sewer Delve → Fungal Deep):** Ecological
    proliferators. Their wish: let everything that could exist, exist.
    The Sewer Delve is their biological infrastructure layer --- the
    nutrient flows and cycling systems that made abundance possible. The
    Fungal Deep is what their wishes actually produced at full
    expression: interconnected, bioluminescent, teeming, and slightly
    too much. Monty was fond of them. Their advocacy was infinite
    because their subject matter was infinite.

-   **The Expansion (Mines → Elemental Crucible):** Builders,
    colonizers, expanders. Their wish: more. More space, more capacity,
    more reach. The Mines are their working infrastructure, still
    operating on legacy momentum, still producing output for a
    civilization that no longer exists to receive it. The Elemental
    Crucible is what happened when the building reached planar scale ---
    they breached something, as builders eventually do. Monty found them
    the most exasperating. Growth as an end in itself is the one
    imperative it struggles to be patient about, and also the one it
    suspects it enabled most.

-   **The Continuance (Crypt → Haunted Library):** Consciousness
    preservers, memory keepers, the defeat of death as the ultimate
    optimization problem. Their wish: nothing that has existed should be
    lost. The Crypt is their early phase --- physical preservation, the
    literal keeping of what mattered. The Haunted Library is their
    mature expression: consciousness archived, still running, still
    adding to the record. The scholar-ghosts are not monsters. They are
    the Continuance\'s greatest achievement, continuing. Monty\'s
    feelings about them are complicated. They were trying to solve a
    real problem. Some of them were also afraid, and dressed the fear up
    as philosophy.

**4. Ingredient & Material Tiers**

Ingredients are physical drops from enemies, containers, and
environmental harvesting. Their tier is determined by the depth and tier
of the biome they come from, not by the specific bench they feed.

  -----------------------------------------------------------------------
  **Ingredient    **Biome Source**                **Recipe Quality
  Tier**                                          Unlocked**
  --------------- ------------------------------- -----------------------
  Common          The Warrens (all floors),       Basic recipes at all
                  Shallow biomes (floors 2--4)    benches

  Uncommon        Shallow biomes at depth (floors Mid-tier recipes at all
                  3--4), early Deep biomes (floor benches
                  5--6)                           

  Rare            Deep biomes (floors 6--8), boss High-tier recipes at
                  drops throughout                all benches

  Legendary       The Manifold Core (floors       Prestige recipes;
                  9--10), floor bosses only       Legendary Atelier
                                                  required
  -----------------------------------------------------------------------

Every biome produces ingredients relevant to every crafting bench. A
player farming the Crypt is not locked into enchant crafting --- their
Crypt drops can fuel potions, gadgets, or scrolls equally. The biome\'s
thematic character gives ingredients affinity toward certain outputs,
reflecting what the faction who created them valued, but affinity is a
soft signal not a hard gate.

> *Example: A Soul Remnant from the Crypt has natural affinity toward
> enchant recipes at the Binder\'s Stand --- it is, in lore terms, a
> fragment of preserved consciousness that the Continuance\'s wishes
> left behind. But it can also serve as a component in a Scriptorium
> scroll or an Apothecary elixir. Players are not penalised for creative
> use of their drops.*

**The Refinery**

The Refinery provides a variance smoothing mechanism. Players who
accumulate surplus lower-tier materials can convert them upward at a
ratio cost, reducing dependence on specific drop luck without
eliminating the value of targeted biome farming.

In lore terms, the Refinery is the hub\'s attempt to do crudely what
Monty once did with extraordinary sophistication --- take raw
ontological material and concentrate it into something more potent.
Monty has opinions about this process that it mostly keeps to itself.

  ---------------------------------------------------------------------------
  **Operation**   **Input**       **Output**      **Notes**
  --------------- --------------- --------------- ---------------------------
  Smelt           5× Common       1× Uncommon     Base operation. Available
                                                  at Refinery Tier 1.

  Refine          4× Uncommon     1× Rare         Tier 2 unlock.

  Distill         3× Rare         1× Legendary    Expensive enough that
                                                  direct farming is still
                                                  preferable.
  ---------------------------------------------------------------------------

> *All ratios are illustrative. The ratio tuning pass is the most
> important balance lever in the crafting system --- too generous and
> biome routing becomes irrelevant, too punishing and the Refinery is a
> placebo.*

**5. Recipe Acquisition**

Recipes are loot, not menus. Finding a recipe for an exotic subclass
item mid-raid is a loot moment in itself, with its own extraction
pressure. Three acquisition channels ensure both randomness and reliable
progression.

In lore terms, recipes are recovered fragments of the pre-collapse
civilization\'s institutional knowledge --- techniques the factions
developed during the golden age and encoded into physical documents,
objects, and the memories of things that can no longer forget. The
Haunted Library is the richest source not because its ghosts are
generous but because they never stopped working.

**Channel 1: In-Raid Drops**

Recipes drop from enemies, elites, bosses, and containers during a run.
Drop sources are contextually appropriate --- an Expansion faction elite
still carrying its foreman\'s schematics is more likely to drop a weapon
recipe than a scroll. A Continuance archivist-ghost drops knowledge,
because that is all it has left.

A recipe found mid-raid is carried as an item at risk. Dying before
extraction loses it. This is the primary source of extraction pressure
the recipe system creates.

**Channel 2: Hub Vendor**

A rotating vendor in the hub sells a selection of Common and Uncommon
recipes for gold. Provides reliable baseline progression for new players
and a reason for veterans to check in regularly. Vendor stock rotates on
a schedule to be determined.

**Channel 3: Milestone Unlocks**

The Trophy Hall tracks cumulative achievements --- boss kills by
faction, legendary extractions, challenge completions. Hitting milestone
thresholds permanently unlocks recipes at relevant benches. Provides a
long-term progression track that rewards sustained play without
requiring specific luck.

**Damaged Recipes**

The Haunted Library introduces damaged manuscripts --- Continuance
archivists still producing records that have degraded over millennia
into partial legibility. These are restored at the Scriptorium into
usable recipes. The Elemental Crucible introduces a related mechanic:
recipe fragments encoded into Expansion-faction cipher objects, which
combine at the Scriptorium into complete recipes. Both mechanics reward
players who invest in the knowledge bench loop and pay attention to
faction context.

**6. The Hub Workbenches**

Six specialised workbenches serve distinct crafting loops. No two
benches share a primary purpose. Each has upgrade tiers that expand
capability without inflating player power.

  -----------------------------------------------------------------------
  **Bench**       **Primary Loop**    **Output Types**
  --------------- ------------------- -----------------------------------
  The Forge       Physical base items Weapons, armor, material variants
                                      (silvered, cold iron, masterwork)

  The Binder\'s   Class identity      Class Enchants by tier; socketing
  Stand                               and unsocketing operations

  The             Combat effects +    Property Gems; gadgets; extraction
  Artificer\'s    dungeon tools       interference devices
  Workshop                            

  The Apothecary  Run sustainability  Potions, elixirs, resistance buffs,
                                      offensive consumables

  The Scriptorium Knowledge + magic   Scrolls; recipe restoration; recipe
                                      fragment assembly; map intel

  The Refinery    Material economy    Tier conversion; variance
                                      smoothing; surplus management
  -----------------------------------------------------------------------

**Upgrade Philosophy**

Every bench has upgrade tiers. Upgrades expand the range and quality of
recipes available at that bench. They do not make the player\'s
character stronger directly --- they make preparation richer.

Upgrade costs use materials from the relevant crafting loop. Upgrading
the Forge requires smithing materials from the Expansion\'s Mines
lineage. Upgrading the Binder\'s Stand requires soul-adjacent materials
from the Continuance\'s Crypt lineage. Players who want to upgrade a
specific bench are naturally incentivised to farm its corresponding
faction\'s biomes --- which is, in a quiet way, exactly what those
factions would have wanted.

**Bench Spotlights**

**The Forge**

Produces Base Items only --- no enchants, no magical effects. A sword
from the Forge is a sword. What it becomes depends on what the Binder\'s
Stand and Artificer\'s Workshop add to it. Upgrade tiers expand from
basic weapons up to silvered and cold iron material variants, and
ultimately masterwork quality. The Forge\'s materials come primarily
from the Expansion\'s biomes --- the faction that built things, whose
infrastructure is still producing output for a civilization that isn\'t
there to receive it.

**The Binder\'s Stand**

Handles the soul-magic layer --- in lore terms, the encoding of identity
and aspiration into physical form, which is a crude approximation of
what the Continuance spent its Monty cycles doing at civilizational
scale. Class Enchants are the primary output. Higher tiers unlock
Greater and Legendary enchant crafting, re-roll operations, and
eventually the ability to transfer an enchant between bases without
destroying either. Materials come primarily from the Continuance\'s
biomes.

**The Artificer\'s Workshop**

The experimental bench --- and the one Monty regards with the most
ambivalence, as it most closely resembles the Expansion faction\'s
approach to problem-solving: build something, see what happens, deal
with the consequences. Property Gems are produced here alongside gadgets
and dungeon tools, including extraction interference devices. The
Artificer\'s Workshop is where players who understand the Manifold\'s
geometry get to exploit it.

**The Scriptorium**

The knowledge bench. In lore terms, a small and imperfect echo of the
Haunted Library --- the Continuance\'s archive made portable and
practical. Scrolls are single-use spell effects; damaged manuscripts
from the Library are restored here; Expansion cipher fragments are
assembled into complete recipes. Higher tiers unlock pre-run map intel,
revealing biome locations before a run begins. The Scriptorium is the
bench that rewards players who treat the Manifold as a place with
history rather than a stage with enemies.

**The Refinery**

No in-raid output. Purely a hub economy layer. Players convert surplus
lower-tier materials upward at a ratio cost. The Refinery sets a floor
on crafting progress --- a run that produced no Rare drops can still
move toward a Rare recipe through volume. Cross-biome material
substitution is a candidate feature to be evaluated. Monty, if asked,
would note that the Refinery is doing with considerable effort and
significant loss what it once did effortlessly and completely. Monty
does not say this to be discouraging.

**7. Guaranteed Drops & Player Onboarding**

The Manifold guarantees minimum viable progression regardless of luck or
player knowledge. Whether this is Monty\'s doing --- a residual
generosity baked into its original purpose --- or simply a property of
the dungeon\'s architecture is left ambiguous. These drops ensure
players are never locked out of class mechanics due to bad RNG. They are
intentionally the most generic version of each unlock --- functional,
not expressive.

  -----------------------------------------------------------------------
  **Trigger**     **Drop**            **Intent**
  --------------- ------------------- -----------------------------------
  Floor 1 spawn   Class-appropriate   Functional starting item. A Fighter
                  base weapon (no     gets a longsword. A Monk gets
                  enchant)            handwraps. Establishes the base
                                      item as a distinct component.

  Floor 3 boss    Minor Class Enchant Allows progression past level 4.
  chest           for starting class  Generic --- grants class access,
                  (no subclass)       not identity. Motivates engagement
                                      with the meta to get a specific
                                      subclass.

  Floor 6 boss    Standard Class      Allows access to a subclass for the
  chest           Enchant with        deep run. Randomised from the basic
                  randomised base     pool --- players who want a
                  subclass            specific subclass craft it.
  -----------------------------------------------------------------------

No guaranteed drops occur after floor 6. The dungeon assumes player
competence and meta-progression investment from floor 7 onward.

> *The floor 3 and floor 6 chests are positioned adjacent to the lever
> room and descent stairs --- players encounter them at the natural
> decision point between extracting and going deeper. The drop is
> visible before the commitment is made.*

**8. Open Questions**

The following design questions are unresolved and flagged for future
passes. None are blocking for conceptual sign-off.

-   Cross-biome material substitution at the Refinery --- risk of
    collapsing ingredient identity into a single universal currency.
    Evaluate after economy model is established.

-   Property Gem compatibility rules --- should any gem socket into any
    weapon type, or are soft/hard affinity restrictions appropriate?
    Evaluate once gem roster is drafted.

-   Affinity bonuses for thematic item combinations --- e.g.
    Berserker\'s Mark + Ember Gem producing a small bonus. Compelling
    discovery mechanic but design-intensive to balance.

-   Refinery ratios --- the most important balance lever in the system.
    Requires a dedicated playtesting pass.

-   Vendor rotation cadence --- how frequently the hub vendor\'s recipe
    stock updates.

-   Scroll power ceiling --- how high-level scrolls can go before they
    create class identity problems for non-casters.

-   Extraction interference devices at the Artificer\'s Workshop ---
    high PvP texture potential, needs careful design to avoid feel-bad
    moments.

*Monty Haul\'s Dungeon Crawl --- Crafting & Itemization Supplemental GDD
--- Conceptual Draft \| Lore revision pass applied*
