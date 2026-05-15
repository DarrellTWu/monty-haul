---
status: design-only
updated: 2026-03
purpose: Game design document. Describes intended scope larger than what is built. Use as design context, not binding spec — current implementation in docs/PROJECT_STRUCTURE.md.
---
## MONTY HAUL'S DUNGEON CRAWL
*Game Design Document | Internal Reference*

v0.2 — Post-Playtest Update

## A 2D PvPvE Dungeon-Crawl Extraction Roguelike
*Built on the D&D 5e SRD ruleset, tuned for competitive play*

# 1. Concept Overview
Monty Haul's Dungeon Crawl is a 2D top-down PvPvE roguelike extraction game fused with faithful D&D 5e SRD mechanics. Players drop into a procedurally generated dungeon, fight monsters, loot treasure, and attempt to extract — all while contending with other players doing exactly the same thing. The tone is balanced: the dungeon is absurd and loot-generous by design, but the threat of another player around the corner keeps stakes real.

The working title is a deliberate wink at tabletop culture. "Monty Haul" describes a dungeon master who gives out too much loot — breaking the game's economy. Here, that's the premise. The dungeon is overflowing with treasure. The danger isn't scarcity. The danger is getting out alive.

## High Concept
> **Elevator Pitch**
> *Dark and Darker meets Hades, played with your D&D rulebook open. Every run is a fresh level-1 character dropped into a dungeon that wants to kill you — and so do the other players. Loot hard, level up floor by floor, and extract before someone takes your gold.*
## Core Pillars
-   Risk Calibration — Every decision is a risk/reward calculation: go deeper for better loot, but extraction gets harder.

-   Mechanical Depth — SRD stats, saving throws, conditions, and class features create readable, skill-expressive combat translated into real-time play.

-   Horizontal Progression — Gear unlocks build options, not just bigger numbers. Veterans have more choices, not guaranteed wins.

-   Meaningful Loss — Death hurts. Your run's loot is gone. That's what makes extraction matter.

-   Emergent Tension — Every other player is simultaneously a threat and an opportunity. PvP is never forced, always looming.

# 2. Core Game Loop
## The Run Structure
Each run begins with a fresh level 1 character. Players select from available classes, equip gear from their persistent stash, and enter a dungeon instance. The dungeon has 10 floors. Completing (or simply reaching) each floor grants one character level and triggers a long rest — fully restoring hit points and class resources. A full run represents a level 1--10 character arc compressed into a single session.

  ------------ ----------------- ----------------- -------------------- ----------------------------------------
  **Floors**   **Char. Level**   **Max Players**   **Extract Option**   **Tone**

  1 -- 3       1 -- 3            4                 Floor 3 portal       Scrappy, intimate, scouting each other

  4 -- 6       4 -- 6            12                Floor 6 portal       Builds online, PvP getting real

  7 -- 9       7 -- 9            24                Floor 9 portal       High stakes, alliances forming

  10           10                48                Floor 10 portal      Full chaos, everyone's loaded
  ------------ ----------------- ----------------- -------------------- ----------------------------------------

*Player counts shown are theoretical maximums assuming zero attrition. Real sessions will be significantly smaller due to deaths and extractions — which is by design. The maximum creates a dramatic ceiling; the actual population at floor 10 will feel earned and appropriately chaotic.*

## Instance Architecture & Cohort Model
Each run is a single server instance containing all players for that run. Players are organized into cohorts of 4 from the start. On floors 1-3, each cohort runs through its own physically distinct branch of the dungeon — walled off from the other branches, with no connecting passage and no way to reach another cohort's space. The branches are separate areas of the same map, not the same space with a visibility filter. At floor 4, all three branches converge into a single continuous dungeon level for the first time. Players are now in the same physical space and can encounter each other freely.

  ----------------- -------------------- ------------------------- ------------------------------------------------------------------------------------------------------------------------------
  **Floor range**   **Cohorts active**   **Players interacting**   **Map structure**

  Floors 1--3       3 cohorts of 4       4 (own cohort only)       Three physically separate dungeon branches. Solid walls between them — no passage, no visibility, no interaction possible.

  Floors 4--6       3 cohorts merged     Up to 12                  Single continuous dungeon level. All three branches converge here. First possible cross-cohort contact.

  Floors 7--9       2 runs merged        Up to 24                  Two 12-player runs enter a shared continuous level. Post-beta scope.

  Floor 10          2 runs merged        Up to 48                  Two 24-player runs share the final floor. Post-beta scope.
  ----------------- -------------------- ------------------------- ------------------------------------------------------------------------------------------------------------------------------


> **Beta Scoping: Start at 12 players (floors 1-6)**
> *The beta builds with 12 players per run (3 cohorts of 4) and floors 1-6 only. The floor 7+ merges — requiring coordination between separate run instances — are post-beta scope. Floor 1-6 is a complete gameplay loop: three parallel branches, the first convergence at floor 4, extraction tension, and the lever mechanic. All systems are built with the full hierarchy in mind.*
## Extraction Portal Mechanic
Extraction portals appear on floors 3, 6, 9, and 10 — always at the end of a tier, never mid-tier. Going deeper (taking the stairs down) is instant and private: walk in, you're gone, no broadcast. Extraction is the opposite: public, announced, and slow.

