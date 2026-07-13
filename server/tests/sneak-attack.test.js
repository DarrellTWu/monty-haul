// server/tests/sneak-attack.test.js
// Exercises the Sneak Attack path in playerAttack (server/systems/CombatSystem.js):
// eligibility legs (advantage / ally adjacent / skirmish both-moving), the
// once-per-Attack-event rule across main + offhand, and the weapon gate.
// Builds real PlayerState/EnemyState/GameState instances and calls playerAttack.
//
// playerAttack rolls live dice, so positive cases retry fresh state until a hit
// lands and assert on the combat-log sneak tag; negative cases run N trials and
// assert the tag never appears.
//
// Run: node server/tests/sneak-attack.test.js

import { GameState }   from '../state/GameState.js';
import { EnemyState }  from '../state/EnemyState.js';
import { PlayerState } from '../state/PlayerState.js';
import { GOBLIN }      from '../../shared/data/enemies/tier1.js';
import { playerAttack } from '../systems/CombatSystem.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

/**
 * Fresh state: one player at (100,100), one goblin 30 px away (melee range).
 * AC -100 → every attack roll hits except a natural 1, so hit-dependent
 * assertions converge in a try-loop. Enemy HP 10000 so it never dies mid-test.
 */
function makeState({
  classId = 'rogue', rogueLevel = 1, weaponId = 'shortsword', offhandId = '',
  skirmisher = false, playerMoving = false, targetMoving = false,
  allyAdjacent = false, elevated = false, enemyX = 130,
} = {}) {
  const state = new GameState();

  const player = new PlayerState();
  player.x = 100; player.y = 100; player.alive = true;
  player.class = classId;
  player.classLevels.set(classId, classId === 'rogue' ? rogueLevel : 1);
  if (skirmisher) player.subclasses.set('rogue', 'skirmisher');
  player.equippedWeaponId = weaponId;
  player.offhandId = offhandId;
  player.str = 10; player.dex = 16; player.con = 14;
  player.int = 10; player.wis = 10; player.cha = 10;
  player.level = classId === 'rogue' ? rogueLevel : 1;
  player.ac = 10; player.hp = 20; player.maxHp = 20;
  player.attackCooldownMs = 0;
  if (playerMoving) { player.vx = 1; player.vy = 0; }
  if (elevated) player.elevation = 1;
  state.players.set('A', player);

  const enemy = new EnemyState();
  enemy.id = 'goblin_1'; enemy.type = 'goblin';
  enemy.x = enemyX; enemy.y = 100;
  enemy.hp = 10000; enemy.maxHp = 10000; enemy.ac = -100; enemy.alive = true;
  if (targetMoving) { enemy.vx = 50; enemy.vy = 0; }
  state.enemies.set('goblin_1', enemy);

  if (allyAdjacent) {
    const ally = new PlayerState();
    ally.x = enemy.x + 20; ally.y = 100; ally.alive = true;
    ally.class = 'fighter';
    ally.classLevels.set('fighter', 1);
    state.players.set('B', ally);
  }

  const enemyDefs = new Map([['goblin_1', GOBLIN]]);
  return { state, player, enemy, enemyDefs };
}

/** Retry with fresh state until the main-hand attack hits; return the logs. */
function attackUntilHit(opts, targetId = null) {
  for (let i = 0; i < 200; i++) {
    const { state, enemyDefs } = makeState(opts);
    const r = playerAttack(state, 'A', enemyDefs, targetId);
    if (r.hit) return r.logs;
  }
  throw new Error('no hit in 200 attempts — fixture broken');
}

/** Run N fresh attacks; true if any log line ever carries a sneak tag. */
function anySneakInTrials(opts, n = 60, targetId = null) {
  for (let i = 0; i < n; i++) {
    const { state, enemyDefs } = makeState(opts);
    const r = playerAttack(state, 'A', enemyDefs, targetId);
    if (r.logs.some(l => l.includes('(sneak +'))) return true;
  }
  return false;
}

// ── 1. Skirmish: both moving → sneak tag ─────────────────────────────────────
console.log('\nSkirmish — both moving');
{
  const logs = attackUntilHit({ skirmisher: true, rogueLevel: 3, playerMoving: true, targetMoving: true });
  check('hit log carries sneak tag', logs.some(l => l.includes('(sneak +')));
  check("reason is 'skirmish'", logs.some(l => l.includes('— skirmish)')));
}

