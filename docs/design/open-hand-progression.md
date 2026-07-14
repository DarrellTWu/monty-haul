---
status: design-only
updated: 2026-07-13
purpose: Monk class + Way of the Open Hand subclass — full 1–10 ability sequence proposal. Levels 1–3 are implemented; 4–10 are design intent for tweaking.
---

# Monk / Way of the Open Hand — Level 1–10 Progression

The Monk's engine is ki — a per-rest pool that the floor long-rest model refills
cleanly (GDD §Monk) — and its identity is fighting *without* gear in a game about
gear. **Way of the Open Hand** is the control half of the Wave-1 roster: Flurry of
Blows stops being just damage and starts dictating the opponent's action economy
(stagger today; heal-on-demand at 6; untouchable-until-provoked at 10). Best PvP
disruption kit in the roster, per the GDD.

Chassis is SRD Monk (Deflect Missiles, Stunning Strike, Evasion, Unarmored Movement
scaling, Purity of Body); Open Hand features land at 3 / 6 / 10 — the SRD's 3 / 6 /
11 / 17 cadence with Tranquility pulled from 11 down to the level-10 capstone.

## Implemented today (levels 1–3)

| Lvl | Feature | Real-time translation |
|---|---|---|
| 1 | **Unarmored Defense (WIS)** | AC = 10 + DEX + WIS with no armor and no shield. |
| 1 | **Martial Arts** | Bonus unarmed strike rides every melee Attack event while unarmored, no shield, wielding a monk weapon (`MONK_WEAPON_IDS`: shortsword, dagger, handaxe, mace, or empty hands). Unarmed strikes are DEX-eligible (finesse-treated) and deal 1d4 — the `UNARMED` def carries a `TODO` for the level-scaled martial-arts die. |
| 2 | **Ki** (pool = monk level, refilled on long rest) | Three 1-ki hotbar abilities: **Flurry of Blows** (two bonus unarmed strikes, `applyFlurryOfBlows`), **Patient Defense** (attackers disadvantaged, 6 s condition), **Step of the Wind** (`'dash'` — ×2 speed, 6 s). |
| 2 | **Unarmored Movement +10 ft** | Speed bonus while unarmored, no shield (`grants.unarmoredMovementFt`, read in MovementSystem). |
| 1* | **canClimb** | Monks scale platform perimeters without steps — class flag, live from level 1. |
| 3 | **Subclass: Open Hand** — *Open Hand Technique* | Via `open_hand_manual` emblem. Each Flurry hit staggers the target: its attack timer is pushed to `OPEN_HAND_STAGGER_MS` (4.5 s) — the real-time stand-in for the SRD's trip/push/no-reactions rider. |

## Proposed levels 4–10 (design intent — not built)

| Lvl | Base Monk | Open Hand overlay | Real-time notes |
|---|---|---|---|
| 4 | ASI | — | Shared martial gap — see `skirmisher-progression.md` open questions. (SRD Slow Fall also lands here; no fall damage exists — skipped.) |
| 5 | **Extra Attack** · **Stunning Strike** · MA die → d6 | — | Extra Attack per the canonical design in `champion-progression.md` §5 — note the Monk's full stack: 2 attacks + MA bonus strike + optional Flurry. Stunning Strike: 1 ki, next melee hit forces a CON save or the target is **stunned** (no move, no attack) for `STUNNING_STRIKE_MS` (propose 2000). Needs a real stun condition on enemies/players — a bigger hammer than stagger; the headline PvP flag below. Martial-arts die d4 → d6 resolves the `UNARMED` TODO (die from monk level). |
| 6 | **Ki-Empowered Strikes** · UM +15 ft | **Wholeness of Body** | Ki-Empowered: unarmed strikes count as magical — dormant until DR-with-bypass enemies exist (tier 2+ monsters); ship as data, zero engine cost. Wholeness of Body: hotbar heal for 3 × monk level HP, 1/rest — the gearless class finally gets sustain parity with Second Wind. |
| 7 | **Evasion** · **Stillness of Mind** | — | Evasion: DEX saves take 0 on success, half on failure (same engine change as Rogue 7 — build once). Stillness of Mind: charm/fright cleanse — forward-compat, no such conditions yet. |
| 8 | ASI | — | |
| 9 | **Unarmored Movement: vertical** | — | SRD "run along vertical surfaces" is already half-owned by `canClimb`; proposed real-time upgrade: climbing no longer breaks momentum (no speed penalty crossing perimeters) + can cross `never`-unlock walls? No — keep it modest: climb at full speed, and Step of the Wind works while climbing. DESIGN_TBD. |
| 10 | **Purity of Body** · UM +20 ft | **Tranquility** (capstone, SRD 11th pulled down) | Purity of Body: immune to poison damage + poisoned condition (poison exists on tier-1 loot tables' flavor only — cheap data flag). Tranquility: out of combat, enemies do not aggro the Monk until the Monk attacks or touches a container — sanctuary as extraction tool. Depends on the Sprint F AI aggro model; the loot-window `lockedBy` interaction (does opening a corpse break sanctuary? yes) needs a decision. |
| 5–10 | **Ki pool = monk level** | — | Already implemented generically via `getKiMax` — scales with no new work; listed for completeness. |

## Tuning constants (current values)

| Constant | Value | Note |
|---|---|---|
| `KI_ABILITY_COST` | 1 | Per Flurry / Patient Defense / Step of the Wind (and proposed Stunning Strike) |
| `PATIENT_DEFENSE_DURATION_MS` | 6000 | |
| `STEP_OF_WIND_DURATION_MS` | 6000 | |
| `OPEN_HAND_STAGGER_MS` | 4500 | Flurry stagger push |
| Unarmored Movement | +10 ft (level 2) | Proposed: +15 at 6, +20 at 10 (SRD scaling) via existing `grants.unarmoredMovementFt` max rule |

## PvP flags

- **Stunning Strike (5) is the single most dangerous proposal in the Wave-1 4–10 set.**
  A true stun (no move, no attack) in a real-time PvP extraction game is
  lose-your-loot-to-a-coin-flip territory. Mitigations to decide before build:
  short duration (≤2 s), diminishing returns on repeat stuns, ki cost of 2, or PvE-only
  at first. Do not ship it PvP-enabled without a dedicated playtest.
- **Stagger vs Berserker**: Mindless Rage (Berserker 6 proposal) blunts or ignores the
  Open Hand stagger — see `berserker-progression.md` PvP flags for the counterpart note.
- **Tranquility** in PvP reads as "invisible to third parties until he swings" — it
  should never suppress *player* awareness, only monster aggro. State that in the
  implementation ticket explicitly.

## Open design questions

1. Martial-arts die scaling (d4 → d6 at 5, d8 at 11-cap-never) — resolve the `UNARMED`
   TODO as a monk-level lookup; does the die also feed Flurry (SRD: yes)?
2. Stunning Strike's condition system — stun needs enemy + player condition support
   (enemies currently have no condition list at all). Build alongside the Sprint F
   behavior palette or after it?
3. Wholeness of Body at 3×level vs the Second Wind scaling question
   (`champion-progression.md` open question 4) — resolve both heals with one policy.
4. Drunken Master (the other GDD Monk subclass) shares this chassis; write its doc
   mirroring this one when it's scheduled.
5. Does Tranquility conflict with the "late-join into an in-progress room" limitation
   (a tranquil Monk parked on the stairs is invisible to a monster wave the other
   player kited there)? Revisit after private-room matchmaking fully lands.
