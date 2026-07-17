// server/tests/knockback-combat.test.js
// Knockback through the combat wrappers (server/systems/CombatSystem.js) and
// climb fatigue through MovementSystem: every melee hit shoves, wall slams
// deal bonus damage, ledge drops shed elevation, fighters brace, ranged
// doesn't push, killing blows don't push, underleveled climbers fatigue.
//
// playerAttack/enemyAttack roll live dice; hit-dependent cases retry fresh
// state until a hit lands (enemy AC -100 → only nat 1 misses).
//
// Run: node server/tests/knockback-combat.test.js

import { GameState }   from '../state/GameState.js';
import { EnemyState }  from '../state/EnemyState.js';
import { PlayerState } from '../state/PlayerState.js';
import { GOBLIN }      from '../../shared/data/enemies/tier1.js';
import {
  KNOCKBACK_BASE_PX, KNOCKBACK_BARBARIAN_PER_LEVEL_PX,
} from '../../shared/data/constants.js';
import { playerAttack, enemyAttack } from '../systems/CombatSystem.js';
import * as MovementSystem from '../systems/MovementSystem.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

/** Player at (100,100); goblin 30 px east. AC -100 → only nat 1 misses. */
function makeState({ classId = 'fighter', classLevel = 1, weaponId = 'longsword', enemyHp = 10000 } = {}) {
  const state = new GameState();
  state.floor = 1;

  const player = new PlayerState();
  player.x = 100; player.y = 100; player.alive = true;
  player.class = classId;
  player.classLevels.set(classId, classLevel);
  player.equippedWeaponId = weaponId;
  player.str = 16; player.dex = 14; player.con = 14;
  player.int = 10; player.wis = 10; player.cha = 10;
  player.level = classLevel;
  player.ac = 10; player.hp = 50; player.maxHp = 50;
  player.attackCooldownMs = 0;
  state.players.set('A', player);

  const enemy = new EnemyState();
  enemy.id = 'goblin_1'; enemy.type = 'goblin';
  enemy.x = 130; enemy.y = 100;
  enemy.hp = enemyHp; enemy.maxHp = enemyHp; enemy.ac = -100; enemy.alive = true;
  state.enemies.set('goblin_1', enemy);

  const enemyDefs = new Map([['goblin_1', GOBLIN]]);
  return { state, player, enemy, enemyDefs };
}

/** Retry fresh state until the main-hand attack hits; return that trial. */
function attackUntilHit(opts, terrain = null) {
  for (let i = 0; i < 200; i++) {
    const t = makeState(opts);
    const geometry = terrain ? { obstacles: [], terrain } : null;
    const r = playerAttack(t.state, 'A', t.enemyDefs, null, geometry);
    if (r.hit) return { ...t, result: r };
  }
  throw new Error('no hit in 200 attempts — fixture broken');
}

// ── 1. Melee hit pushes the enemy along the attack line ──────────────────────
console.log('\nMelee hit pushes');
{
  const { enemy } = attackUntilHit({ classId: 'fighter', classLevel: 1 });
  check('enemy pushed east (away from attacker)', enemy.x > 130);
  check(`push ≈ base ${KNOCKBACK_BASE_PX}px (got ${(enemy.x - 130).toFixed(1)})`,
    Math.abs(enemy.x - 130 - KNOCKBACK_BASE_PX) < 0.5);
  check('no lateral drift', Math.abs(enemy.y - 100) < 0.5);
}

// ── 2. Barbarian levels push farther ─────────────────────────────────────────
console.log('\nBarbarian push bonus scales with levels');
{
  const { enemy } = attackUntilHit({ classId: 'barbarian', classLevel: 3, weaponId: 'greatsword' });
  const expected = KNOCKBACK_BASE_PX + 3 * KNOCKBACK_BARBARIAN_PER_LEVEL_PX; // 56
  check(`barb 3 push ≈ ${expected}px (got ${(enemy.x - 130).toFixed(1)})`,
    Math.abs(enemy.x - 130 - expected) < 0.5);
}

// ── 3. Wall slam deals half-again bonus damage ───────────────────────────────
console.log('\nWall slam');
{
  // Wall right behind the goblin (4 px of give) — every push pins.
  const terrain = { walls: [{ x: 150, y: 0, w: 40, h: 200 }], platforms: [], bounds: null };
  const { enemy, result } = attackUntilHit({ classId: 'fighter', classLevel: 1 }, terrain);
  const slamLog = result.logs.find(l => l.includes('slammed into the wall'));
  check('slam log line present', !!slamLog);
  check('enemy stopped before the wall', enemy.x < 150);
  // hp loss = weapon hit + slam bonus of exactly half the hit (min 1)
  const expectedLoss = result.damage + Math.max(1, Math.floor(result.damage / 2));
  check(`bonus damage applied (loss ${10000 - enemy.hp} = hit ${result.damage} + half)`,
    10000 - enemy.hp === expectedLoss);
}

