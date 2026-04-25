// server/rooms/DungeonRoom.js
import { createRequire } from 'module';
const { Room } = createRequire(import.meta.url)('colyseus');

import { GameState }  from '../state/GameState.js';
import { PlayerState } from '../state/PlayerState.js';
import { EnemyState }  from '../state/EnemyState.js';
import { ChestState }  from '../state/ChestState.js';
import { TrapState }   from '../state/TrapState.js';

import { FIGHTER }                   from '../../shared/data/classes/fighter.js';
import { GOBLIN, DOG, SKELETON }     from '../../shared/data/enemies/tier1.js';
import { getModifier, resolveSave, rollDice } from '../../shared/logic/combat.js';
import { ARMOR_REGISTRY, computeAC } from '../../shared/data/armor/armor.js';
import { LONGSWORD, SHORTSWORD, HANDAXE, GREATAXE, DAGGER, MACE } from '../../shared/data/weapons/melee.js';
import { SHIELD_REGISTRY }           from '../../shared/data/items/shields.js';
import { CONSUMABLE_REGISTRY }       from '../../shared/data/items/consumables.js';
import {
  SERVER_TICK_RATE_HZ, MELEE_HIT_RANGE_PX, CHEST_LOOT_RANGE_PX,
  TRAP_DAMAGE, TRAP_SAVE_DC, TRAP_RADIUS_PX, TRAP_COOLDOWN_MS,
} from '../../shared/data/constants.js';

import * as MovementSystem from '../systems/MovementSystem.js';
import * as AISystem       from '../systems/AISystem.js';
import { playerAttack, enemyAttack, applySecondWind } from '../systems/CombatSystem.js';

const WEAPON_REGISTRY = {
  longsword: LONGSWORD, shortsword: SHORTSWORD,
  handaxe: HANDAXE, greataxe: GREATAXE, dagger: DAGGER, mace: MACE,
};

const ROOM_WIDTH  = 1600;
const ROOM_HEIGHT = 1200;
const WALL        = 40;
const BOUNDS = { minX: WALL, maxX: ROOM_WIDTH - WALL, minY: WALL, maxY: ROOM_HEIGHT - WALL };

const FIGHTER_SPAWN  = { x: 800, y: 600 };
const CHEST_SPAWN    = { x: 880, y: 600 };
const TRAP_SPAWN     = { x: 1380, y: 160 };

// Four corners, each enemy type gets a separate corner.
const GOBLIN_SPAWNS   = [{ x: 300, y: 300 }, { x: 1300, y: 900 }];
const DOG_SPAWN       = { x: 1300, y: 300 };
const SKELETON_SPAWN  = { x: 300, y: 900 };

export class DungeonRoom extends Room {
  onCreate(options) {
    this.setState(new GameState());
    this._enemyDefs       = new Map();
    this._conditionTimers = new Map(); // `${sessionId}_${condition}` → remainingMs

    this._spawnGoblins();
    this._spawnDog();
    this._spawnSkeleton();
    this._spawnChest();
    this._spawnTrap();

    // ── Movement ──────────────────────────────────────────────────────────────────
    this.onMessage('move', (client, { dx, dy }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) { player.vx = 0; player.vy = 0; }
      else           { player.vx = dx / len; player.vy = dy / len; }
    });

