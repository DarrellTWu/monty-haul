// scripts/balance-sim.mjs
// Headless Monte Carlo balance harness over shared/logic/combat.js (roadmap
// Sprint G, engine half). No game boot, no Colyseus — pure logic + data.
//
// Usage:
//   node scripts/balance-sim.mjs [--seed 42] [--trials 2000]
//
// For every (class × level 1–3) loadout against every tier-1 enemy at pack
// sizes 1–3, reports: player death %, mean cycles-to-clear (1 cycle = one
// attack event per side ≈ ATTACK_COOLDOWN_MS), both hit rates, and mean HP
// remaining on wins. Deterministic for a given seed.
//
// COMBAT MODEL (approximations, kept in sync with server/systems/CombatSystem.js):
//   - Sides alternate, player first. All living enemies attack each cycle;
//     the player focus-fires one enemy at a time.
//   - Default class gear (startingWeaponId/ArmorId) + the class's starting
//     emblem, so level 3 includes the basic subclass.
//   - Fighter: Dueling (via derived features), Second Wind once below 50% HP,
//     Action Surge = one extra attack round on the first cycle (level 2+),
//     Champion crit 19–20 (level 3).
//   - Barbarian: Rage from cycle 1 (+2 melee dmg, physical resistance);
//     Reckless Attack always on at level 2+ (adv both ways — the aggressive
//     default); Berserker Frenzy extra attack while raging (level 3).
//   - Monk: Martial Arts bonus unarmed strike; Flurry of Blows every cycle
//     while ki lasts (level 2+); Open Hand stagger is NOT modeled (timer
//     manipulation has no seat in the cycle model — flagged in the report).
//   - No movement, kiting, elevation, potions, or out-of-combat regen.

import { resolveAttack, applyDamage, rollDice, getModifier } from '../shared/logic/combat.js';
import {
  applyClassLevel, getDerivedClassFeatures, trySubclassUnlock, getKiMax,
} from '../shared/logic/class-progression.js';
import { recomputeStats } from '../shared/logic/equipment.js';
import { CLASS_REGISTRY } from '../shared/data/classes/index.js';
import { ENEMY_REGISTRY } from '../shared/data/enemies/tier1.js';
import { WEAPON_REGISTRY, UNARMED } from '../shared/data/weapons/index.js';
import { ITEM_REGISTRY } from '../shared/data/items/index.js';
import { RAGE_DAMAGE_BONUS, HP_MULTIPLIER, KI_ABILITY_COST } from '../shared/data/constants.js';

// ── Deterministic RNG (mulberry32) ───────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Loadout construction ─────────────────────────────────────────────────────

/** Build a plain-object player for `classId` at `level` with default gear. */
function buildLoadout(classId, level) {
  const def = CLASS_REGISTRY[classId];
  const p = {
    classLevels: new Map(),
    levelUpHistory: [],
    subclasses: new Map(),
    level: 0,
    hp: 0, maxHp: 0, ac: 10,
    ...def.baseAbilityScores,
    conditions: [],
    inventory: [...(def.startingItemIds ?? [])],
    equippedWeaponId: def.startingWeaponId ?? '',
    equippedArmorId:  def.startingArmorId ?? '',
    offhandId: '',
    secondWindAvailable: false,
    actionSurgeAvailable: false,
    rageUsesRemaining: 0,
    kiPoints: 0, kiMax: 0,
  };
  for (let n = 1; n <= level; n++) applyClassLevel(p, classId);
  // Join-seed HP (max die at level 1); applyClassLevel added the 2+ gains on
  // top of maxHp, so recompute from scratch the way onJoin + level-ups do.
  const conMod = getModifier(p.con);
  let maxHp = def.getStartingHp(conMod);
  for (let n = 2; n <= level; n++) {
    maxHp += Math.floor((def.hitDie / 2 + 1 + conMod) * HP_MULTIPLIER);
  }
  p.maxHp = maxHp;
  p.hp = maxHp;
  trySubclassUnlock(p, classId, p.inventory, ITEM_REGISTRY);
  recomputeStats(p);
  return p;
}

// ── One fight ────────────────────────────────────────────────────────────────

const MAX_CYCLES = 200; // stalemate guard (DR can out-tank low rolls forever)

