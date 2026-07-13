// shared/logic/unlock.js
// Data-driven unlock conditions for stairs and doors (roadmap Sprint E,
// pulled forward). Replaces the `lockedUntilAllEnemiesDead` boolean and the
// `_permanentlyLockedStairs` Set stopgap that previously lived in DungeonRoom.
//
// Floor-data shape (on a stair or door def):
//   unlock: { kind: 'enemies_cleared' }  — starts locked; opens when every
//                                          enemy on the floor is dead
//   unlock: { kind: 'never' }            — starts locked; never auto-opens
//                                          (decorative stair to an unbuilt floor)
//   (absent)                             — starts unlocked (doors may still
//                                          declare static `locked: true`)
//
// New kinds (lever, enemies_cleared_in_room, key item, …) are added here and
// in the ctx the room passes to shouldUnlock — floor files only ever select
// and parameterize them.

export const UNLOCK_KINDS = new Set(['enemies_cleared', 'never']);

/** True iff `unlock` is a well-formed unlock def (or absent). */
export function isValidUnlock(unlock) {
  if (unlock === undefined || unlock === null) return true;
  return typeof unlock === 'object' && UNLOCK_KINDS.has(unlock.kind);
}

/** Entities with any unlock condition start locked. */
export function startsLocked(unlock) {
  return unlock !== undefined && unlock !== null;
}

/**
 * Evaluate an unlock condition against the current floor context.
 * Unknown kinds and 'never' stay locked (fail-closed).
 *
 * @param {{ kind: string } | undefined} unlock
 * @param {{ allEnemiesDead?: boolean }} ctx
 * @returns {boolean} true when the entity should unlock this tick
 */
export function shouldUnlock(unlock, ctx = {}) {
  if (!unlock) return false;
  if (unlock.kind === 'enemies_cleared') return !!ctx.allEnemiesDead;
  return false;
}