When a player activates an extraction portal, a broadcast fires to all players currently on that floor. The activating player must remain within a ritual radius of the portal for approximately 60 seconds to complete the extraction. They are not frozen — they can move freely, fight, use abilities, and consume items within the radius. Leaving the radius pauses the timer; re-entering resumes it.

-   Broadcast on activation — everyone on the floor knows where you are and what you're doing

-   Free movement within ritual radius — cornered animal, not sitting duck

-   Timer pauses on radius exit — enemies and hunters can stall by pushing you out

-   Stairs down are physically separate from the portal — reaching extraction requires committing to cross the floor

-   Dead players drop all carried loot, including gear brought in from stash

-   Successful extraction banks all carried loot into the persistent meta economy


> **The Social Moment**
> *The 60-second ritual window is the game's primary social space. Other players converging on the portal must decide: contest it, ignore it, or negotiate. A player mid-ritual can offer a deal — "cover me and I'll take you into the next tier" — while an incoming player has genuine leverage to demand terms. The broadcast makes this moment legible to everyone on the floor. It is simultaneously the most vulnerable and most social moment in a run.*
## Cohort Convergence at Floor 4
Players know who is in their run from the start — the full roster of 12 is visible in the pre-run lobby. On floors 1-3 they run entirely separate branches of the dungeon: different rooms, different enemies, different loot, physically walled off. The only thing shared is the server instance and the knowledge that two other cohorts are out there somewhere, running in parallel.

Floor 4 is the first continuous level — a single dungeon space with three entrances, one for each converging branch. There is no gate and no coordination required. The first player from any cohort to push through their branch's exit onto floor 4 arrives into open space. The other two entrances are visible across the floor. Eventually, players emerge from them.

Faster cohorts — those who cleared their branch quickly or took fewer risks — arrive on floor 4 first and have time to orient, explore, and potentially establish advantageous positions before slower cohorts arrive. This head-start is intentional. Floor 4's design absorbs the asymmetry: a large initial space with enemies not spawned near the three entrances gives arriving players a moment to get their bearings before cross-cohort contact becomes likely.


> **Design Note: Known Strangers**
> *The cohort model trades the original 'mystery merge' (strangers from completely separate runs) for a 'known strangers' dynamic: players have seen each other's names and class selections since the lobby, and have been racing parallel branches of the same dungeon. The tension is different but equally valid — 'I saw your class was Rogue, and now you're walking out of that corridor' is its own kind of pre-history. The lever mechanic on floor 3 still creates the cooperation handshake within a cohort; floor 4 is where that established trust — or the absence of it — meets the other eight.*
## The Descent Levers
The stairs down on floors 3, 6, and 9 are locked behind a two-lever mechanism. Two levers are positioned on opposite sides of the lever room — spaced far enough apart that a single player cannot physically cover the distance between them before the first lever resets. Both levers must be held in the pulled position simultaneously for the stairs to unlock. The constraint is geometric, not systemic: the room layout enforces the two-player requirement without any explicit rule or UI timer.

This is a deliberate cooperation nudge, not a hard gate. A solo player who cannot find a willing second can always portal out instead. The mechanic rewards players who have built even minimal trust with a fellow runner — and creates a moment of mutual vulnerability, since pulling a lever means briefly exposing your back to someone you may not fully trust.

-   Lever spacing calibrated to standard movement speed — a single player cannot reach both before the first resets

-   First lever resets automatically once the crossing window elapses, preventing indefinite camping of one lever

-   Portal out always available as the alternative for solo players or players who can't find a partner

-   Lever room layout should include cover — waiting at a lever should not be an instant death sentence

-   Edge case: sufficiently fast builds (Dash, Cunning Action, high movement speed gear) may be able to solo the mechanism — treat as an intentional advanced trick, not a bug to patch


> **Design Note: The Lever as Social Contract**
> *Pulling a lever is a small act of trust — you're committing to a fixed position and briefly turning your back. The player who pulls the other lever has made the same choice. That shared vulnerability is the handshake. It doesn't guarantee alliance in the next tier, but it creates the memory of one.*
## Mid-Run Banking (Casual Safety Valve)
Fixed courier NPCs or magical lockboxes appear on select floors. Players may bank a limited number of items (2 total per run) before extraction. Only consumables and raw gold may be banked — no equipment. This gives newer players a small safety net without invalidating the risk economy for experienced players.

## Survival Mechanics
Three interlocking systems manage character health and resource attrition across a run. These were tuned during vertical slice playtesting to reduce death-by-variance and make skill expression more meaningful than luck.


