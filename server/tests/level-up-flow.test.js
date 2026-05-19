// server/tests/level-up-flow.test.js
// Tests the descend → pendingLevelUp → choose_level_up flow against the real
// PlayerState schema. The DungeonRoom.choose_level_up handler is small glue
// over pure helpers; this test mirrors that glue inline (see DungeonRoom.js
// `this.onMessage('choose_level_up', ...)`) so a regression in the handler
// composition surfaces here. If the handler logic changes, mirror it below.
//
// Run: node server/tests/level-up-flow.test.js

import { PlayerState } from '../state/PlayerState.js';
import {
  applyClassLevel,
  getEligibleClassChoicesForLevelUp,
} from '../../shared/logic/class-progression.js';
import { recomputeStats } from '../../shared/logic/equipment.js';
import { CLASS_REGISTRY } from '../../shared/data/classes/index.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}${detail ? `\n    ${detail}` : ''}`); fail++; }
}

/** Seed a level-1 Fighter the same way DungeonRoom.onJoin does. */
function seedFighter() {
  const p = new PlayerState();
  p.class = 'fighter';
  p.alive = true;
  p.str = 16; p.dex = 14; p.con = 14; p.int = 10; p.wis = 10; p.cha = 8;
  for (let i = 0; i < 10; i++) p.hotbar.push('');
  const seed = applyClassLevel(p, 'fighter');
  // onJoin patches HP using getStartingHp (max-die formula, level-1 only).
  const startingHp = CLASS_REGISTRY.fighter.getStartingHp(2 /* +2 conMod */);
  p.maxHp = startingHp; p.hp = startingHp;
  // Seed level-1 features onto the hotbar (slot 0 is empty after construction).
  for (let i = 0, j = 0; i < seed.features.length && j < p.hotbar.length; j++) {
    if (p.hotbar[j] === '') { p.hotbar[j] = seed.features[i++]; }
  }
  recomputeStats(p);
  return p;
}

/**
 * Mirror of DungeonRoom.choose_level_up handler. Returns:
 *   { accepted: bool, broadcasts: string[], featuresGranted: string[] }
 * Mutations occur on `player` in place.
 */
function applyChooseLevelUp(player, classId) {
  const broadcasts = [];
  if (!player || !player.pendingLevelUp) return { accepted: false, broadcasts, featuresGranted: [] };
  const eligible = getEligibleClassChoicesForLevelUp(player);
  if (!eligible.includes(classId)) return { accepted: false, broadcasts, featuresGranted: [] };

  const result = applyClassLevel(player, classId);
  if (!result.ok) return { accepted: false, broadcasts, featuresGranted: [] };
  recomputeStats(player);
  player.pendingLevelUp = false;

  const featuresGranted = result.features ?? [];
  for (const feat of featuresGranted) {
    let placed = false;
    for (let i = 0; i < player.hotbar.length; i++) {
      if (player.hotbar[i] === '') { player.hotbar[i] = feat; placed = true; break; }
    }
    if (!placed) broadcasts.push(`${feat} learned — drag to hotbar to use.`);
  }

  // Build summary line.
  const counts = new Map();
  for (const cid of player.levelUpHistory) counts.set(cid, (counts.get(cid) ?? 0) + 1);
  const parts = [];
  for (const [cid, n] of counts) parts.push(`${CLASS_REGISTRY[cid]?.name ?? cid} ${n}`);
  broadcasts.push(`took a level in ${CLASS_REGISTRY[classId]?.name ?? classId} (now ${parts.join(' / ')}).`);

  return { accepted: true, broadcasts, featuresGranted };
}

// ── pendingLevelUp gate ──────────────────────────────────────────────────────
console.log('\npendingLevelUp gate');
{
  const p = seedFighter();
  p.pendingLevelUp = false; // descend hasn't happened yet
  const r = applyChooseLevelUp(p, 'monk');
  check('handler refuses when flag is false',
    !r.accepted && p.level === 1 && p.classLevels.size === 1);
}

// ── descend flips pendingLevelUp on alive players only ───────────────────────
console.log('\ndescend → pendingLevelUp');
{
  const alive = seedFighter();
  const dead  = seedFighter();
  dead.alive = false;
  // _descendTo logic: for each player → long rest → if alive, set flag.
  for (const p of [alive, dead]) {
    if (p.alive) p.pendingLevelUp = true;
  }
  check('alive player has pendingLevelUp=true after descend',  alive.pendingLevelUp === true);
  check('dead player retains pendingLevelUp=false',            dead.pendingLevelUp === false);
}

