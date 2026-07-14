---
status: design-only
updated: 2026-07-13
purpose: Fighter class + Champion subclass — full 1–10 ability sequence proposal. Levels 1–3 are implemented; 4–10 are design intent for tweaking. Canonical home of the shared Extra Attack (level 5) real-time design all martials reference.
---

# Fighter / Champion — Level 1–10 Progression

The Fighter is the anchor class and tutorial vehicle (GDD §Fighter): weapon-agnostic,
no resource pool to learn, every feature legible. The **Champion** doubles down on
that simplicity — its identity is *the crit*. Expanded crit range at 3 makes every
attack roll a little lottery, and the 4–10 arc keeps paying the same currency:
more attacks (5), more durability (7, 9), and a second fighting style (10) rather
than new subsystems. If the Skirmisher is the most skill-expressive build, the
Champion is the most readable — you always know why the number was big.

Chassis is SRD Fighter (Second Wind, Action Surge, Extra Attack, Indomitable);
Champion features land at 3 / 7 / 10, compressing the SRD's 3 / 7 / 10 / 15 / 18
cadence into the 10-floor run.

## Implemented today (levels 1–3)

| Lvl | Feature | Real-time translation |
|---|---|---|
| 1 | **Second Wind** | Hotbar ability: heal 1d10 + fighter class level, 1/rest (`applySecondWind`; refreshed by `_longRest` on descend). |
| 1 | **Fighting Style: Dueling** | Passive: +2 damage with a one-handed melee weapon and no offhand weapon (shield OK). Via `getDerivedClassFeatures().fightingStyle` — activates for multiclassers. |
| 2 | **Action Surge** | Hotbar ability: instantly reset the attack timer, 1/rest (`applyActionSurge`; no-op guard — won't burn the use when the timer is already ready). |
| 3 | **Subclass: Champion** — *Improved Critical* | Via `champion_sigil` emblem. `critRange` 19 — a 19 crits **only if the total also hits**; natural-20-only auto-hit is preserved (see `resolveAttack`). |

## Proposed levels 4–10 (design intent — not built)

| Lvl | Base Fighter | Champion overlay | Real-time notes |
|---|---|---|---|
| 4 | ASI (+2 one score or +1/+1, caps 20) | — | Needs the ASI picker — the shared martial gap; design once, all four classes reuse it (see `skirmisher-progression.md` open questions). |
| 5 | **Extra Attack** | — | **The shared level-5 design, canonical here.** One Space press fires N=`attacksPerAction` full attack rolls simultaneously (per the action-economy translation — no second animation window). Each roll is independent (separate d20, separate crit check — a Champion's favorite level). To keep DPS from doubling flat, the attack timer scales: `ATTACK_COOLDOWN_MS × EXTRA_ATTACK_COOLDOWN_MULT` (propose 1.4 → ~40% net DPS gain). Barbarian 5 and Monk 5 reference this design rather than re-deciding it. |
| 6 | ASI | — | |
| 7 | — | **Remarkable Athlete** | SRD version is skill-check-bound; real-time stand-in: gain `canClimb` (platform perimeters without steps — the Fighter is the only Wave-1 class that never gets vertical mobility) plus out-of-combat regen at 1.5× rate. DESIGN_TBD — the climb half alone may be enough. |
| 8 | ASI | — | |
| 9 | **Indomitable** | — | Reroll one failed saving throw, 1/rest. Auto-resolved server-side: the first failed save each rest (traps are today's only source) is silently rerolled, combat log shows `Indomitable: rerolled`. No keybind — reactions auto-trigger per the action-economy table. |
| 10 | — | **Additional Fighting Style** (capstone) | Second style: propose **Defense** (+1 AC while wearing armor) as the fixed pick — no choice UI needed at MVP. Implementation note: `getDerivedClassFeatures().fightingStyle` is currently first-non-null; becomes a *set* when this lands (Dueling + Defense coexist). Alternative if a choice UI exists by then: Archery (+2 ranged attack) for bow Fighters. |

## Tuning constants (current values)

| Constant | Value | Note |
|---|---|---|
| `ATTACK_COOLDOWN_MS` | 3000 | Base attack timer; Extra Attack multiplies it (proposed) |
| Second Wind heal | 1d10 + fighter level | In `applySecondWind`, not a named constant |
| Champion `critRange` | 19 | On the subclass grant, not in constants.js |
| `CRIT_MULTIPLIER` | 2 | Total damage ×2 on crit |

## PvP flags

- **Action Surge + Extra Attack** is the burst ceiling of the roster: timer reset into
  a double attack. Fine vs monsters; in PvP that's potentially ~4 weapon rolls in a
  second from level 5. Watch it in the first PvP playtest — the lever is making Action
  Surge not stack within N ms of an Extra Attack volley.
- **Indomitable** is invisible to the opponent (a save that should have failed didn't).
  Acceptable for traps; revisit if player-inflicted saves (spells) ever land.

## Open design questions

1. `EXTRA_ATTACK_COOLDOWN_MULT` — 1.4 proposed; the balance sim can sweep this once it
   models Extra Attack (natural Sprint G extension).
2. Remarkable Athlete — is `canClimb` at 7 too late to matter, given floors 1–6 will
   have been designed around Fighters walking to steps? Check against Sprint E floor
   authoring.
3. Additional Fighting Style — fixed Defense vs a picker. A picker is also the gateway
   to letting level-1 Fighters choose their first style (currently locked to Dueling).
4. Second Wind scaling — flat 1d10 + level thins out by floor 8 (~15 HP vs ~90 max HP
   pools). Consider 1d10 per 3 fighter levels or a percentage heal in the same slot.
