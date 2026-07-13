---
status: design-only
updated: 2026-07-13
purpose: Rogue class + Skirmisher subclass — full 1–10 ability sequence proposal. Levels 1–3 are implemented; 4–10 are design intent for tweaking. The GDD-flagged "dedicated design spec" for the Skirmisher's moving window.
---

# Rogue / Skirmisher — Level 1–10 Progression

The Rogue's defining mechanical challenge (GDD §Rogue) is Sneak Attack's positioning
dependency. The **Skirmisher** — an original subclass — answers it with movement:
*Sneak Attack lands when both you and your target are moving.* Stand still and you're
just a d8 martial with a shortsword; keep moving and force your prey to move, and every
hit carries sneak dice. It is the ranged/mobile half of the Rogue pair (the melee half,
Swashbuckler, is deferred — see GDD).

Chassis is SRD Rogue (Sneak Attack scaling, Cunning Action, Uncanny Dodge, Evasion),
adapted per the real-time action-economy translation. Subclass feature cadence follows
the project's existing pattern (Champion / Berserker / Open Hand grant at class level 3)
extended with follow-up grants at 7 and 10, mirroring how the SRD Thief spaces its
features across a campaign — compressed here into the 10-floor run.

## Implemented today (levels 1–3)

| Lvl | Feature | Real-time translation |
|---|---|---|
| 1 | **Sneak Attack 1d6** | Passive. Once per Attack event, the first eligible hit (main hand, then offhand) adds ⌈rogue level / 2⌉ d6. Eligible when the weapon is finesse or ranged AND: the attack has **advantage**, OR an **ally player is within `ALLY_ADJACENT_PX`** of the target with no disadvantage. Sneak dice double on a crit. Pure helper: `sneakAttackEligibility` in `shared/logic/combat.js`. |
| 1 | *Expertise, Thieves' Cant* | **Skipped** — no skill system to land on. Revisit if skills ever ship. |
| 2 | **Cunning Action (Dash)** | Hotbar ability: `dash` condition (×2 speed, reuses the Step of the Wind HUD ring) for `CUNNING_ACTION_DASH_MS` (3 s), lockout `CUNNING_ACTION_COOLDOWN_MS` (9 s from use → 33% uptime). Disengage and Hide are deferred — no opportunity-attack or stealth systems exist yet. |
| 3 | **Subclass: Skirmisher** — *Skirmish* | Via `skirmisher_spurs` emblem. Sneak Attack gains a third eligibility path: **you and your target are both moving** at the instant the attack resolves (either entity's `vx`/`vy` non-zero on the server tick), and the attack has no disadvantage. Works in melee and at range. |
| 3 | Sneak Attack → **2d6** | Automatic from the ⌈level/2⌉ formula. |

**The moving window (GDD's "TBD"):** v1 samples instantaneous server-tick velocity at
attack resolution. This is the simplest honest definition — no grace timers, no history
buffer. Known consequences to playtest: (a) enemies stop to swing, so you must catch
them mid-chase — intended skill expression; (b) tap-strafing between attacks satisfies
"you are moving" trivially — acceptable, you're still repositioning under a 3 s attack
timer; (c) a laggy player's stop may register a tick late — harmless at 20 Hz. If (a)
feels too punishing, the designed fallback is a **recent-movement grace window**
(`SKIRMISH_GRACE_MS ≈ 250`) on the *target* side only: "moving, or moved within the
last quarter second."

## Proposed levels 4–10 (design intent — not built)

| Lvl | Base Rogue | Skirmisher overlay | Real-time notes |
|---|---|---|---|
| 4 | ASI (+2 one score or +1/+1, caps 20) | — | Needs the ASI picker (no system yet — same gap as Fighter/Barbarian/Monk 4; design once, share). |
| 5 | **Uncanny Dodge** · Sneak **3d6** | — | Reaction, auto-resolved server-side: halve the damage of one incoming attack, then unavailable for `UNCANNY_DODGE_LOCKOUT_MS` (propose 6 s ≈ "once per round" ×2 attack timers). HUD: brief shield flash + ring. |
| 6 | *Expertise* → replaced: **Slippery** | — | SRD Expertise is skill-bound; proposed stand-in: Cunning Action cooldown 9 s → 6 s. Keeps the class's mobility identity growing. DESIGN_TBD — cut freely if 5+7 already feel rich. |
| 7 | **Evasion** · Sneak **4d6** | **Hit-and-Run** | Evasion: DEX saves (traps are today's only source) — take 0 on success, half on failure. Hit-and-Run: landing a Sneak Attack grants the `dash` condition for 2 s, free, no cooldown interaction — the reward loop: move → sneak → burst away. |
| 8 | ASI | — | |
| 9 | Sneak **5d6** | — | Quiet level by design; the power is the dice bump. |
| 10 | ASI (Rogue's extra ASI lands post-cap; use the standard one) · Sneak stays 5d6 | **Moving Target** (capstone) | While you are moving: ranged attacks against you have disadvantage, and your *skirmish-eligible* sneak attacks ignore long-range disadvantage. Both halves reward exactly the behavior the subclass teaches. Alternative capstone if too strong in PvP: skirmish sneak attacks add +1d6 (6d6 effective). |

Sneak Attack scaling recap (⌈level/2⌉ d6): 1d6 → 2d6 (3) → 3d6 (5) → 4d6 (7) → 5d6 (9).

## Tuning constants (current values)

| Constant | Value | Note |
|---|---|---|
| `SNEAK_ATTACK_DIE_SIDES` | 6 | |
| `ALLY_ADJACENT_PX` | 64 (= `MELEE_HIT_RANGE_PX`) | SRD "ally within 5 ft of target" |
| `CUNNING_ACTION_DASH_MS` | 3000 | |
| `CUNNING_ACTION_COOLDOWN_MS` | 9000 | From use, so 3 s dash + 6 s downtime |

## PvP flags

- **Skirmish in PvP** is the headline interaction: both players moving is the *normal*
  state of a PvP fight, so a Skirmisher effectively has Sneak Attack always-on against
  humans. That is arguably the fantasy (most skill-expressive class, GDD) but needs a
  playtest pass — the grace-window knob also works as a nerf lever (require the *target*
  to be moving away/fast, or require attacker displacement over the last second).
- **Cunning Action** is the first cooldown-limited bonus action (GDD flagged bonus-action
  rate limits for review) — the 9 s lockout is the review's first data point.
- **Moving Target (10)** stacks disadvantage generation in PvP; gate behind playtest.

## Open design questions

1. Moving-window grace (`SKIRMISH_GRACE_MS`) — ship if catching chase-movement feels too
   twitchy. Decide after first playtest.
2. Level-6 Expertise replacement — keep Slippery, or leave level 6 empty (dice bump at 7
   arrives anyway)?
3. Does Hit-and-Run's free dash bypass the Cunning Action cooldown (current proposal:
   yes, separate grant) or share it?
4. Uncanny Dodge lockout length — 6 s is two attack-timer cycles; halve if Rogue survivability
   underperforms the d8 hit die.
5. Skirmisher starting kit: shortsword today (Rogue default). Should the subclass fantasy
   push a shortbow into the starter loadout once the shop/loot tables carry more ranged
   options?