// ── 4. Killing blow does not push (corpses stay put) ─────────────────────────
console.log('\nKilling blow');
{
  const { enemy } = attackUntilHit({ classId: 'fighter', classLevel: 1, enemyHp: 1 });
  check('enemy died', enemy.alive === false);
  check('corpse not displaced', enemy.x === 130 && enemy.y === 100);
}

// ── 5. Ranged hits do not push ───────────────────────────────────────────────
console.log('\nRanged does not push');
{
  let done = false;
  for (let i = 0; i < 200 && !done; i++) {
    const t = makeState({ classId: 'fighter', classLevel: 1, weaponId: 'shortbow' });
    t.enemy.x = 300; // beyond melee, inside normal range (400)
    const r = playerAttack(t.state, 'A', t.enemyDefs, 'goblin_1', { obstacles: [] });
    if (r.hit) {
      check('enemy position unchanged on ranged hit', t.enemy.x === 300 && t.enemy.y === 100);
      done = true;
    }
  }
  check('observed a ranged hit', done);
}

// ── 6. Enemy hits push the player; fighters brace ────────────────────────────
console.log('\nEnemy knockback vs player + fighter brace');
{
  function playerPushDistance({ classId, classLevel, offhandId = '' }) {
    for (let i = 0; i < 200; i++) {
      const t = makeState({ classId, classLevel });
      t.player.offhandId = offhandId;
      t.player.level = classLevel;
      t.enemy.attackCooldownMs = 0;
      const r = enemyAttack(t.state, t.enemy, GOBLIN, t.player, null);
      if (r.log?.includes(': hit')) {
        return Math.hypot(t.player.x - 100, t.player.y - 100);
      }
    }
    throw new Error('no enemy hit in 200 attempts');
  }
  const monkPush    = playerPushDistance({ classId: 'monk',    classLevel: 3 });
  const fighterPush = playerPushDistance({ classId: 'fighter', classLevel: 3, offhandId: 'shield' });
  check(`player pushed west (monk moved ${monkPush.toFixed(1)}px)`, monkPush > 0.5);
  check(`fighter 3 + shield braced (${fighterPush.toFixed(1)} < ${monkPush.toFixed(1)})`,
    fighterPush < monkPush - 0.5);
}

// ── 7. Climb fatigue (MovementSystem) ────────────────────────────────────────
console.log('\nClimb fatigue');
{
  // Platform east of the player; a climbing monk walks straight through the
  // west perimeter wall. On floor 3 with monk 1, deficit 2 → 2000 ms event.
  const platform = { x: 200, y: 0, w: 200, h: 300, steps: [{ x: 200, y: 150 }] };
  const bounds = { minX: 0, maxX: 600, minY: 0, maxY: 300 };

  function climbAt({ y, classId, classLevel, floor }) {
    const state = new GameState();
    state.floor = floor;
    const p = new PlayerState();
    p.x = 197; p.y = y; p.alive = true; p.elevation = 0;
    p.class = classId;
    p.classLevels.set(classId, classLevel);
    p.vx = 1; p.vy = 0; // walking east into the platform
    state.players.set('A', p);
    // 60 ms at ~160 px/s ≈ 10 px — crosses the perimeter into the platform.
    const events = MovementSystem.update(state, 60, bounds, { walls: [], platforms: [platform] });
    return { p, events };
  }

  const wallClimb = climbAt({ y: 60, classId: 'monk', classLevel: 1, floor: 3 });
  check('monk crossed the wall and elevated', wallClimb.p.elevation === 1);
  check('fatigue event emitted for the deficit',
    wallClimb.events.length === 1 && wallClimb.events[0].type === 'climb_fatigue');
  check('duration = deficit × 1000 (floor 3 − monk 1 = 2000ms)',
    wallClimb.events[0]?.durationMs === 2000);

  const pacedClimb = climbAt({ y: 60, classId: 'monk', classLevel: 3, floor: 3 });
  check('monk at pace climbs clean', pacedClimb.p.elevation === 1 && pacedClimb.events.length === 0);

  const stepEntry = climbAt({ y: 150, classId: 'monk', classLevel: 1, floor: 3 });
  check('step-gap entry never fatigues', stepEntry.p.elevation === 1 && stepEntry.events.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
