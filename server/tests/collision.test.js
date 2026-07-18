// server/tests/collision.test.js
// Entity body blocking through MovementSystem.update: characters can't walk
// through each other, corpses don't block, cross-elevation pairs don't
// collide, separation respects walls, and spawn pile-ups unstack.
//
// Run: node server/tests/collision.test.js

import { GameState }   from '../state/GameState.js';
import { EnemyState }  from '../state/EnemyState.js';
import { PlayerState } from '../state/PlayerState.js';
import { GOBLIN }      from '../../shared/data/enemies/tier1.js';
import { ENTITY_RADIUS_PX } from '../../shared/data/constants.js';
import * as MovementSystem from '../systems/MovementSystem.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

const MIN_SEP = 2 * ENTITY_RADIUS_PX; // 32
const BOUNDS  = { minX: 0, maxX: 800, minY: 0, maxY: 600 };

function mkPlayer({ x, y, alive = true, elevation = 0, classId = 'fighter' } = {}) {
  const p = new PlayerState();
  p.x = x; p.y = y; p.alive = alive; p.elevation = elevation;
  p.class = classId;
  p.classLevels.set(classId, 1);
  return p;
}

function mkEnemy({ x, y, alive = true, elevation = 0 } = {}) {
  const e = new EnemyState();
  e.id = 'g'; e.type = 'goblin';
  e.x = x; e.y = y; e.alive = alive; e.elevation = elevation;
  e.hp = 10; e.maxHp = 10; e.ac = 15;
  return e;
}

function run(state, { geometry = { walls: [], platforms: [] }, ticks = 1, dt = 50 } = {}) {
  const enemyDefs = new Map([...state.enemies.keys()].map(k => [k, GOBLIN]));
  for (let i = 0; i < ticks; i++) {
    MovementSystem.update(state, dt, BOUNDS, geometry, enemyDefs);
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ── 1. A player cannot walk through an enemy ─────────────────────────────────
console.log('\nPlayer cannot pass through an enemy');
{
  const state = new GameState();
  const p = mkPlayer({ x: 100, y: 100 });
  p.vx = 1; p.vy = 0; // walking east, straight at the goblin
  state.players.set('A', p);
  const e = mkEnemy({ x: 150, y: 100 });
  state.enemies.set('g1', e);
  run(state, { ticks: 40 }); // 2 s of walking into it
  check('player stopped at body-block range', dist(p, e) >= MIN_SEP - 0.5);
  check('player never passed the enemy', p.x < e.x);
}

// ── 2. Overlapping stationary entities separate ──────────────────────────────
console.log('\nOverlap resolves even with no movement input');
{
  const state = new GameState();
  const p = mkPlayer({ x: 100, y: 100 });
  state.players.set('A', p);
  const e = mkEnemy({ x: 110, y: 100 });
  state.enemies.set('g1', e);
  run(state, { ticks: 5 });
  check('pushed apart to min separation', dist(p, e) >= MIN_SEP - 0.5);
}

// ── 3. Spawn pile-up unstacks (players on the same point) ────────────────────
console.log('\nStacked players unstack');
{
  const state = new GameState();
  const a = mkPlayer({ x: 300, y: 300 });
  const b = mkPlayer({ x: 300, y: 300 });
  state.players.set('A', a);
  state.players.set('B', b);
  run(state, { ticks: 3 });
  check('players separated', dist(a, b) >= MIN_SEP - 0.5);
}

// ── 4. Corpses do not block ──────────────────────────────────────────────────
console.log('\nCorpses are walkable');
{
  const state = new GameState();
  const p = mkPlayer({ x: 100, y: 100 });
  p.vx = 1; p.vy = 0;
  state.players.set('A', p);
  const corpse = mkEnemy({ x: 150, y: 100, alive: false });
  state.enemies.set('g1', corpse);
  run(state, { ticks: 20 });
  check('player walked through the corpse', p.x > corpse.x + MIN_SEP);
}

// ── 5. Cross-elevation pairs do not collide ──────────────────────────────────
console.log('\nDifferent elevations pass freely');
{
  const state = new GameState();
  const ground = mkPlayer({ x: 100, y: 100, elevation: 0 });
  const high   = mkPlayer({ x: 110, y: 100, elevation: 1 });
  state.players.set('A', ground);
  state.players.set('B', high);
  run(state, { ticks: 5 });
  check('no separation across elevations', dist(ground, high) < MIN_SEP);
}

// ── 6. Separation never pushes through a wall ────────────────────────────────
console.log('\nSeparation respects walls');
{
  // Wall directly east of B; A overlaps B from the west. B's push-out points
  // into the wall — wall re-resolution must keep B outside it.
  const wall = { x: 180, y: 0, w: 40, h: 600 };
  const state = new GameState();
  const a = mkPlayer({ x: 140, y: 100 });
  const b = mkPlayer({ x: 156, y: 100 }); // 16 px apart — overlapping
  state.players.set('A', a);
  state.players.set('B', b);
  run(state, { geometry: { walls: [wall], platforms: [] }, ticks: 5 });
  check('B kept out of the wall', b.x <= wall.x - ENTITY_RADIUS_PX + 0.01);
  check('pair still separated (within wall constraint)', dist(a, b) >= MIN_SEP - 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
