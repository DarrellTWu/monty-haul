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
import { HP_MULTIPLIER, SUBCLASS_UNLOCK_LEVEL } from '../data/constants.js';
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
 * Eligibility filter: any class below its per-class cap (gearless: 3). This
 * covers both continuing a taken class (fighter 1 → 2 → 3) and multiclassing
 * into an untaken one.
 */
export function getEligibleClassChoicesForLevelUp(player) {
  const out = [];
  for (const classId of Object.keys(CLASS_REGISTRY)) {
    if (getClassLevel(player, classId) >= getMaxLevelForClass(player, classId)) continue;
    out.push(classId);
  }
  return out;
}

/**
 * Ki pool maximum: monk class level once Ki is granted (monk 2+), else 0.
 * SRD: ki points = monk level.
 */
export function getKiMax(player) {
  const lvl = getClassLevel(player, 'monk');
  return lvl >= 2 ? lvl : 0;
}

/**
 * Rage-use pool maximum for the player's current Barbarian level. Base pool
 * comes from classDef.rageUses; levels[n].grants.rageUses (absolute values)
 * override upward as the class levels (SRD: 2 rages at 1, 3 at level 3).
 * Returns 0 with no Barbarian levels.
 */
export function getRageUsesMax(player) {
  const def = CLASS_REGISTRY.barbarian;
  const lvl = getClassLevel(player, 'barbarian');
  if (lvl === 0 || !def) return 0;
  let uses = def.rageUses ?? 0;
  for (let n = 1; n <= lvl; n++) {
    const granted = def.levels?.[n]?.grants?.rageUses;
    if (granted !== undefined) uses = granted;
  }
  return uses;
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
 * Sneak Attack dice count (d6s) for the player's Rogue level: ceil(level / 2).
 * SRD scaling — 1d6 at rogue 1, 2d6 at 3, 3d6 at 5. Returns 0 with no Rogue
 * levels. Die size is SNEAK_ATTACK_DIE_SIDES in shared/data/constants.js.
 */
export function getSneakAttackDice(player) {
  const lvl = getClassLevel(player, 'rogue');
  return lvl > 0 ? Math.ceil(lvl / 2) : 0;
}

/** Default critical-hit threshold (natural 20) when no subclass improves it. */
export const DEFAULT_CRIT_RANGE = 20;

/**
 * Flat object of passive class features derived from the player's classLevels
 * (+ subclasses map when present).
 *
 *   - fightingStyle:       first non-null fightingStyle granted by any taken class
 *                          at a level ≤ its current level.
 *   - unarmoredDefense:    AC stat key ('wis' for Monk, 'con' for Barbarian);
 *                          first non-null found across taken classes.
 *   - canClimb:            OR across all taken classes.
 *   - dangerSense:         OR across levels[n].grants.dangerSense (Barbarian 2) —
 *                          advantage on DEX saves.
 *   - unarmoredMovementFt: max across levels[n].grants.unarmoredMovementFt (Monk 2) —
 *                          speed bonus while unarmored, no shield.
 *   - critRange:           min across taken subclasses' grants.critRange
 *                          (Champion: 19); DEFAULT_CRIT_RANGE otherwise.
 *   - frenzy:              OR across taken subclasses (Berserker) — extra weapon
 *                          attack per Attack event while raging.
 *   - openHandTechnique:   OR across taken subclasses (Open Hand) — Flurry hits
 *                          stagger the target.
 *   - skirmish:            OR across taken subclasses (Skirmisher) — Sneak Attack
 *                          eligible when attacker and target are both moving.
 */
export function getDerivedClassFeatures(player) {
  const out = {
    fightingStyle: null,
    unarmoredDefense: null,
    canClimb: false,
    dangerSense: false,
    unarmoredMovementFt: 0,
    critRange: DEFAULT_CRIT_RANGE,
    frenzy: false,
    openHandTechnique: false,
    skirmish: false,
  };
  // Tolerate missing classLevels (e.g. plain-object test fixtures): no taken
  // classes ⇒ no derived features.
  if (!player.classLevels) return out;
  for (const [classId, lvl] of player.classLevels) {
    const def = CLASS_REGISTRY[classId];
    if (!def) continue;
    if (def.canClimb) out.canClimb = true;
    if (!out.unarmoredDefense && def.unarmoredDefense) out.unarmoredDefense = def.unarmoredDefense;
    for (let n = 1; n <= lvl; n++) {
      const grants = def.levels?.[n]?.grants;
      if (!grants) continue;
      if (!out.fightingStyle && grants.fightingStyle) out.fightingStyle = grants.fightingStyle;
      if (grants.dangerSense) out.dangerSense = true;
      if (grants.unarmoredMovementFt > out.unarmoredMovementFt) {
        out.unarmoredMovementFt = grants.unarmoredMovementFt;
      }
    }
  }
  // Subclass grants. `player.subclasses` is a MapSchema (server) or Map
  // (fixtures) of classId → subclassId; absent pre-subclass.
  if (player.subclasses) {
    for (const [classId, subclassId] of player.subclasses) {
      const grants = CLASS_REGISTRY[classId]?.subclasses?.[subclassId]?.grants;
      if (!grants) continue;
      if (grants.critRange && grants.critRange < out.critRange) out.critRange = grants.critRange;
      if (grants.frenzy) out.frenzy = true;
      if (grants.openHandTechnique) out.openHandTechnique = true;
      if (grants.skirmish) out.skirmish = true;
    }
  }
  return out;
}

/**
 * Attempt to unlock a subclass for `classId` from the player's carried items.
 * Pure: the item registry is injected so tests can pass fixtures.
 *
 * Rules:
 *   - class must define subclasses and the player must be at/above
 *     SUBCLASS_UNLOCK_LEVEL in it;
 *   - the player must not already have a subclass for that class;
 *   - `carriedItemIds` must contain an emblem item whose unlocks.classId
 *     matches and whose subclassId exists on the class def.
 *
 * On success mutates player.subclasses (creating a Map when absent — the
 * server pre-seeds a MapSchema) and returns { subclassId, name }; else null.
 */
export function trySubclassUnlock(player, classId, carriedItemIds, itemRegistry) {
  const def = CLASS_REGISTRY[classId];
  if (!def?.subclasses) return null;
  if (getClassLevel(player, classId) < SUBCLASS_UNLOCK_LEVEL) return null;
  if (player.subclasses?.get?.(classId)) return null;
  for (const itemId of carriedItemIds) {
    const item = itemRegistry[itemId];
    if (item?.category !== 'emblem') continue;
    if (item.unlocks?.classId !== classId) continue;
    const sub = def.subclasses[item.unlocks.subclassId];
    if (!sub) continue;
    if (!player.subclasses) player.subclasses = new Map();
    player.subclasses.set(classId, sub.id);
    return { subclassId: sub.id, name: sub.name };
  }
  return null;
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
  }

  // Newly-granted features at this class level; the caller seeds them onto
  // the hotbar. (First level in a class ⇒ newClassLevel === 1 ⇒ levels[1].)
  const features = (def.levels?.[newClassLevel]?.features ?? []).slice();

  // Feature-keyed resource pools: available the moment the feature is gained.
  if (features.includes('second_wind'))  player.secondWindAvailable  = true;
  if (features.includes('action_surge')) player.actionSurgeAvailable = true;

  // Grant-keyed pools that scale or override upward with class level.
  const grants = def.levels?.[newClassLevel]?.grants ?? {};
  if (grants.rageUses !== undefined) player.rageUsesRemaining = grants.rageUses;
  const kiMax = getKiMax(player);
  if (kiMax > 0) {
    player.kiMax    = kiMax;
    player.kiPoints = kiMax;
  }

  return { ok: true, features, hpGain, isFirstInClass };
}
