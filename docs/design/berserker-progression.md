---
status: design-only
updated: 2026-07-13
purpose: Barbarian class + Berserker subclass — full 1–10 ability sequence proposal. Levels 1–3 are implemented; 4–10 are design intent for tweaking.
---

# Barbarian / Berserker — Level 1–10 Progression

Rage is the class (GDD §Barbarian): a persistent, visually legible state that the
whole kit modifies. The **Berserker** is the throughput half of the pair — Frenzy
turns every Attack event while raging into two swings, and the 4–10 arc keeps
feeding the same loop: rage more often (6), rage harder (9), and finally make the
room afraid of the rage (10). High HP + physical resistance already makes the
Barbarian the natural loot mule; the Berserker trades none of that away.

Chassis is SRD Barbarian (Reckless Attack, Danger Sense, Extra Attack + Fast
Movement, Brutal Critical); Berserker features land at 3 / 6 / 10, following the
SRD's 3 / 6 / 10 / 14 cadence. The SRD Frenzy exhaustion cost is deliberately
dropped — exhaustion has no real-time system, and the extraction loop (lose the
run, lose the loot) already prices aggression.

## Implemented today (levels 1–3)

| Lvl | Feature | Real-time translation |
|---|---|---|
| 1 | **Rage** | Hotbar ability: +`RAGE_DAMAGE_BONUS` (2) melee damage, resistance to bludgeoning/piercing/slashing, `RAGE_DURATION_MS` (30 s — SRD's 1 minute shortened), 2 uses/rest (`rageUsesRemaining`; HUD ring via `rageRemainingMs`). |
| 1 | **Unarmored Defense (CON)** | AC = 10 + DEX + CON with no armor and no shield. Via `getDerivedClassFeatures().unarmoredDefense`. |
| 2 | **Reckless Attack** | Hotbar **toggle** (`'reckless'` condition, no timer): advantage on your melee attacks, enemies gain advantage against you. Cleared by long rest or re-toggle. |
| 2 | **Danger Sense** | Passive: advantage on DEX saves (wired into trap saves via `resolveSave({ advantage })`). |
| 3 | **Subclass: Berserker** — *Frenzy* | Via `berserker_totem` emblem. One extra main-weapon attack per Attack event while raging (no exhaustion cost). Rage pool also grows 2 → 3 (`grants.rageUses`). |

## Proposed levels 4–10 (design intent — not built)

| Lvl | Base Barbarian | Berserker overlay | Real-time notes |
|---|---|---|---|
| 4 | ASI | — | Shared martial gap — see `skirmisher-progression.md` open questions. |
| 5 | **Extra Attack** · **Fast Movement** | — | Extra Attack follows the canonical design in `champion-progression.md` §5 (N simultaneous rolls, cooldown ×~1.4). Note the stack: Extra Attack (2) + Frenzy (+1) = 3 swings per Attack event while raging. Fast Movement: +10 ft speed while not in heavy armor — same `grants` pattern as Monk Unarmored Movement (`fastMovementFt: 10`, read in MovementSystem). |
| 6 | — | **Mindless Rage** | SRD: can't be charmed/frightened while raging — neither condition exists yet (forward-compat when enemy casters land). Real-time value **now**: while raging, immune to attack-timer stagger and slow effects (Open Hand stagger is today's only source; more coming with the Sprint F behavior palette). "The rage does not stop." |
| 7 | **Feral Instinct** | — | SRD advantage-on-initiative has no real-time analog (no initiative). Proposed translation: activating Rage also resets the attack timer (rage-in becomes an engage button, echoing Action Surge's feel once per rage). DESIGN_TBD — alternative: +15% move speed for the first 3 s of each rage. |
| 8 | ASI | — | |
| 9 | **Brutal Critical** · rage damage +2 → +3 | — | Brutal Critical: +1 weapon damage die on melee crits (dice only, not modifiers — small `resolveAttack` extension, `brutalCritDice: 1` on derived features). Rage damage scaling to +3 matches the SRD's 9th-level bump; `RAGE_DAMAGE_BONUS` becomes level-indexed. |
| 10 | — | **Intimidating Presence** (capstone) | SRD is an action to frighten one creature; real-time version: hotbar burst, 1/rage — enemies within ~`ft(30)` flee the Barbarian for 3 s (WIS save negates). Depends on an AI flee state from the Sprint F behavior palette; do not build before it. In PvP: affected players get their target cleared + screen-edge vignette, no movement control theft (forced movement of humans feels terrible — flag for playtest). |

Rage-use scaling recap (SRD): 2 (level 1) → 3 (3) → 4 (6) → still 4 at 10.
Level 6 should ride the existing `grants.rageUses` override alongside Mindless Rage.

## Tuning constants (current values)

| Constant | Value | Note |
|---|---|---|
| `RAGE_DURATION_MS` | 30000 | SRD 1 min, shortened for real-time |
| `RAGE_DAMAGE_BONUS` | 2 | Proposed: level-indexed (+3 at 9) |
| `RAGE_USES` | 2 | Base pool; `grants.rageUses` overrides (3 at 3; propose 4 at 6) |
| `OPEN_HAND_STAGGER_MS` | 4500 | The effect Mindless Rage (6) would ignore |

## PvP flags

- **Reckless Attack + Frenzy + Extra Attack** at 5+ is three advantage swings per
  event while granting advantage back — the all-in button. Self-balancing on paper
  (you die faster too), but resistance-while-raging blunts the downside; watch the
  effective HP math in PvP.
- **Mindless Rage stagger-immunity** deletes the Open Hand Monk's subclass identity in
  that matchup. Consider "stagger duration halved" instead of full immunity if Monk
  win rates crater.
- **Intimidating Presence** must not chain-lock a player (see the no-movement-theft
  note above); 1/rage is the rate limiter.

## Open design questions

1. Feral Instinct translation — timer-reset-on-rage vs speed burst vs something that
   reads as "instinct" (e.g. brief damage-direction indicator through walls)?
2. Zealot (the other GDD Barbarian subclass — Rage Beyond Death) is unbuilt; when it
   lands it shares this chassis and only the 3/6/10 overlay column changes. Write its
   doc then, mirroring this one.
3. Does Frenzy's extra swing also multiply under Extra Attack at 5 (2+1=3, as proposed)
   or should Frenzy convert to a flat damage rider at that point to cap the roll count?
4. Rage uptime at 10: 4 rages × 30 s = 2 minutes per floor. Is that the intended
   "mostly raging in fights, never raging while looting" rhythm? Sim once floors 4+
   have real clear-time data.