    this.onMessage('stop', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) { player.vx = 0; player.vy = 0; }
    });

    // ── Combat ────────────────────────────────────────────────────────────────────
    this.onMessage('attack', (client) => {
      const result = playerAttack(this.state, client.sessionId, this._enemyDefs);
      for (const msg of result.logs) this.broadcast('combat_log', { message: msg });
    });

    // ── Equip / unequip ───────────────────────────────────────────────────────────
    // 'equip' message: { itemId, slot? }
    //   slot = 'weapon' | 'offhand' | 'armor' | undefined (auto-detect)
    // Server validates: item in inventory, SRD constraints respected.
    this.onMessage('equip', (client, { itemId, slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const id  = String(itemId);
      const idx = player.inventory.indexOf(id);
      if (idx === -1) return; // item must be in bag

      const isShield = !!SHIELD_REGISTRY[id];
      const isWeapon = !!WEAPON_REGISTRY[id];
      const isArmor  = !!ARMOR_REGISTRY[id];

      // Auto-detect target slot if not specified.
      const targetSlot = slot || (isArmor ? 'armor' : isShield ? 'offhand' : 'weapon');

      if (targetSlot === 'armor') {
        if (!isArmor) return;
        // Return old armor to bag first.
        if (player.equippedArmorId) player.inventory.push(player.equippedArmorId);
        player.inventory.splice(player.inventory.indexOf(id), 1);
        player.equippedArmorId = id;
        this._recomputeAC(player);

      } else if (targetSlot === 'offhand') {
        // Offhand accepts one-handed weapons OR shields. Blocks two-handed.
        if (isWeapon && WEAPON_REGISTRY[id]?.properties?.includes('two-handed')) return;
        if (player.offhandId) player.inventory.push(player.offhandId);
        player.inventory.splice(player.inventory.indexOf(id), 1);
        player.offhandId = id;
        this._recomputeAC(player);

      } else { // weapon slot
        if (isShield || isArmor) return;
        const newWeapon = WEAPON_REGISTRY[id];
        if (!newWeapon) return;
        // Two-handed weapon: auto-unequip offhand (player chose to go two-handed).
        if (newWeapon.properties?.includes('two-handed') && player.offhandId) {
          player.inventory.push(player.offhandId);
          player.offhandId = '';
        }
        if (player.equippedWeaponId) player.inventory.push(player.equippedWeaponId);
        player.inventory.splice(player.inventory.indexOf(id), 1);
        player.equippedWeaponId = id;
        this._recomputeAC(player);
      }
    });

    this.onMessage('unequip', (client, { slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (slot === 'weapon' && player.equippedWeaponId) {
        player.inventory.push(player.equippedWeaponId);
        player.equippedWeaponId = '';
      } else if (slot === 'offhand' && player.offhandId) {
        player.inventory.push(player.offhandId);
        player.offhandId = '';
        this._recomputeAC(player);
      } else if (slot === 'armor' && player.equippedArmorId) {
        player.inventory.push(player.equippedArmorId);
        player.equippedArmorId = '';
        this._recomputeAC(player); // unarmored: AC = 10 + DEX
      }
    });

    // ── Chest looting ─────────────────────────────────────────────────────────────
    this.onMessage('loot', (client, { chestId }) => {
      const player = this.state.players.get(client.sessionId);
      const chest  = this.state.chests.get(String(chestId));
      if (!player || !chest || chest.open) return;
      const dx = player.x - chest.x;
      const dy = player.y - chest.y;
      if (Math.sqrt(dx * dx + dy * dy) > CHEST_LOOT_RANGE_PX) return;
      for (const item of chest.items) player.inventory.push(item);
      chest.items.splice(0, chest.items.length);
      chest.open = true;
      console.log(`[DungeonRoom] ${client.sessionId} looted chest ${chestId}`);
    });

    // ── Hotbar management ─────────────────────────────────────────────────────────
    this.onMessage('assign_hotbar', (client, { itemId, slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const s  = Math.max(0, Math.min(9, Math.floor(Number(slot))));
      const id = String(itemId);
      if (id === 'second_wind' || CONSUMABLE_REGISTRY[id]) {
        player.hotbar[s] = id;
      }
    });

    this.onMessage('use_hotbar', (client, { slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      const s       = Math.max(0, Math.min(9, Math.floor(Number(slot))));
      const binding = player.hotbar[s] ?? '';
      if (!binding) return;

      if (binding === 'second_wind') {
        const heal = applySecondWind(this.state, client.sessionId);
        if (heal !== null) {
          this.broadcast('combat_log', { message: `Second Wind: Fighter recovers ${heal} HP` });
        }
      } else if (CONSUMABLE_REGISTRY[binding]) {
        this._useConsumable(player, client.sessionId, binding);
      }
    });

    this.setSimulationInterval(
      (dt) => this._tick(dt),
      1000 / SERVER_TICK_RATE_HZ.tier1,
    );
  }

  onJoin(client) {
    const conMod        = getModifier(FIGHTER.baseAbilityScores.con);
    const maxHp         = FIGHTER.getStartingHp(conMod);
    const startingArmor = ARMOR_REGISTRY[FIGHTER.startingArmorId];
    const dexMod        = getModifier(FIGHTER.baseAbilityScores.dex);
    const ac            = computeAC(startingArmor, dexMod, false);

    const player = new PlayerState();
    player.x    = FIGHTER_SPAWN.x;
    player.y    = FIGHTER_SPAWN.y;
    player.hp   = maxHp;
    player.maxHp = maxHp;
    player.ac   = ac;
    player.level = 1;
    player.alive = true;
    player.equippedWeaponId = 'longsword';
    player.equippedArmorId  = FIGHTER.startingArmorId;
    player.hotbar.push('second_wind');
    for (let i = 1; i < 10; i++) player.hotbar.push('');

    this.state.players.set(client.sessionId, player);
    console.log(`[DungeonRoom] ${client.sessionId} joined — HP ${maxHp} AC ${ac}`);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log('[DungeonRoom] disposed');
  }

  // ── Spawn helpers ─────────────────────────────────────────────────────────────

  _spawnChest() {
    const chest = new ChestState();
    chest.id   = 'chest_0';
    chest.x    = CHEST_SPAWN.x;
    chest.y    = CHEST_SPAWN.y;
    chest.open = false;
    chest.items.push(
      'shield', 'dagger', 'greataxe', 'mace',
      'half_plate',
      'healing_potion', 'bless_potion', 'longstrider_potion', 'false_life_potion',
    );
    this.state.chests.set('chest_0', chest);
    console.log('[DungeonRoom] Spawned chest');
  }

  _spawnGoblins() {
    GOBLIN_SPAWNS.forEach((pos, i) => {
      this._spawnEnemy(`goblin_${i}`, GOBLIN, pos);
    });
  }

  _spawnDog() {
    this._spawnEnemy('dog_0', DOG, DOG_SPAWN);
  }

  _spawnSkeleton() {
    this._spawnEnemy('skeleton_0', SKELETON, SKELETON_SPAWN);
  }

  _spawnEnemy(id, def, pos) {
    const enemy = new EnemyState();
    enemy.id      = id;
    enemy.type    = def.id;
    enemy.x       = pos.x;
    enemy.y       = pos.y;
    enemy.hp      = def.hp;
    enemy.maxHp   = def.hp;
    enemy.ac      = def.ac;
    enemy.alive   = true;
    enemy.aiState = 'idle';
    this.state.enemies.set(id, enemy);
    this._enemyDefs.set(id, def);
    console.log(`[DungeonRoom] Spawned ${def.type} (${id}) at (${pos.x}, ${pos.y})`);
  }

  _spawnTrap() {
    const trap = new TrapState();
    trap.id    = 'trap_0';
    trap.x     = TRAP_SPAWN.x;
    trap.y     = TRAP_SPAWN.y;
    trap.cooldownMs = 0;
    this.state.traps.set('trap_0', trap);
    console.log(`[DungeonRoom] Spawned spike trap at (${TRAP_SPAWN.x}, ${TRAP_SPAWN.y})`);
  }

  // ── Per-tick logic ────────────────────────────────────────────────────────────

  _tick(dt) {
    MovementSystem.update(this.state, dt, BOUNDS);

    const aiLogs = AISystem.update(this.state, dt, this._enemyDefs, MELEE_HIT_RANGE_PX);
    for (const msg of aiLogs) this.broadcast('combat_log', { message: msg });

    for (const [sessionId, player] of this.state.players) {
      if (player.alive) this._checkTraps(player, sessionId);
    }

    this._tickTraps(dt);
    this._tickConditions(dt);

    const allDead = [...this.state.enemies.values()].every(e => !e.alive);
    if (allDead && this.state.phase === 'playing') {
      this.state.phase = 'complete';
      console.log('[DungeonRoom] All enemies defeated');
    }
  }

  _checkTraps(player, sessionId) {
    for (const [, trap] of this.state.traps) {
      if (trap.cooldownMs > 0) continue;
      const dx = player.x - trap.x;
      const dy = player.y - trap.y;
      if (Math.sqrt(dx * dx + dy * dy) > TRAP_RADIUS_PX) continue;

      const creature = {
        abilityScores: FIGHTER.baseAbilityScores,
        level:         player.level,
        saveProfs:     FIGHTER.saveProficiencies,
      };
      const save        = resolveSave({ creature, ability: 'dex', dc: TRAP_SAVE_DC });
      let trapDamage = Math.max(1, save.success ? Math.floor(TRAP_DAMAGE / 2) : TRAP_DAMAGE);
      // Temp HP absorbs trap damage before regular HP (SRD rule).
      if (player.tempHp > 0) {
        const absorbed = Math.min(player.tempHp, trapDamage);
        player.tempHp -= absorbed;
        trapDamage    -= absorbed;
      }
      player.hp = Math.max(0, player.hp - trapDamage);
      if (player.hp <= 0) { player.hp = 0; player.alive = false; }
      trap.cooldownMs = TRAP_COOLDOWN_MS;

      const outcome = save.success
        ? `saved (${save.total} vs DC ${TRAP_SAVE_DC}) — ${trapDamage} dmg (half)`
        : `failed (${save.total} vs DC ${TRAP_SAVE_DC}) — ${trapDamage} dmg`;
      this.broadcast('combat_log', { message: `⚠ Spike Trap  DEX save: ${outcome}, piercing` });
    }
  }

  _tickTraps(dt) {
    for (const [, trap] of this.state.traps) {
      if (trap.cooldownMs > 0) trap.cooldownMs = Math.max(0, trap.cooldownMs - dt);
    }
  }

  _tickConditions(dt) {
    for (const [sessionId, player] of this.state.players) {
      for (const condition of [...player.conditions]) {
        const key       = `${sessionId}_${condition}`;
        const remaining = (this._conditionTimers.get(key) ?? 0) - dt;
        if (remaining <= 0) {
          this._conditionTimers.delete(key);
          const idx = player.conditions.indexOf(condition);
          if (idx !== -1) player.conditions.splice(idx, 1);
          if (condition === 'bless')       player.blessRemainingMs = 0;
          if (condition === 'longstrider') player.longstriderRemainingMs = 0;
          if (condition === 'false_life')  { player.falseLifeRemainingMs = 0; player.tempHp = 0; }
        } else {
          this._conditionTimers.set(key, remaining);
          if (condition === 'bless')       player.blessRemainingMs = remaining;
          if (condition === 'longstrider') player.longstriderRemainingMs = remaining;
          if (condition === 'false_life')  player.falseLifeRemainingMs = remaining;
        }
      }
    }
  }

  // ── Item / ability helpers ────────────────────────────────────────────────────

  _useConsumable(player, sessionId, consumableId) {
    const idx = player.inventory.indexOf(consumableId);
    if (idx === -1) return;
    const c = CONSUMABLE_REGISTRY[consumableId];

    if (c.type === 'healing') {
      const heal = rollDice(c.damageDice.count, c.damageDice.sides) + c.diceBonus;
      player.hp  = Math.min(player.maxHp, player.hp + heal);
      this.broadcast('combat_log', { message: `${c.label}: Fighter recovers ${heal} HP` });
    } else if (c.type === 'bless') {
      if (!player.conditions.includes('bless')) {
        player.conditions.push('bless');
        player.blessRemainingMs = c.conditionDurationMs;
        this._conditionTimers.set(`${sessionId}_bless`, c.conditionDurationMs);
        this.broadcast('combat_log', {
          message: `${c.label}: Fighter gains Bless (+1d4 to attacks, ${c.conditionDurationMs / 1000}s)`,
        });
      }
    } else if (c.type === 'longstrider') {
      if (!player.conditions.includes('longstrider')) {
        player.conditions.push('longstrider');
      }
      player.longstriderRemainingMs = c.conditionDurationMs;
      this._conditionTimers.set(`${sessionId}_longstrider`, c.conditionDurationMs);
      this.broadcast('combat_log', {
        message: `${c.label}: Fighter's speed +${c.speedBonusFt}ft (${c.conditionDurationMs / 1000}s)`,
      });
    } else if (c.type === 'false_life') {
      const tempHp = rollDice(c.damageDice.count, c.damageDice.sides) + c.diceBonus;
      player.tempHp = tempHp;
      if (!player.conditions.includes('false_life')) {
        player.conditions.push('false_life');
      }
      player.falseLifeRemainingMs = c.conditionDurationMs;
      this._conditionTimers.set(`${sessionId}_false_life`, c.conditionDurationMs);
      this.broadcast('combat_log', {
        message: `${c.label}: Fighter gains ${tempHp} temp HP (${c.conditionDurationMs / 1000}s)`,
      });
    }

    player.inventory.splice(idx, 1);
    // Clear from hotbar after consumption so slot visually empties.
    for (let i = 0; i < player.hotbar.length; i++) {
      if (player.hotbar[i] === consumableId) { player.hotbar[i] = ''; break; }
    }
  }

  /** Recompute player.ac from armor + offhand (shield gives +2, weapon does not). */
  _recomputeAC(player) {
    const armorDef  = ARMOR_REGISTRY[player.equippedArmorId] ?? null; // null = unarmored
    const dexMod    = getModifier(FIGHTER.baseAbilityScores.dex);
    const hasShield = !!SHIELD_REGISTRY[player.offhandId];
    player.ac = computeAC(armorDef, dexMod, hasShield);
  }
}
