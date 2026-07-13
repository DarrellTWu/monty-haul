// shared/logic/validate-floors.js
// Boot-time floor-data validator (roadmap Sprint C). Pure — the registries it
// checks against are injected so tests can pass fixtures. Returns a flat list
// of human-readable error strings; empty list = valid.
//
// The server calls this once at startup (server/index.js) and refuses to boot
// on any error, so a broken floor file fails with a named error instead of a
// mid-tick crash.

/** True iff `r` is a well-formed rect { x, y, w, h } with positive size. */
function isRect(r) {
  return r && typeof r.x === 'number' && typeof r.y === 'number' &&
    typeof r.w === 'number' && typeof r.h === 'number' && r.w > 0 && r.h > 0;
}

function isPoint(p) {
  return p && typeof p.x === 'number' && typeof p.y === 'number';
}

/**
 * Validate every floor in `floorRegistry`.
 *
 * @param {Record<string|number, object>} floorRegistry — FLOOR_REGISTRY
 * @param {{ enemyTypes: Iterable<string>, isKnownItem: (id: string) => boolean }} refs
 *   enemyTypes — the enemy type ids the server can spawn
 *   isKnownItem — ITEM_REGISTRY membership check for chest contents
 * @returns {string[]} error strings; empty when all floors are valid
 */
export function validateFloorData(floorRegistry, { enemyTypes, isKnownItem }) {
  const errors = [];
  const err = (floorNum, msg) => errors.push(`floor ${floorNum}: ${msg}`);
  const enemyTypeSet = new Set(enemyTypes);
  const floorNums = new Set(Object.keys(floorRegistry).map(String));

  for (const [floorNum, floor] of Object.entries(floorRegistry)) {
    if (!floor || typeof floor !== 'object') {
      err(floorNum, 'floor def is not an object');
      continue;
    }

    // ── Required scalar shape ────────────────────────────────────────────────
    if (!(typeof floor.width === 'number' && floor.width > 0))   err(floorNum, `width must be a positive number (got ${floor.width})`);
    if (!(typeof floor.height === 'number' && floor.height > 0)) err(floorNum, `height must be a positive number (got ${floor.height})`);
    if (!isPoint(floor.playerSpawn)) {
      err(floorNum, 'playerSpawn must be { x, y }');
    } else if (
      typeof floor.width === 'number' && typeof floor.height === 'number' &&
      (floor.playerSpawn.x < 0 || floor.playerSpawn.x > floor.width ||
       floor.playerSpawn.y < 0 || floor.playerSpawn.y > floor.height)
    ) {
      err(floorNum, `playerSpawn (${floor.playerSpawn.x}, ${floor.playerSpawn.y}) is outside the floor bounds`);
    }
    for (const key of ['enemies', 'chests', 'traps', 'stairs']) {
      if (!Array.isArray(floor[key])) err(floorNum, `${key} must be an array`);
    }

    // ── Entity id uniqueness (across all entity kinds on the floor) ─────────
    const seenIds = new Set();
    const checkId = (kind, id) => {
      if (typeof id !== 'string' || id.length === 0) { err(floorNum, `${kind} with missing/empty id`); return; }
      if (seenIds.has(id)) err(floorNum, `duplicate entity id "${id}"`);
      seenIds.add(id);
    };

    // ── Enemies ─────────────────────────────────────────────────────────────
    for (const e of floor.enemies ?? []) {
      checkId('enemy', e.id);
      if (!enemyTypeSet.has(e.type)) err(floorNum, `enemy "${e.id}" has unknown type "${e.type}"`);
      if (!isPoint(e)) err(floorNum, `enemy "${e.id}" needs numeric x/y`);
    }

    // ── Chests ──────────────────────────────────────────────────────────────
    for (const c of floor.chests ?? []) {
      checkId('chest', c.id);
      if (!isPoint(c)) err(floorNum, `chest "${c.id}" needs numeric x/y`);
      if (!Array.isArray(c.items)) {
        err(floorNum, `chest "${c.id}" items must be an array`);
        continue;
      }
      for (const itemId of c.items) {
        if (!isKnownItem(itemId)) err(floorNum, `chest "${c.id}" references unknown item "${itemId}"`);
      }
    }

    // ── Traps ───────────────────────────────────────────────────────────────
    for (const t of floor.traps ?? []) {
      checkId('trap', t.id);
      if (!isPoint(t)) err(floorNum, `trap "${t.id}" needs numeric x/y`);
    }

    // ── Stairs ──────────────────────────────────────────────────────────────
    for (const s of floor.stairs ?? []) {
      checkId('stair', s.id);
      if (!isPoint(s)) err(floorNum, `stair "${s.id}" needs numeric x/y`);
      // A stair must lead somewhere loadable — unless it's a permanent lock
      // (decoration for a not-yet-built floor, e.g. floor 3's stair down).
      if (!s.permanentLock && !floorNums.has(String(s.toFloor))) {
        err(floorNum, `stair "${s.id}" targets missing floor ${s.toFloor} (add the floor or set permanentLock)`);
      }
    }

    // ── Doors / walls / platforms geometry ──────────────────────────────────
    for (const d of floor.doors ?? []) {
      checkId('door', d.id);
      if (!isRect(d)) err(floorNum, `door "${d.id}" must be a rect { x, y, w, h } with positive size`);
    }
    (floor.walls ?? []).forEach((w, i) => {
      if (!isRect(w)) err(floorNum, `walls[${i}] must be a rect { x, y, w, h } with positive size`);
    });
    for (const p of floor.platforms ?? []) {
      checkId('platform', p.id);
      if (!isRect(p)) err(floorNum, `platform "${p.id}" must be a rect { x, y, w, h } with positive size`);
      for (const st of p.steps ?? []) {
        checkId('step', st.id);
        if (!isPoint(st)) err(floorNum, `step "${st.id}" needs numeric x/y`);
      }
    }
  }

  return errors;
}