function playerStrike(p, derived, enemy, enemyDef, weapon, rng, stats, opts = {}) {
  const attacker = {
    abilityScores: { str: p.str, dex: p.dex, con: p.con, int: p.int, wis: p.wis, cha: p.cha },
    level: p.level,
    conditions: [...p.conditions],
    critRange: derived.critRange,
  };
  const sources = [];
  if (p.conditions.includes('reckless')) sources.push({ kind: 'advantage', reason: 'reckless' });
  const target = { ac: enemyDef.ac, hp: enemy.hp, resistances: enemyDef.resistances ?? [], damageReduction: enemyDef.damageReduction ?? null };
  const result = resolveAttack({ attacker, target, weapon, sources, rng });
  stats.playerAttacks++;
  if (result.hit) {
    stats.playerHits++;
    let dmg = result.damage;
    if (opts.stripAbilityMod && !result.crit) dmg = result.damage; // (offhand rule unused — single weapon model)
    const applied = applyDamage({ target, damage: dmg, damageType: weapon.damageType });
    enemy.hp = Math.max(0, enemy.hp - applied.finalDamage);
  }
  return result;
}

/**
 * Simulate one fight of `player-template` vs `packSize` × enemyDef.
 * Returns { win, cycles, hpLeft }.
 */
function simulateFight(classId, level, enemyDef, packSize, rng, stats) {
  const p = buildLoadout(classId, level);
  const derived = getDerivedClassFeatures(p);
  const weaponId = p.equippedWeaponId;
  const baseWeapon = WEAPON_REGISTRY[weaponId] ?? UNARMED;
  const enemies = Array.from({ length: packSize }, () => ({ hp: enemyDef.hp }));

  const isBarb = (p.classLevels.get('barbarian') ?? 0) >= 1;
  const barbLvl = p.classLevels.get('barbarian') ?? 0;
  const monkLvl = p.classLevels.get('monk') ?? 0;
  const isMonkStyle = monkLvl >= 1 && !p.equippedArmorId && !p.offhandId;

  // Rage on from the start; reckless toggle at barb 2+.
  if (isBarb && p.rageUsesRemaining > 0) p.conditions.push('rage');
  if (barbLvl >= 2) p.conditions.push('reckless');

  // Effective weapon: rage bonus (melee), Dueling +2 (fighter one-handed, no
  // offhand weapon — longsword qualifies), versatile 1d10 two-handed grip.
  let weapon = { ...baseWeapon };
  if (weapon.properties?.includes('versatile') && !p.offhandId) {
    weapon = { ...weapon, damageDice: { count: 1, sides: 10 } };
  }
  if (p.conditions.includes('rage')) {
    weapon = { ...weapon, damageBonus: (weapon.damageBonus ?? 0) + RAGE_DAMAGE_BONUS };
  }
  if (derived.fightingStyle === 'dueling' && !weapon.properties?.includes('two-handed') && weapon.id !== 'unarmed') {
    weapon = { ...weapon, damageBonus: (weapon.damageBonus ?? 0) + 2 };
  }

  const maWeapon = { ...UNARMED, properties: ['finesse'] };

  let actionSurgeLeft = p.actionSurgeAvailable ? 1 : 0;
  let secondWindLeft  = p.secondWindAvailable ? 1 : 0;
  let ki = getKiMax(p);

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    // ── Player turn: focus-fire the first living enemy ──────────────────────
    const attackRound = () => {
      const target = enemies.find(e => e.hp > 0);
      if (!target) return;
      playerStrike(p, derived, target, enemyDef, weapon, rng, stats);
      // Berserker Frenzy: extra weapon attack while raging.
      if (derived.frenzy && p.conditions.includes('rage')) {
        const t2 = enemies.find(e => e.hp > 0);
        if (t2) playerStrike(p, derived, t2, enemyDef, weapon, rng, stats);
      }
      // Martial Arts bonus unarmed strike.
      if (isMonkStyle) {
        const t3 = enemies.find(e => e.hp > 0);
        if (t3) playerStrike(p, derived, t3, enemyDef, maWeapon, rng, stats);
      }
      // Flurry of Blows: two more unarmed strikes while ki lasts (monk 2+).
      if (monkLvl >= 2 && isMonkStyle && ki >= KI_ABILITY_COST) {
        ki -= KI_ABILITY_COST;
        for (let s = 0; s < 2; s++) {
          const t4 = enemies.find(e => e.hp > 0);
          if (t4) playerStrike(p, derived, t4, enemyDef, maWeapon, rng, stats);
        }
      }
    };

    attackRound();
    if (actionSurgeLeft > 0) { actionSurgeLeft--; attackRound(); }

    if (!enemies.some(e => e.hp > 0)) {
      return { win: true, cycles: cycle, hpLeft: p.hp };
    }

    // ── Enemy turn: every living enemy attacks ──────────────────────────────
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const sources = [];
      if (p.conditions.includes('reckless')) sources.push({ kind: 'advantage', reason: 'reckless target' });
      const resistances = p.conditions.includes('rage') ? ['bludgeoning', 'piercing', 'slashing'] : [];
      const result = resolveAttack({
        attacker: { attackBonus: enemyDef.attackBonus, damageDice: enemyDef.damageDice, damageBonus: enemyDef.damageBonus, conditions: [] },
        target: { ac: p.ac, hp: p.hp, resistances, damageReduction: null },
        weapon: null,
        sources,
        rng,
      });
      stats.enemyAttacks++;
      if (result.hit) {
        stats.enemyHits++;
        const applied = applyDamage({ target: { ac: p.ac, hp: p.hp, resistances, damageReduction: null }, damage: result.damage, damageType: enemyDef.damageType });
        p.hp = Math.max(0, p.hp - applied.finalDamage);
        if (p.hp <= 0) return { win: false, cycles: cycle, hpLeft: 0 };
      }
    }

    // Second Wind below 50% (fighter): 1d10 + fighter level.
    if (secondWindLeft > 0 && p.hp < p.maxHp / 2) {
      secondWindLeft--;
      p.hp = Math.min(p.maxHp, p.hp + rollDice(1, 10, rng) + (p.classLevels.get('fighter') ?? 1));
    }
  }
  // Stalemate (e.g. unarmed chip vs skeleton DR) counts as a loss-by-attrition.
  return { win: false, cycles: MAX_CYCLES, hpLeft: p.hp };
}

