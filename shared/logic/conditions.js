// shared/logic/conditions.js
// ─────────────────────────────────────────────────────────────────
// Pure timer bookkeeping for player conditions (rage, bless, longstrider,
// false_life). Caller owns the timer Map (room-scoped) and the player
// objects; this module only mutates fields on those values.
//
// Mirror fields (`*RemainingMs` on PlayerState) are duplicated here because
// they're synced to the client for HUD ring rendering — keeping them in lock-
// step with the timers Map is exactly the duplication this module exists to
// centralize.

/**
 * @typedef {Object} ConditionDef
 * @property {string}              mirrorField  PlayerState field synced to client (e.g. 'blessRemainingMs')
 * @property {(player) => string} [onExpireLog] Optional log string emitted when the condition expires
 * @property {(player) => void}   [onExpire]    Optional side effect on the player when the condition expires
 */

const cap = (s) => (s && s.length > 0) ? s[0].toUpperCase() + s.slice(1) : s;

/** @type {Record<string, ConditionDef>} */
export const CONDITION_DEFS = {
  rage: {
    mirrorField: 'rageRemainingMs',
    onExpireLog: (p) => `${cap(p.class)}'s Rage ends.`,
  },
  bless: {
    mirrorField: 'blessRemainingMs',
  },
  longstrider: {
    mirrorField: 'longstriderRemainingMs',
  },
  false_life: {
    mirrorField: 'falseLifeRemainingMs',
    onExpire: (p) => { p.tempHp = 0; },
  },
};

const timerKey = (sessionId, conditionId) => `${sessionId}_${conditionId}`;

/**
 * Apply (or refresh) a condition on a player. Idempotent: re-applying an
 * already-active condition refreshes the timer + mirror but does not duplicate
 * the entry in `player.conditions`.
 *
 * Unknown condition ids are a no-op (returns false).
 *
 * @param {object} player              PlayerState-shaped object (mutated)
 * @param {string} conditionId         Key into CONDITION_DEFS
 * @param {number} durationMs
 * @param {Map<string, number>} timers Caller-owned timer Map
 * @param {string} sessionId
 * @returns {boolean} true if applied, false if conditionId unknown
 */
export function applyCondition(player, conditionId, durationMs, timers, sessionId) {
  const def = CONDITION_DEFS[conditionId];
  if (!def) return false;
  if (!player.conditions.includes(conditionId)) {
    player.conditions.push(conditionId);
  }
  player[def.mirrorField] = durationMs;
  timers.set(timerKey(sessionId, conditionId), durationMs);
  return true;
}

/**
 * Advance all active condition timers by `dt` ms across every player. Expired
 * conditions are removed (from `player.conditions`, the timer Map, and the
 * mirror field), with `onExpire` / `onExpireLog` invoked from their def.
 *
 * Returns an array of log strings the caller should broadcast.
 *
 * @param {Map<string, object>|Iterable<[string, object]>} players  sessionId → player
 * @param {Map<string, number>} timers
 * @param {number} dt  milliseconds since last tick
 * @returns {string[]}
 */
export function tickConditions(players, timers, dt) {
  const logs = [];
  for (const [sessionId, player] of players) {
    // Snapshot the array — we mutate it inside the loop.
    for (const conditionId of [...player.conditions]) {
      const def = CONDITION_DEFS[conditionId];
      if (!def) continue;
      const key       = timerKey(sessionId, conditionId);
      const remaining = (timers.get(key) ?? 0) - dt;
      if (remaining <= 0) {
        timers.delete(key);
        const idx = player.conditions.indexOf(conditionId);
        if (idx !== -1) player.conditions.splice(idx, 1);
        player[def.mirrorField] = 0;
        if (def.onExpire)    def.onExpire(player);
        if (def.onExpireLog) logs.push(def.onExpireLog(player));
      } else {
        timers.set(key, remaining);
        player[def.mirrorField] = remaining;
      }
    }
  }
  return logs;
}

/**
 * Drop every active condition on `player` (used by long-rest). Clears the
 * conditions array, every mirror field, and every timer entry for this
 * session. Does NOT invoke `onExpireLog` — long rest is its own event.
 *
 * `onExpire` side effects (e.g. `false_life` clearing `tempHp`) ARE invoked so
 * the player state stays consistent.
 *
 * @param {object} player
 * @param {Map<string, number>} timers
 * @param {string} sessionId
 */
export function clearPlayerConditions(player, timers, sessionId) {
  for (const conditionId of Object.keys(CONDITION_DEFS)) {
    const def = CONDITION_DEFS[conditionId];
    player[def.mirrorField] = 0;
    timers.delete(timerKey(sessionId, conditionId));
    if (player.conditions.includes(conditionId) && def.onExpire) {
      def.onExpire(player);
    }
  }
  while (player.conditions.length > 0) player.conditions.pop();
}
