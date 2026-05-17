// server/tests/ranged-combat.test.js
// Exercises the ranged-weapon path in playerAttack: no-target denial, range
// gates, LoS, source assembly (long-range + foe-adjacent disadvantage,
// high-ground advantage, cancellation), and projectile_fired emission.
//
// Run: node server/tests/ranged-combat.test.js

import { GameState }   from '../state/GameState.js';
import { EnemyState }  from '../state/EnemyState.js';
import { PlayerState } from '../state/PlayerState.js';
import { GOBLIN }      from '../../shared/data/enemies/tier1.js';
import { ATTACK_COOLDOWN_MS, ft } from '../../shared/data/constants.js';
import { playerAttack } from '../systems/CombatSystem.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

function makeState({ withFoeAdjacent = false } = {}) {
  const state = new GameState();

  const player = new PlayerState();
  player.x = 100; player.y = 100; player.alive = true;
  player.class = 'fighter';
  player.equippedWeaponId = 'shortbow';
  player.str = 12; player.dex = 16; player.con = 14;
  player.int = 10; player.wis = 10; player.cha = 10;
  player.level = 1;
  player.ac = 10;
  player.hp = 20; player.maxHp = 20;
  player.attackCooldownMs = 0;
  state.players.set('A', player);

  // Target enemy at 300 px (within shortbow normal range = ft(80) = 400)
  const target = new EnemyState();
  target.id = 'goblin_target'; target.type = 'goblin';
  target.x = 400; target.y = 100; // 300 px away
  target.hp = 100; target.maxHp = 100; target.ac = 10; target.alive = true;
  state.enemies.set('goblin_target', target);

  // Optional adjacent enemy for foe-adjacent disadvantage test
  if (withFoeAdjacent) {
    const adj = new EnemyState();
    adj.id = 'goblin_adj'; adj.type = 'goblin';
    adj.x = 130; adj.y = 100; // 30 px from player
    adj.hp = 100; adj.maxHp = 100; adj.ac = 10; adj.alive = true;
    state.enemies.set('goblin_adj', adj);
  }

  const enemyDefs = new Map([
    ['goblin_target', GOBLIN],
    ['goblin_adj',    GOBLIN],
  ]);

  return { state, player, target, enemyDefs };
}

// ── 1. Bow in range, LoS clear → resolves, cooldown consumed ─────────────────
console.log('\nBow in range, LoS clear → resolves');
{
  const { state, player, enemyDefs } = makeState();
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_target', { obstacles: [] });
  check('targetId returned', result.targetId === 'goblin_target');
  check('no denial', !result.denied);
  check('cooldown consumed', player.attackCooldownMs === ATTACK_COOLDOWN_MS);
  check('projectile event populated', result.projectile && result.projectile.style === 'arrow');
  check('projectile attackerId matches', result.projectile.attackerId === 'A');
}

// ── 2. Bow with no targetId → denied 'no_target', no cooldown ────────────────
console.log("\nBow with no targetId → denied 'no_target'");
{
  const { state, player, enemyDefs } = makeState();
  const result = playerAttack(state, 'A', enemyDefs, null, { obstacles: [] });
  check("denied === 'no_target'", result.denied === 'no_target');
  check('cooldown NOT consumed', player.attackCooldownMs === 0);
  check('no projectile emitted', !result.projectile);
}

// ── 3. Bow with target beyond long range → denied 'out_of_range' ─────────────
console.log("\nBow beyond long range → denied 'out_of_range'");
{
  const { state, player, target, enemyDefs } = makeState();
  // Push target to 2000 px (shortbow long = ft(320) = 1600)
  target.x = 2100; target.y = 100;
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_target', { obstacles: [] });
  check("denied === 'out_of_range'", result.denied === 'out_of_range');
  check('cooldown NOT consumed', player.attackCooldownMs === 0);
}

// ── 4. Bow with wall blocking LoS → denied 'no_line_of_sight' ────────────────
console.log("\nBow with wall blocking → denied 'no_line_of_sight'");
{
  const { state, player, enemyDefs } = makeState();
  // Wall sits between player (100,100) and target (400,100). Segment runs y=100.
  const obstacles = [{ x: 200, y: 50, w: 50, h: 100 }];
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_target', { obstacles });
  check("denied === 'no_line_of_sight'", result.denied === 'no_line_of_sight');
  check('cooldown NOT consumed', player.attackCooldownMs === 0);
}

// ── 5. Bow in long-range band → applies long-range disadvantage ──────────────
console.log('\nBow in long-range band → long-range disadvantage');
{
  const { state, target, enemyDefs } = makeState();
  // Move target to 500 px (> ft(80)=400 normal, ≤ ft(320)=1600 long)
  target.x = 600; target.y = 100;
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_target', { obstacles: [] });
  check('attack resolved', !result.denied);
  // logs[0] should contain the dis label with "long range" reason
  const log = result.logs[0] ?? '';
  check("log contains '[dis:'", log.includes('[dis:'));
  check("log contains 'long range' reason", log.includes('long range'));
}

// ── 6. Bow + adjacent foe → applies foe-adjacent disadvantage ────────────────
console.log('\nBow with adjacent foe → foe-adjacent disadvantage');
{
  const { state, enemyDefs } = makeState({ withFoeAdjacent: true });
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_target', { obstacles: [] });
  check('attack resolved', !result.denied);
  const log = result.logs[0] ?? '';
  check("log contains '[dis:'", log.includes('[dis:'));
  check("log contains 'foe adjacent' reason", log.includes('foe adjacent'));
}

// ── 7. High-ground advantage + long-range disadvantage → cancel to normal ────
console.log('\nAdvantage + disadvantage cancels to normal');
{
  const { state, player, target, enemyDefs } = makeState();
  player.elevation = 1;
  target.elevation = 0;
  target.x = 600; target.y = 100; // long-range band
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_target', { obstacles: [] });
  check('attack resolved', !result.denied);
  const log = result.logs[0] ?? '';
  // With cancellation, the log should NOT carry [adv:] or [dis:] labels.
  check("log has no '[adv:' label",  !log.includes('[adv:'));
  check("log has no '[dis:' label",  !log.includes('[dis:'));
}

// ── 8. Melee regression: longsword path still works after sources migration ──
console.log('\nMelee regression: longsword still attacks');
{
  const { state, player, target, enemyDefs } = makeState();
  player.equippedWeaponId = 'longsword';
  target.x = 130; target.y = 100; // 30 px away — melee range
  const result = playerAttack(state, 'A', enemyDefs, 'goblin_target');
  check('no denial', !result.denied);
  check('targetId returned', result.targetId === 'goblin_target');
  check('cooldown consumed', player.attackCooldownMs === ATTACK_COOLDOWN_MS);
  check('no projectile (melee)', !result.projectile);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