> **Long Rest on Level-Up**
> *Each time a character gains a level — once per floor — they receive a full long rest. All hit points are restored to maximum. All class resources (spell slots, Second Wind, Channel Divinity, etc.) are fully recovered. This resets the attrition clock each floor, making each floor a self-contained challenge rather than a cumulative death spiral. Resource management decisions are meaningful within a floor, not across the entire run.*
> **Out-of-Combat Health Regeneration**
> *Characters regenerate hit points slowly while not in combat. The regen rate is modest — enough to recover chip damage between encounters, not enough to trivialize the cost of a difficult fight. Regen halts the moment an enemy becomes aggressive. This rewards clearing rooms thoroughly and punishes rushing: a player who eliminates all threats earns the recovery window. A player who runs past enemies does not.*
> **Starting HP: Double Base Value**
> *All characters begin a run with double the standard SRD hit point maximum (e.g., a Fighter with CON 14 starts at 24 HP rather than 12). This directly reduces death-by-variance on floor 1, where a cold dice streak on the enemy side can end a run before the player has made a single meaningful decision. The increased HP pool smooths the early game without inflating mid-to-late floor survivability, since long rests restore to the full doubled maximum each floor.*
# 3. Character System
## Base Character Rules
All characters begin each run at level 1. Without gear, characters may freely multiclass but are hard-capped at level 3 in any single class. This creates a deliberately scrappy baseline — enough to have core class features, not enough to unlock subclass specialization. Experienced gearless players will identify strong multiclass combinations as a form of meaningful skill expression. Naked level-10 runs represent mastery.


> **Design Note: Gearless Balance**
> *The level-3 cap means gearless veterans will find optimal multiclass floors (e.g. Fighter 3 / Rogue 3 / Ranger 3 / Warlock 1). This is intentional — the game does not require gear, it rewards it with expanded build identity. Known broken baseline combinations should be monitored and tuned, not eliminated.*
## Real-Time Combat System
The SRD ruleset is translated into real-time play. Movement is free and continuous — players move with WASD at their character's speed, uninterrupted. The D&D action economy is replaced by a single Attack Timer: a tunable cooldown (currently set to a few seconds) that refreshes automatically. When the timer is ready and the player presses Space, an attack resolves using full SRD dice mechanics — d20 roll vs. target AC, damage dice, crit on natural 20.

This translation preserves what makes D&D combat feel meaningful — the swing of the d20, the crit explosion, damage type interactions, conditional bonuses — while making it playable in real-time without turn management overhead. A player still has to think about positioning, timing, and resource use. They just do it while moving.


> **The Attack Timer in Practice**
> *The timer is visualised as a cooldown arc around the player character. When it fills, the attack is ready. Pressing Space fires the attack immediately — no windup animation that can be cancelled, no input buffering. The timer then resets. This is the game's heartbeat. All class features that grant additional attacks, bonus damage, or modified rolls key off this same event.*
## Action Economy Translation
D&D's action/bonus action/reaction structure is translated per-action type. The translation is designed to preserve the strategic intent of each category without requiring turn management:

  ------------------ -------------------------------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **D&D Category**   **Real-Time Translation**                    **Notes**

  Action (Attack)    Space bar — Attack Timer                   Single attack on cooldown. Extra Attack (Fighter 5, etc.) fires all rolls simultaneously on the same keypress. The timer cooldown is the same regardless of how many dice roll.

  Action (Other)     Dedicated keybind, freely available          Class actions that aren't attacks (Dash, Disengage, Hide, Help) are on separate keybinds with no shared cooldown. Using one does not block the Attack Timer.

  Bonus Action       Freely available, instant                    Bonus action abilities (Second Wind, Cunning Action, Reckless Attack toggle, etc.) activate instantly on their keybind. No shared cooldown with Attack Timer. Current design: freely used, not rate-limited.

  Reaction           Auto-resolved by server, or keybind prompt   Passive reactions (Uncanny Dodge, Parry) trigger automatically when conditions are met. Active reactions that require a decision (Riposte, opportunity attacks) may prompt the player. Design TBD — see backlog.

  Movement           Free and continuous (WASD)                   Speed stat sets pixels-per-second. Dash doubles speed. Difficult terrain halves speed. No action cost for movement.

  Consumables        Freely activated, no cooldown (current)      Potions and items activate instantly on keybind. No current rate-limiting. This is flagged for review — free potion use may be too strong in PvP.
  ------------------ -------------------------------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## Extra Attack: How Multi-Attack Works in Real-Time
When a character gains Extra Attack (Fighter level 5, Barbarian level 5, Monk level 5, Ranger level 5), pressing Space fires all attacks simultaneously in a single event. Two dice resolve at once. At higher levels or with specific class features, more dice resolve. The cooldown timer resets after all rolls, not between them. The attack animation plays once; the damage numbers stack.

This is a deliberate design choice. It preserves the feel of Extra Attack as a significant power spike — the moment you go from one roll to two — without requiring the player to press Space twice per cycle or introducing a sub-timer for the second attack. The cooldown timer becomes slightly longer to compensate for the doubled damage output, keeping DPS scaling intentional and tunable via a single constant.