// ── 2. Skirmish requires BOTH entities moving ────────────────────────────────
console.log('\nSkirmish — one side stationary → no sneak');
{
  check('attacker moving, target still → never sneaks',
    !anySneakInTrials({ skirmisher: true, rogueLevel: 3, playerMoving: true, targetMoving: false }));
  check('target moving, attacker still → never sneaks',
    !anySneakInTrials({ skirmisher: true, rogueLevel: 3, playerMoving: false, targetMoving: true }));
}

// ── 3. Both moving without the subclass → no sneak ───────────────────────────
console.log('\nBoth moving, no Skirmisher subclass');
{
  check('base rogue never sneaks off movement alone',
    !anySneakInTrials({ skirmisher: false, rogueLevel: 3, playerMoving: true, targetMoving: true }));
}

// ── 4. Ally adjacent → sneak on a normal roll ────────────────────────────────
console.log('\nAlly adjacent to target');
{
  const logs = attackUntilHit({ allyAdjacent: true });
  check('hit log carries sneak tag', logs.some(l => l.includes('(sneak +')));
  check("reason is 'ally adjacent'", logs.some(l => l.includes('— ally adjacent)')));
}

// ── 5. Advantage (high ground) → sneak for a base rogue ──────────────────────
console.log('\nAdvantage via high ground');
{
  const logs = attackUntilHit({ elevated: true });
  check('hit log carries sneak tag', logs.some(l => l.includes('(sneak +')));
  check("reason is 'advantage'", logs.some(l => l.includes('— advantage)')));
}

// ── 6. Weapon gate: non-finesse melee weapon never sneaks ────────────────────
console.log('\nWeapon gate — longsword');
{
  check('rogue with longsword + advantage never sneaks',
    !anySneakInTrials({ weaponId: 'longsword', elevated: true }));
}

// ── 7. Class gate: no rogue levels → no sneak ────────────────────────────────
console.log('\nClass gate — fighter');
{
  check('fighter with finesse weapon + advantage never sneaks',
    !anySneakInTrials({ classId: 'fighter', elevated: true }));
}

// ── 8. Once per Attack event across main + offhand ───────────────────────────
console.log('\nOnce per Attack event (main + offhand dagger)');
{
  let checked = false;
  for (let i = 0; i < 500 && !checked; i++) {
    const { state, enemyDefs } = makeState({ allyAdjacent: true, offhandId: 'dagger', rogueLevel: 3 });
    const r = playerAttack(state, 'A', enemyDefs);
    const hitLines   = r.logs.filter(l => l.includes(': hit'));
    const sneakLines = r.logs.filter(l => l.includes('(sneak +'));
    if (hitLines.length === 2) {
      check('exactly one sneak tag when both hands hit', sneakLines.length === 1);
      checked = true;
    } else if (sneakLines.length > 1) {
      check('never more than one sneak tag per event', false);
      checked = true;
    }
  }
  check('observed a both-hands-hit event within 500 trials', checked);
}

// ── 9. Offhand fishing: main misses, offhand hit still sneaks ─────────────────
console.log('\nOffhand fishing (main misses, offhand carries the sneak)');
{
  let observed = false;
  for (let i = 0; i < 2000 && !observed; i++) {
    const { state, enemyDefs } = makeState({ allyAdjacent: true, offhandId: 'dagger' });
    const r = playerAttack(state, 'A', enemyDefs);
    const mainMissed = r.logs.some(l => !l.includes('[off]') && l.includes(': miss'));
    const offSneak   = r.logs.some(l => l.includes('[off]') && l.includes('(sneak +'));
    if (mainMissed && offSneak) observed = true;
  }
  check('main-hand nat-1 miss → offhand hit carries sneak', observed);
}

// ── 10. Ranged skirmish (shortbow, kiting) ────────────────────────────────────
console.log('\nRanged skirmish — shortbow at normal range, both moving');
{
  // 300 px < shortbow normal range (400 px) → no long-range disadvantage.
  const logs = attackUntilHit(
    { skirmisher: true, rogueLevel: 3, weaponId: 'shortbow', playerMoving: true, targetMoving: true, enemyX: 400 },
    'goblin_1',
  );
  check('ranged hit log carries sneak tag', logs.some(l => l.includes('(sneak +')));
  check("reason is 'skirmish'", logs.some(l => l.includes('— skirmish)')));
}

// ── 11. Long-range disadvantage blocks skirmish sneak ─────────────────────────
console.log('\nLong-range disadvantage blocks skirmish');
{
  // 500 px > shortbow normal range (400 px) but < long (1600 px) → disadvantage.
  check('disadvantaged ranged attack never sneaks',
    !anySneakInTrials(
      { skirmisher: true, rogueLevel: 3, weaponId: 'shortbow', playerMoving: true, targetMoving: true, enemyX: 600 },
      60,
      'goblin_1',
    ));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
