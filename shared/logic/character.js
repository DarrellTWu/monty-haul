// shared/logic/character.js
// Pure, framework-free validators for character creation.
// Imported by HubScene (pre-submit assert) and DungeonRoom.onJoin (auth gate).

import { POINT_BUY_BUDGET, POINT_COST, SCORE_MIN, SCORE_MAX } from '../data/constants.js';

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * Validate a complete ability-score object against point-buy rules:
 *   - all six keys present and numeric integers
 *   - each score within [SCORE_MIN, SCORE_MAX]
 *   - total point cost ≤ POINT_BUY_BUDGET
 *
 * Returns `{ ok: true }` on success, `{ ok: false, error }` otherwise.
 * The error string is short and safe to surface to the user.
 *
 * @param {unknown} scores
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateAbilityScores(scores) {
  if (!scores || typeof scores !== 'object') {
    return { ok: false, error: 'scores must be an object' };
  }
  for (const k of ABILITY_KEYS) {
    const v = scores[k];
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      return { ok: false, error: `${k} must be an integer` };
    }
    if (v < SCORE_MIN || v > SCORE_MAX) {
      return { ok: false, error: `${k} must be between ${SCORE_MIN} and ${SCORE_MAX}` };
    }
  }
  let cost = 0;
  for (const k of ABILITY_KEYS) {
    const c = POINT_COST[scores[k]];
    if (c == null) return { ok: false, error: `${k}=${scores[k]} has no point cost` };
    cost += c;
  }
  if (cost > POINT_BUY_BUDGET) {
    return { ok: false, error: `point buy total ${cost} exceeds budget ${POINT_BUY_BUDGET}` };
  }
  return { ok: true };
}