> **Implications for class feel**
> *Fighter with Extra Attack: two d20s light up at once, potentially two crits. Barbarian Reckless Attack: both attacks roll with advantage — four d20s on screen simultaneously. Monk Flurry of Blows: two bonus action unarmed strikes fire on their own separate keybind, independent of the Attack Timer. Each class's multi-attack expression looks and feels distinct even though they share the same underlying system.*
## SRD Faithfulness & Balance Tuning
The game is SRD-faithful in feel, tuned for PvPvE real-time balance. Players should feel like they're playing recognizable D&D characters. The specific numbers and edge-case interactions are fair game for adjustment. Known problem areas flagged for the design backlog:

-   Concentration — requires reimagining for real-time 2D context; holding concentration while moving and fighting simultaneously may be untunable without mechanical support

-   Counterspell — needs cooldown or resource cost to prevent PvP dominance in Wave 2+

-   Healing Word bonus action spam — freely available bonus actions make this very strong; needs tuning before Wave 2 casters

-   Sharpshooter — real-time adaptation of the +10/-5 feat math needs custom design (see Skirmisher/Sharpshooter subclass notes)

-   Stealth/Invisibility — Rogue PvP interactions need careful, deliberate design

-   Consumable rate-limiting — current free activation may be too strong in PvP; review flagged for after first playtesting wave

-   Reaction prompting — active reactions that require player decisions need a UX design pass; automatic resolution may be simpler for beta

# 4. Character Roster
The game launches with a Wave 1 martial roster. Wave 2 introduces the two half-caster classes and the full prestige class system. Full casters are out of scope until the magic system is ready for a dedicated design pass.


> **Staging Overview**
> *Wave 1: Fighter, Barbarian, Rogue, Monk — pure martials, no spell system required. Wave 2: Ranger, Paladin — half-casters, introduces spell slots and a curated spell list. Wave 3+: Full casters (Wizard, Cleric, etc.) — requires full magic system, concentration reimagining, AOE targeting.*
## Wave 1 — Pure Martials
Eight subclasses across four classes. Each class has one melee-focused and one ranged/mobile subclass. No spell system required for any of these. Prestige classes are deferred to Wave 2+.

## Fighter
The anchor class and tutorial vehicle. Weapon-agnostic — both subclasses work with any weapon type, making Fighter gear the most broadly applicable in the roster.

  ---------------- ----------- ---------------------------------------------------------------------------------------------------------------------------------------- -------------
  **Subclass**     **Focus**   **Core Hook**                                                                                                                            **Lift**

  Champion         Melee       Expanded crit range — crit fishing build identity, clean passive                                                                       Low

  Sharpshooter     Ranged      Ranged damage specialist. Real-time adaptation of feat math needed — custom tuning pass required. Positioning/accuracy tradeoff TBD.   Medium
  ---------------- ----------- ---------------------------------------------------------------------------------------------------------------------------------------- -------------

## Barbarian
Rage is the core mechanic — a persistent state with visual and mechanical clarity. Both subclasses modify what rage does, which is a clean additive implementation pattern. High HP and damage resistance make Barbarians natural loot carriers — hard to stop on the extraction run.

  ---------------- ----------- ------------------------------------------------------------------------------------------------- -------------
  **Subclass**     **Focus**   **Core Hook**                                                                                     **Lift**

  Berserker        Melee       Frenzy adds bonus attack while raging — straightforward, highest damage ceiling in the roster   Low

  Zealot           Melee       Rage keeps you fighting past 0 HP — perfect extraction fantasy, hard to kill archetype          Low
  ---------------- ----------- ------------------------------------------------------------------------------------------------- -------------

## Rogue
Sneak Attack positioning dependency is the defining mechanical challenge. Both subclasses address this differently — Swashbuckler removes the ally requirement entirely, Skirmisher rewards constant movement. Rogues are the most skill-expressive class in the PvP context.

  ---------------- ----------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ -------------
  **Subclass**     **Focus**   **Core Hook**                                                                                                                                                                              **Lift**

  Swashbuckler     Melee       Sneak Attack without ally adjacent; Fancy Footwork prevents opportunity attacks — solo duelist fantasy                                                                                   Low

  Skirmisher       Ranged      Original subclass. Grants ranged combat bonuses while moving — rewards constant repositioning over standing and shooting. Exact 'moving' window TBD, requires dedicated design spec.   Medium
  ---------------- ----------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ -------------

## Monk
Ki points are a per-rest resource that fits the floor long-rest model cleanly. Each subclass gives Ki new uses — an additive implementation pattern. Monks interact unusually with gear (less reliant on weapons and armor than other martials), creating distinct itemization design space.

  ---------------- ---------------- ---------------------------------------------------------------------------------------- -------------
  **Subclass**     **Focus**        **Core Hook**                                                                            **Lift**

  Drunken Master   Melee / Mobile   Disengage as bonus action on hit — extremely mobile, hardest Monk to pin down in PvP   Low

  Open Hand        Melee            Trip/push/stun on Flurry of Blows — best PvP disruption in the Wave 1 roster           Low
  ---------------- ---------------- ---------------------------------------------------------------------------------------- -------------