// ── Matchup runner ───────────────────────────────────────────────────────────

export function runMatchup(classId, level, enemyId, packSize, { seed = 42, trials = 2000 } = {}) {
  const enemyDef = ENEMY_REGISTRY[enemyId];
  const rng = mulberry32(seed ^ (packSize * 7919) ^ hashStr(`${classId}${level}${enemyId}`));
  const stats = { playerAttacks: 0, playerHits: 0, enemyAttacks: 0, enemyHits: 0 };
  let wins = 0, cyclesSum = 0, hpLeftSum = 0;
  for (let t = 0; t < trials; t++) {
    const r = simulateFight(classId, level, enemyDef, packSize, rng, stats);
    if (r.win) { wins++; cyclesSum += r.cycles; hpLeftSum += r.hpLeft; }
  }
  return {
    deathPct:   100 * (1 - wins / trials),
    meanCycles: wins > 0 ? cyclesSum / wins : NaN,
    meanHpLeft: wins > 0 ? hpLeftSum / wins : NaN,
    playerHitPct: 100 * stats.playerHits / Math.max(1, stats.playerAttacks),
    enemyHitPct:  100 * stats.enemyHits / Math.max(1, stats.enemyAttacks),
  };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const flag = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 ? Number(args[i + 1]) : dflt;
  };
  const seed   = flag('seed', 42);
  const trials = flag('trials', 2000);

  console.log(`Balance sim — seed ${seed}, ${trials} trials per matchup`);
  console.log('1 cycle = one attack event per side (~3s). Death% = player died before clearing the pack.');
  console.log('Model notes: rage+reckless always on (barb 2+), flurry while ki lasts, focus fire, no movement/kiting.\n');

  const num = (v, w = 5) => (Number.isNaN(v) ? '—'.padStart(w) : v.toFixed(1).padStart(w));

  for (const enemyId of Object.keys(ENEMY_REGISTRY)) {
    const e = ENEMY_REGISTRY[enemyId];
    console.log(`── vs ${e.name} (HP ${e.hp}, AC ${e.ac}, +${e.attackBonus} atk, ${e.damageDice.count}d${e.damageDice.sides}+${e.damageBonus} ${e.damageType}${e.damageReduction ? `, DR ${e.damageReduction.value}/${e.damageReduction.bypass}` : ''}) ${'─'.repeat(20)}`);
    console.log('  loadout          pack  death%  cycles  hp-left  p-hit%  e-hit%');
    for (const classId of Object.keys(CLASS_REGISTRY)) {
      for (let level = 1; level <= 3; level++) {
        for (const packSize of [1, 2, 3]) {
          const r = runMatchup(classId, level, enemyId, packSize, { seed, trials });
          const label = `${classId} ${level}`.padEnd(15);
          console.log(`  ${label}  ×${packSize}   ${num(r.deathPct, 6)}  ${num(r.meanCycles, 6)}  ${num(r.meanHpLeft, 7)}  ${num(r.playerHitPct, 6)}  ${num(r.enemyHitPct, 6)}`);
        }
      }
      console.log('');
    }
  }
}

// Run as CLI when invoked directly (not imported).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main();
}
