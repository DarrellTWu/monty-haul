// server/tests/target-selection.test.js
// Exercises explicit-target validation in playerAttack (server/systems/CombatSystem.js).
// Builds real PlayerState/EnemyState/GameState instances and calls playerAttack directly.
//
// Run: node server/tests/target-selection.test.js

import { GameState }   from '../state/GameState.js';
import { EnemyState }  from '../state/EnemyState.js';
import { PlayerState } from '../state/PlayerState.js';
import { GOBLIN }      from '../../shared/data/enemies/tier1.js';
import { MELEE_HIT_RANGE_PX, ATTACK_COOLDOWN_MS } from '../../shared/data/constants.js';
import { playerAttack } from '../systems/CombatSystem.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

function makeState() {
  const state = new GameState();

  const player = new PlayerState();
  player.x = 100; player.y = 100; player.alive = true;
  player.class = 'fighter';
  player.equippedWeaponId = 'longsword';
  player.str = 14; player.dex = 12; player.con = 14;
  player.int = 10; player.wis = 10; player.cha = 10;
  player.level = 1;
  player.ac = 10;
  player.hp = 20; player.maxHp = 20;
  player.attackCooldownMs = 0;
  state.players.set('A', player);

  // Near enemy: well within MELEE_HIT_RANGE_PX (64)
  const near = new EnemyState();
  near.id = 'goblin_near'; near.type = 'goblin';
  near.x = 130; near.y = 100; // 30 px away
  near.hp = 100; near.maxHp = 100; near.ac = 10; near.alive = true;
  state.enemies.set('goblin_near', near);

  // Also-in-range enemy, but farther than `near` (50 px away). Used to verify
  // explicit target overrides nearest-enemy.
  const alsoNear = new EnemyState();
  alsoNear.id = 'goblin_alsonear'; alsoNear.type = 'goblin';
  alsoNear.x = 150; alsoNear.y = 100;
  alsoNear.hp = 100; alsoNear.maxHp = 100; alsoNear.ac = 10; alsoNear.alive = true;
  state.enemies.set('goblin_alsonear', alsoNear);

  // Out-of-range enemy: 200 px away, > MELEE_HIT_RANGE_PX
  const far = new EnemyState();
  far.id = 'goblin_far'; far.type = 'goblin';
  far.x = 300; far.y = 100;
  far.hp = 100; far.maxHp = 100; far.ac = 10; far.alive = true;
  state.enemies.set('goblin_far', far);

  const enemyDefs = new Map([
    ['goblin_near', GOBLIN],
    ['goblin_alsonear', GOBLIN],
    ['goblin_far', GOBLIN],
  ]);

  return { state, player, near, alsoNear, far, enemyDefs };
}

// ── 1. No targetId → nearest-enemy fallback (regression) ─────────────────────
console.log('\nNo targetId → nearest-enemy fallback');
{
  const { state, player, near, alsoNear, enemyDefs } = makeState();
  const nearHpBefore = near.hp;
  const alsoNearHpBefore = alsoNear.hp;
  // High AC overrides won't matter — even a miss returns targetId of attempted enemy.
  const result = playerAttack(state, 'A', enemyDefs);
  check('result.targetId === nearest (goblin_near)', result.targetId === 'goblin_near');
  check('cooldown consumed', player.attackCooldownMs === ATTACK_COOLDOWN_MS);
  // Far enemy untouched regardless of hit/miss outcome.
  check('non-target HP unchanged', alsoNear.hp === alsoNearHpBefore);
  // near may or may not have taken damage depending on dice; just confirm targetId.
  void nearHpBefore;
}

// ── 2. Explicit targetId selects non-nearest enemy ───────────────────────────
console.log('\nExplicit targetId selects non-nearest');
{
  const { state, player, near, alsoNear, enemyDefs } = makeState();
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_alsonear');
  check('result.targetId === goblin_alsonear', result.targetId === 'goblin_alsonear');
  check('cooldown consumed', player.attackCooldownMs === ATTACK_COOLDOWN_MS);
  check('no denial reason on valid attack', !result.denied);
  void near;
}

// ── 3. Out-of-range target → denied + no cooldown ────────────────────────────
console.log('\nOut-of-range target → denied');
{
  const { state, player, far, enemyDefs } = makeState();
  const farHpBefore = far.hp;
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_far');
  check("denied === 'out_of_range'", result.denied === 'out_of_range');
  check('cooldown NOT consumed', player.attackCooldownMs === 0);
  check('target HP unchanged', far.hp === farHpBefore);
  check('result.logs is empty', Array.isArray(result.logs) && result.logs.length === 0);
}

// ── 4. Dead target → invalid_target + no cooldown ────────────────────────────
console.log('\nDead target → invalid_target');
{
  const { state, player, near, enemyDefs } = makeState();
  near.alive = false;
  near.hp = 0;
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_near');
  check("denied === 'invalid_target'", result.denied === 'invalid_target');
  check('cooldown NOT consumed', player.attackCooldownMs === 0);
}

// ── 5. Nonexistent target id → invalid_target ────────────────────────────────
console.log('\nNonexistent id → invalid_target');
{
  const { state, player, enemyDefs } = makeState();
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_ghost');
  check("denied === 'invalid_target'", result.denied === 'invalid_target');
  check('cooldown NOT consumed', player.attackCooldownMs === 0);
}

// ── 6. Cooldown gate still blocks explicit-target attack ─────────────────────
console.log('\nCooldown gate blocks explicit-target attack');
{
  const { state, player, near, enemyDefs } = makeState();
  player.attackCooldownMs = 500;
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_near');
  check('no targetId returned (early-out)', result.targetId === null);
  check('no denial flag (cooldown is silent gate)', !result.denied);
  check('cooldown not reset', player.attackCooldownMs === 500);
  void near;
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