## Wave 2 — Half-Casters (Next Step)
Ranger and Paladin are designated Wave 2. Both are half-casters with narrow, thematic spell lists that ease into the magic system without requiring full AOE targeting or concentration reimagining. Subclasses and prestige classes for these will be designed in the Wave 2 pass.

  ---------------- -------------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------
  **Class**        **Magic System Need**                                                                        **Key Fantasy**

  Ranger           Spell slots + narrow utility/buff list (Hunter's Mark, Ensnaring Strike, Conjure Barrage)   Ranged skirmisher with magical flavor; bow itemization already designed

  Paladin          Spell slots + smite economy (Divine Smite, Bless, Wrathful Smite)                            Armored holy warrior — hits hard, very hard to kill, iconic extraction archetype
  ---------------- -------------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------


> **Prestige Classes — Wave 2+**
> *Prestige classes are deferred entirely until Wave 2. The base loop and itemization must be validated first. Candidates identified during design: Arcane Archer (Fighter), Rune Knight (Fighter), Storm Herald (Barbarian), Ancestral Guardian (Barbarian), Sun Soul (Monk), Kensei (Monk), Scout (Rogue), Phantom (Rogue), and half-caster prestige options TBD in Wave 2.*
# 5. Loot & Itemization
## Design Philosophy
Itemization is built around significant and satisfying horizontal progression with modest vertical progression. Gear expands what builds are possible rather than simply amplifying numbers. The most important function of gear is unlocking class levels beyond the base cap of 3 and granting access to subclass specializations. A veteran player's advantage is build diversity and knowledge, not raw power.

## How Gear Works: Class Unlock Items
Each piece of equipment that grants class access follows a consistent pattern: it names the class and subclass it unlocks, specifies the level ceiling it enables, and gains enhancement bonuses tied to dungeon floor depth. The gear levels with the player, preventing early-floor stomps by high-gear veterans.


> **Hunter's Masterwork Bow \[Rare\]**
> *A finely crafted longbow that seems to guide its wielder toward prey.*
> -   While in your inventory: grants the Hunter Ranger subclass and the ability to progress Ranger levels up to 10
> -   Gains +1 enhancement bonus at dungeon floor 3
> -   Gains +2 enhancement bonus at dungeon floor 6
> -   Gains +3 enhancement bonus at dungeon floor 9
> **Hunter's Serviceable Bow \[Uncommon\]**
> *A sturdy bow — not masterwork, but it gets the job done.*
> -   While in your inventory: grants the Hunter Ranger subclass and the ability to progress Ranger levels up to 6
> -   Gains +1 enhancement bonus at dungeon floor 3
> -   Gains +2 enhancement bonus at dungeon floor 6
## Onboarding Item: The First Chest
The very first chest a new player opens is guaranteed to contain a class-appropriate Uncommon weapon for their selected class. This item unlocks character level 4 in their class and provides a +1 enhancement bonus from the start. This serves as the game's mechanical tutorial moment — the player immediately experiences what gear does, gets a meaningful power boost, and understands the unlock system without reading a manual.


> **Example — New Fighter opens Floor 1 first chest:**
> *Drops: Soldier's Reliable Longsword \[Uncommon\] — Unlocks Fighter levels up to 4. +1 enhancement bonus. While equipped, you may take the Fighter subclass at level 3.*
## Consumables
Consumables make up a significant portion of dungeon loot and are sourced primarily from the SRD loot tables as a starting point. Every consumable carried is a decision: use it now for tactical advantage or extract it for the hub economy. Consumables are the only item type eligible for mid-run banking.

-   Potions (Healing, various resistances, ability score buffs)

-   Single-use wands (spell effects without building the full magic system)

-   Oils and alchemical items (weapon/armor enhancements, SRD adventuring gear)

-   Spell scrolls (one-use casting — Wave 2+, after spell system is established)

-   Ammunition (magical arrows, bolts — Wave 2, after Ranger is implemented)

## Floor 1--3 Consumable Drop Table (Draft)
> **Status: Draft — Not Locked**
> *The following table is a first-pass proposal for playtesting and discussion. Items, effects, rarity distribution, and floor availability are all subject to revision. Several items carry open design questions noted inline. Potion of Speed and Potion of Mind Reading are flagged for deliberate design decisions before implementation.*
## Healing
  --------------------------- ------------ ------------------------------------- -------------------------------------------
  **Item**                    **Floors**   **Effect**                            **Notes**

  Potion of Healing           1--3         Restores 2d4+2 HP                     SRD standard. Core drop, high frequency.

  Potion of Greater Healing   2--3         Restores 4d4+4 HP                     Rarer. Meaningful extraction value.

  Potion of Vitality          3            Removes exhaustion, restores 3d6 HP   Exhaustion system TBD — plant the seed.
  --------------------------- ------------ ------------------------------------- -------------------------------------------

## Defensive Buffs
  ---------------------- ------------ --------------------------------------------------------------------------------- ------------------------------------------------------------------
  **Item**               **Floors**   **Effect**                                                                        **Notes**

  Potion of Resistance   1--3         Resistance to one random damage type (fire, cold, lightning, poison) for 1 hour   Randomized on drop — interesting 'keep or use now' decision.

  Potion of Protection   1--3         +2 AC for 10 minutes                                                              Simple, legible, universally useful.

  Elixir of Fortitude    2--3         Advantage on CON saving throws for 1 hour                                         Pairs well with Concentration (Wave 2). Plant the seed.
  ---------------------- ------------ --------------------------------------------------------------------------------- ------------------------------------------------------------------

## Offensive Buffs
  --------------------------------- ------------ ------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------------------------------
  **Item**                          **Floors**   **Effect**                                                                **Notes**

  Potion of Heroism                 2--3         Gain 10 temp HP + Bless effect (+1d4 to attacks and saves) for 1 minute   High-value extract. Bless is one of the strongest low-level SRD effects.

  Potion of Giant Strength (Hill)   2--3         STR becomes 21 for 1 hour                                                 Melee-specific, dramatic, easy to understand.

  Oil of Sharpness                  1--3         Apply to weapon: +1 attack and damage for 10 minutes                      Consumable enhancement. Stacks with gear bonuses — monitor for abuse.

  Potion of Speed                   3 only       Grants Haste effect for 1 minute                                          High implementation lift (Haste is complex in real-time). Floor 3 only. Wave 2 implementation — design ruleset early.
  --------------------------------- ------------ ------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------------------------------

## Utility
  ------------------------ ------------ --------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Item**                 **Floors**   **Effect**                                                            **Notes**

  Potion of Invisibility   3 only       Invisible for 1 minute or until attacking/casting                     Intentional inclusion to stress-test stealth in PvP early. Watch closely in playtesting.

  Potion of Climbing       1--3         Climbing speed equals walking speed, advantage on climbing checks     Utility value depends on level geometry. Good test case for environmental design.

  Antitoxin                1--3         Advantage on CON saves vs. poison for 1 hour                          Cheap, common, good floor 1 filler. Teaches the consumable habit.

  Potion of Mind Reading   3 only       Cast Detect Thoughts — sense surface thoughts of nearby creatures   Open design question: dungeon utility vs. PvP intelligence tool (reveals nearby player positions?). Requires deliberate design decision before implementation.
  ------------------------ ------------ --------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------

## Single-Use Wands (Magic System Test Cases)
Wands are consumables with a spell stapled to them — low system lift, high player delight. This set is designed to smoke-test specific parts of the magic system incrementally, from simplest (auto-targeting) to most complex (reaction timing).

  ------------------------ ------------ --------------------- -------------------------------------------------------- --------------------------------------------------------------------------------------------
  **Wand**                 **Floors**   **Targeting**         **Effect**                                               **System Test**

  Wand of Magic Missiles   1--3         Auto (nearest)        3 darts, 1d4+1 force each, auto-hit — no attack roll   Ideal first wand. No roll, no save, just fire. Simplest possible magic system entry point.

  Wand of Burning Hands    2--3         Cone AOE              3d6 fire damage in a short cone from caster              First AOE geometry test. Simple shape, short range.

  Wand of Thunderwave      2--3         Close AOE + push      2d8 thunder in a cube, pushes creatures back             Tests knockback physics — key for PvP design.

  Wand of Entangle         3 only       Ground-targeted AOE   Restrained condition in a 20ft square for 1 minute       Tests condition application and duration tracking.

  Wand of Shield           3 only       Self, instant         +5 AC reaction until start of next turn                  Most complex wand — tests reaction-timing system.
  ------------------------ ------------ --------------------- -------------------------------------------------------- --------------------------------------------------------------------------------------------

## Gear Acquisition
Gear enters play through two channels. In-run, items drop from monster kills, chests, and player kills. Equipment found mid-run can be equipped immediately, committing the player to a new build for the remainder of the run. In the hub, extracted gold and crafting materials can be spent at vendors or a crafting bench to commission specific items, giving veterans the ability to target particular builds rather than depending entirely on RNG.

# 6. Legendary Challenge Items
## Design Pattern
Legendary Challenge Items are a distinct rarity tier — visually and mechanically distinct from standard gear. Each one grants extraordinary power while imposing a self-restricting condition. Completing the condition and extracting on floor 10 grants a unique capstone reward. These items serve as veteran retention content: players who have extracted the best standard gear still have meaningful self-imposed challenges to chase.

The "Monty's Challenge" aesthetic: carrying one of these items should be visible to other players mid-run (a glow, a visual tell), making the carrier simultaneously a marked target and a potential legend. Other players who recognize the item will know exactly what is being attempted.


> **Sword of Ultimate Badassery \[Legendary\]**
> *This sword hums with barely-contained power. It does not share.*
> -   Unlocks all Fighter levels up to 10 and the Champion subclass
> -   Gains +1 at floor 3, +2 at floor 6, +3 at floor 9
> -   You may not equip or benefit from any other magic items during this run
> -   CHALLENGE: Extract on floor 10 having never equipped any other magic item to earn \[CAPSTONE REWARD\]
> **The Pauper's Crown \[Legendary\]**
> *A tarnished crown that weighs heavier the more gold you carry. So you don't.*
> -   Unlocks all Rogue levels up to 10 and the Arcane Trickster subclass
> -   You cannot pick up or benefit from gold during this run
> -   CHALLENGE: Extract on floor 10 to receive a massive retroactive gold multiplier applied to all gold that would have been collected
> **Tome of Certain Doom \[Legendary\]**
> *The margins are full of annotations. None of them are reassuring.*
> -   Unlocks all Wizard levels up to 10 and the Evoker subclass
> -   You cannot wear armor or use weapons
> -   All spells you cast are automatically upcasted to their maximum level
> -   Spell slots do not recover between floors
> -   CHALLENGE: Extract on floor 10 to earn \[CAPSTONE REWARD\]
> **The Coward's Bargain \[Legendary\]**
> *The contract is invisible. The ink is real.*
> -   Unlocks all Bard levels up to 10 and the College of Whispers subclass
> -   You cannot initiate combat with other players
> -   If another player attacks you first, you may defend yourself — the item knows the difference
> -   CHALLENGE: Extract on floor 10 without killing any other players to earn \[CAPSTONE REWARD\]
# 7. Meta Progression & Hub Economy
## The Hub
Between runs, players return to a persistent hub — a tavern, outpost, or waystation at the dungeon entrance. The hub is where extracted gold and materials are converted into permanent unlocks and starting gear. The hub does not make players stronger in raw terms; it expands what they can attempt.

## What Meta-Progression Unlocks
-   Starting gear — Uncommon items available to equip before a run begins (still level with the dungeon)

-   Class access — Prestige classes and subclasses gated behind meta-progression (e.g., Eldritch Knight requires extracting a certain item tier)

-   Crafting recipes — Commission specific Rare and Legendary items using extracted materials

-   Cosmetic unlocks — Titles, visual effects, character appearances tied to achievement milestones

## Hub Potion Shop
The hub's most immediate and accessible gold sink is a potion vendor. Extracted gold can be spent directly on consumable potions that are added to the character's starting loadout for their next run. This gives the meta-economy a legible, low-friction entry point — players don't need to understand crafting or gear unlocks to benefit from extracting gold.

Potions purchased in the hub are at risk like any other carried item. They go into the run, and if the character dies before extracting, those potions are lost. This keeps the hub shop meaningful without becoming a trivial safety net.


> **Design Note: The First Gold Loop**
> *Hub potions are intentionally the first thing a new player discovers they can buy. The loop — enter, survive, extract gold, buy a healing potion, go back in slightly more prepared — is the clearest possible on-ramp to the meta-economy. Everything more complex (crafting, gear unlocks, prestige classes) layers on top of this foundation.*
> **Design Principle: Expansion, Not Gatekeeping**
> *A new player can reach floor 10 on day one. Meta-progression makes the journey more interesting, not more accessible. Veterans have more build options, not a locked door the new player can't open.*
# 8. Vertical Slice — Floor 1 Walkthrough
The following describes a representative Floor 1 experience for a new player, demonstrating how core systems are introduced through natural play. All combat described uses the real-time system: free movement, Attack Timer on Space, bonus actions on dedicated keybinds.

## Setup
The player selects Fighter from the base class roster. No starting gear — this is their first run. They spawn at the dungeon entrance with a standard-issue shortsword and leather armor. HP: 24 (doubled base). The health bar looks reassuringly full. A cooldown arc sits dormant around the player character — it fills fast. The first thing the game teaches is that the arc is their rhythm.

## First Room: Learning the Attack Timer
Two Goblin Scouts. Low AC, low HP — a clean teaching encounter. The player moves with WASD, gets close, waits a beat for the arc to fill, presses Space. A d20 rolls. The number appears. Hit — damage. The Goblin staggers. The arc resets. The second Goblin closes in. The player can move freely while waiting for the timer — circling, creating distance, repositioning. This is the loop at its most basic: move, time, strike.

No menu. No turn declaration. The attack just fires when the player is ready and the timer allows it. Goblins attack on their own timers — the player learns quickly that standing still in melee means trading hits, and trading hits is a losing game at level 1.


> **First Teaching Moment: The Arc is Your Turn**
> *New players coming from other action games may mash Space. New players coming from D&D may hesitate, looking for a turn prompt. The cooldown arc resolves both: it gives CRPG players a clear visual cue that it's their moment, and it teaches action gamers that combat here has a rhythm. After two rooms, the arc becomes intuitive.*
## The First Chest: Onboarding Moment
The second room contains a wooden chest, slightly glowing — visually distinct from standard loot piles. Opening it triggers a brief UI moment: the player's first magic item drops. For this Fighter, it is a Soldier's Reliable Longsword \[Uncommon\].


> **Soldier's Reliable Longsword \[Uncommon\]**
> *Unlocks Fighter levels up to 4. +1 enhancement bonus. While equipped, you may select a Fighter subclass at level 3. "It's seen better days. It's also seen worse ones."*
The +1 bonus is immediately visible — the next attack rolls with a +1 modifier on the d20 and damage. The tooltip explains the unlock mechanic. The player equips the sword immediately. The arc looks the same. The numbers are slightly bigger. That's the whole system.

## Encounter: Skeleton Patrol
Three Skeletons — resistant to piercing damage. The new sword is the wrong tool. A handaxe from the goblin room sits in inventory. Does the player swap mid-fight and lose a second of positioning, or push through with the suboptimal weapon? The skeletons' damage resistance means each hit does half — the fight is noticeably longer. An opportunity attack fires automatically when the player steps away from an adjacent skeleton, teaching the disengagement concept without a UI prompt. Take a hit, learn the rule.

## Player Presence: The Sound Cue
Late in the floor, a sound cue — footsteps, a distant door creak. Another player is somewhere on the floor. No obligation to engage. They're level 1 too, in the same cohort, running the same dungeon in parallel. But their nameplate isn't visible from here. The tension arrives not as a game event but as a question: do they hunt, hide, or race for the stairs?

## Floor Boss: The Hobgoblin Warden
The floor ends with a Hobgoblin Warden and two guards. The Warden uses Legendary Resistance (once per fight, auto-succeeds on a failed save) and the Help action — granting advantage to his guards' attacks. More complex than anything before, but built entirely from systems the player has already touched. Defeating the Warden drops a guaranteed Uncommon consumable and a moderate gold pile. The Warden's attack timer is slower but hits hard — the player learns that spacing and timing matter more against high-damage enemies than against swarms.

## The Stairs: First Real Decision
Level up — now level 2. Long rest triggers: HP restored to 24, Second Wind recharged. The current loadout: a +1 longsword, a Potion of Healing, 47 gold, an Uncommon scroll. The stairs down are visible. So is the extraction portal on the other side of the floor.

-   Go deeper: floor 2 is harder, loot scales up. Hit level 3, unlock a subclass. The sword gets better. So does everything trying to kill you.

-   Extract now: everything in pocket is safe. The sword alone is worth having in the stash. Walk away clean.

This is the game. This exact moment, repeated with higher stakes, more powerful builds, and other real players between them and the exit, for ten floors.

# 9. Open Design Questions & Backlog
The following items are flagged for future design work and are not resolved in this document.

## High Priority
-   Attack Timer tuning — current default of 'a few seconds' needs a specific value and playtesting pass; affects all class balance

-   Attack Timer compensation for Extra Attack — cooldown should be tuned upward at levels where multi-attack kicks in to prevent DPS explosion; exact multiplier TBD

-   Consumable rate-limiting — free activation is currently unconstrained; needs a design pass before PvP playtesting (separate cooldown per item? global potion cooldown?)

-   Reaction system design — auto-resolve vs. player-prompted reactions for active abilities; UX for reaction prompts TBD

-   Skirmisher Rogue — original subclass requires dedicated design spec: define 'moving' window in real-time terms, bonus types, interaction with Sneak Attack and Attack Timer

-   Sharpshooter Fighter — real-time adaptation of feat math needs custom tuning pass; positioning/accuracy tradeoff in a timer-based system TBD

-   Concentration mechanic reimagining — holding concentration while moving and fighting simultaneously; may need a visual indicator and auto-break conditions

-   Potion of Mind Reading — decide: dungeon utility item or PvP intelligence tool (player position reveal)?

-   Potion of Speed/Haste — design real-time ruleset early even though implementation is Wave 2; Haste's extra action becomes a second Attack Timer event

-   Potion of Invisibility — playtesting watch item: PvP implications during extraction ritual need monitoring

-   Floor 1--3 consumable drop table — full review pass after first playtesting wave

-   Extraction broadcast design — range, visual/audio cue, UI treatment

-   Full class roster prioritization — which SRD classes ship in v1?

-   Capstone reward design for Legendary Challenge Items

-   Out-of-combat regen rate tuning — rate and combat-detection radius

## Medium Priority
-   Bonus action rate-limiting — currently free; Monks with Flurry of Blows and Rogues with Cunning Action may need per-ability cooldowns rather than the action category being fully unconstrained

-   Descent lever spacing calibration — crossing window needs playtesting at various movement speeds and movement-boosting builds

-   Lightweight opt-in party system — design, loot split rules, betrayal mechanics

-   Full loot table design using SRD as baseline

-   Hub visual design and NPC roster (including potion vendor)

-   Optimal gearless multiclass combinations — monitor and tune

-   Stealth/invisibility PvP interactions in real-time context

-   Prestige class unlock requirements and full roster

-   Hub potion pricing and available potion types at launch

-   Doubled HP interaction with temporary HP effects and death saves

-   Counterspell tuning for PvP contexts (Wave 2+)

## Low Priority / Future
-   Healing Word and bonus action economy tuning — critical for Wave 2 casters but not blocking Wave 1

-   Legendary item visual tell design (aura, particle effects, etc.)

-   Procedural floor generation parameters per depth tier

-   Sound design language for player presence and extraction broadcast cues

-   Floor 10 endgame feel — 48-player chaos needs its own design pass

-   Attack animation design — how to visually distinguish single attack, Extra Attack, Flurry of Blows, etc. within the same timer framework

*Monty Haul's Dungeon Crawl | GDD v0.8 | Internal Reference*
