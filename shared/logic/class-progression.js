// shared/logic/class-progression.js
// Pure helpers for multiclass character progression.
// No framework deps, no RNG. Mutates player objects in `applyClassLevel` only.
//
// Invariants (asserted in tests):
//   - player.level === sum(classLevels.values)
//   - levelUpHistory.length === player.level
//   - levelUpHistory[i] = class chosen at level (i+1)
//
// `applyClassLevel` is the only legal mutator of classLevels / levelUpHistory /
// player.level. Callers must invoke recomputeStats(player) afterward (handled
// at callsite, not here, since equipment.js owns AC derivation).

import { CLASS_REGISTRY } from '../data/classes/index.js';
import { HP_MULTIPLIER } from '../data/constants.js';
import { getModifier } from './combat.js';

/** Total character level across all classes. */
export function totalLevel(player) {
  let n = 0;
  for (const v of player.classLevels.values()) n += v;
  return n;
}

/** Returns the player's level in `classId` (0 if untaken). */
export function getClassLevel(player, classId) {
  return player.classLevels.get(classId) ?? 0;
}

/**
 * SRD average HP per level above 1: floor((hitDie/2 + 1 + conMod) * HP_MULTIPLIER).
 * Level 1 uses classDef.getStartingHp — these formulas intentionally coexist.
 */
export function computeHpGainForLevel(classDef, conMod) {
  return Math.floor((classDef.hitDie / 2 + 1 + conMod) * HP_MULTIPLIER);
}

/**
 * The MVP gearless cap: 3 per class, read from classDef.gearlessLevelCap.
 * `ctx` is the future hook for gear-driven unlocks; ignored in MVP.
 */
export function getMaxLevelForClass(player, classId, ctx) {
  const def = CLASS_REGISTRY[classId];
  if (!def) return 0;
  return def.gearlessLevelCap ?? 3;
}

/**
 * MVP eligibility filter: classes the player has NOT yet leveled in, capped
 * at 3 total class entries (forced-multiclass rule). Dropping the `=== 0`
 * clause enables same-class re-leveling later.
 */
export function getEligibleClassChoicesForLevelUp(player) {
  const out = [];
  for (const classId of Object.keys(CLASS_REGISTRY)) {
    if (getClassLevel(player, classId) !== 0) continue;
    out.push(classId);
  }
  return out;
}

/**
 * Set of feature ids unlocked by the player's classLevels + levelUpHistory.
 * Rule: a feature from levels[n] of class X is granted if the player has at
 * least n levels in X. (For MVP, n is always 1.)
 */
export function getGrantedFeatures(player) {
  const out = new Set();
  for (const [classId, lvl] of player.classLevels) {
    const def = CLASS_REGISTRY[classId];
    if (!def) continue;
    for (let n = 1; n <= lvl; n++) {
      const features = def.levels?.[n]?.features ?? [];
      for (const f of features) out.add(f);
    }
  }
  return out;
}

/**
 * Flat object of passive class features derived from the player's classLevels.
 *
 *   - fightingStyle:    first non-null fightingStyle granted by any taken class
 *                       at a level ≤ its current level.
 *   - unarmoredDefense: AC stat key ('wis' for Monk, 'con' for Barb when added);
 *                       first non-null found across taken classes.
 *   - canClimb:         OR across all taken classes.
 *
 * Returned shape is stable: { fightingStyle, unarmoredDefense, canClimb }.
 */
export function getDerivedClassFeatures(player) {
  let fightingStyle = null;
  let unarmoredDefense = null;
  let canClimb = false;
  // Tolerate missing classLevels (e.g. plain-object test fixtures): no taken
  // classes ⇒ no derived features.
  if (!player.classLevels) return { fightingStyle, unarmoredDefense, canClimb };
  for (const [classId, lvl] of player.classLevels) {
    const def = CLASS_REGISTRY[classId];
    if (!def) continue;
    if (def.canClimb) canClimb = true;
    if (!unarmoredDefense && def.unarmoredDefense) unarmoredDefense = def.unarmoredDefense;
    // fightingStyle is granted via levels[n].grants.fightingStyle
    if (!fightingStyle) {
      for (let n = 1; n <= lvl; n++) {
        const fs = def.levels?.[n]?.grants?.fightingStyle;
        if (fs) { fightingStyle = fs; break; }
      }
    }
  }
  return { fightingStyle, unarmoredDefense, canClimb };
}

/**
 * Take one level in `classId`. Mutates classLevels, levelUpHistory, level, and
 * (on first-level-in-class) seeds that class's per-class resource pool.
 *
 * Returns `{ ok, error?, features?, hpGain? }`. Does NOT call recomputeStats —
 * the caller is responsible (equipment.js owns AC derivation).
 *
 * On level 2+ of a class, HP is bumped by computeHpGainForLevel. On the
 * first level in a class (any level: 1 at join OR multiclass mid-run), the
 * level-1 features for that class are returned for the caller to seed onto
 * the hotbar.
 */
export function applyClassLevel(player, classId) {
  const def = CLASS_REGISTRY[classId];
  if (!def) return { ok: false, error: 'unknown class' };

  const prevClassLevel = getClassLevel(player, classId);
  const newClassLevel  = prevClassLevel + 1;
  const isFirstInClass = prevClassLevel === 0;
  const isJoinSeed     = totalLevel(player) === 0;

  player.classLevels.set(classId, newClassLevel);
  player.levelUpHistory.push(classId);
  player.level = totalLevel(player);

  // HP: join seed uses getStartingHp (max die); subsequent levels use the
  // SRD-average formula. Caller (onJoin) computes the join-seed value itself.
  let hpGain = 0;
  if (!isJoinSeed) {
    const conMod = getModifier(player.con);
    hpGain = computeHpGainForLevel(def, conMod);
    player.maxHp += hpGain;
    player.hp     = player.maxHp;
  }

  // Per-class resource pool init (only on first level in this class).
  if (isFirstInClass) {
    if (def.rageUses) player.rageUsesRemaining = def.rageUses;
    if ((def.levels?.[1]?.features ?? []).includes('second_wind')) {
      player.secondWindAvailable = true;
    }
  }

  const features = isFirstInClass ? (def.levels?.[1]?.features ?? []).slice() : [];

  return { ok: true, features, hpGain, isFirstInClass };
}