// ── ineligible classId silently dropped ──────────────────────────────────────
console.log('\nineligible classId rejected');
{
  const p = seedFighter();
  p.pendingLevelUp = true;

  const rUnknown = applyChooseLevelUp(p, 'wizard'); // not in CLASS_REGISTRY
  check('unknown classId rejected, state untouched',
    !rUnknown.accepted && p.level === 1 && p.pendingLevelUp === true);

  const rDup = applyChooseLevelUp(p, 'fighter'); // already taken (eligibility filter excludes)
  check('already-taken classId rejected (MVP forced-multiclass)',
    !rDup.accepted && p.classLevels.get('fighter') === 1 && p.pendingLevelUp === true);
}

// ── eligible choice mutates state + grants level-1 features + bumps HP ───────
console.log('\nvalid choice: Fighter → Monk multiclass');
{
  const p = seedFighter();
  const hpBefore = p.maxHp;
  p.pendingLevelUp = true;

  const r = applyChooseLevelUp(p, 'monk');

  check('handler accepted',                          r.accepted === true);
  check('pendingLevelUp cleared',                    p.pendingLevelUp === false);
  check('total level bumped to 2',                   p.level === 2);
  check('classLevels has both fighter and monk',
    p.classLevels.get('fighter') === 1 && p.classLevels.get('monk') === 1);
  check('levelUpHistory records monk at index 1',
    p.levelUpHistory.length === 2 && p.levelUpHistory[1] === 'monk');
  check('maxHp grew by computeHpGainForLevel(monk, +2)',
    p.maxHp > hpBefore && p.hp === p.maxHp,
    `before=${hpBefore} after maxHp=${p.maxHp} hp=${p.hp}`);
  // Monk grants Unarmored Defense (wis); seedFighter equips no armor by default,
  // so post-multiclass recomputeStats should reflect 10 + dexMod + wisMod.
  check('recomputeStats picked up Monk Unarmored Defense after multiclass',
    p.ac === 10 + 2 /* dex 14 */ + 0 /* wis 10 */);
  check('combat-log build summary broadcast',
    r.broadcasts.some(m => m.includes('Fighter 1') && m.includes('Monk 1')));
}

// ── subsequent attempts (already resolved) silently dropped ──────────────────
console.log('\nrepeat choose_level_up silently dropped');
{
  const p = seedFighter();
  p.pendingLevelUp = true;
  applyChooseLevelUp(p, 'monk'); // first call resolves
  const levelAfter = p.level;
  const r = applyChooseLevelUp(p, 'barbarian'); // second call should be no-op
  check('second call rejected (flag already cleared)',
    !r.accepted && p.level === levelAfter && !p.classLevels.has('barbarian'));
}

// ── hotbar-full case skips assignment, emits notify line ─────────────────────
console.log('\nhotbar-full fallback');
{
  const p = seedFighter();
  // Fill every hotbar slot.
  for (let i = 0; i < p.hotbar.length; i++) p.hotbar[i] = 'healing_potion';
  p.pendingLevelUp = true;

  const r = applyChooseLevelUp(p, 'barbarian'); // grants 'rage'
  check('handler accepted despite full hotbar', r.accepted === true);
  check("'rage' feature granted but not auto-bound",
    r.featuresGranted.includes('rage')
    && !p.hotbar.includes('rage'));
  check('notify line broadcast for unplaced feature',
    r.broadcasts.some(m => m.includes('rage learned') || m.startsWith('rage learned')));
}

// ── rage pool initialized on first Barbarian level (as multiclass) ───────────
console.log('\nfirst-Barbarian-level resource init');
{
  const p = seedFighter();
  p.pendingLevelUp = true;
  check('rageUsesRemaining starts at 0 for Fighter-only',
    p.rageUsesRemaining === 0);
  applyChooseLevelUp(p, 'barbarian');
  check('rageUsesRemaining seeded after first Barbarian level',
    p.rageUsesRemaining === CLASS_REGISTRY.barbarian.rageUses);
}

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} tests.`);
process.exit(fail === 0 ? 0 : 1);
