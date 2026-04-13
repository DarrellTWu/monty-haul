// server/rooms/DungeonRoom.js
import { createRequire } from 'module';
const { Room } = createRequire(import.meta.url)('colyseus');

import { GameState } from '../state/GameState.js';
import { PlayerState } from '../state/PlayerState.js';
import { EnemyState } from '../state/EnemyState.js';
import { ChestState } from '../state/ChestState.js';
import { FIGHTER } from '../../shared/data/classes/fighter.js';
import { GOBLIN } from '../../shared/data/enemies/tier1.js';
import { getModifier } from '../../shared/logic/combat.js';
import { ARMOR_REGISTRY, computeAC } from '../../shared/data/armor/armor.js';
import { LONGSWORD, SHORTSWORD, HANDAXE, GREATAXE, DAGGER } from '../../shared/data/weapons/melee.js';
import { SHIELD_REGISTRY } from '../../shared/data/items/shields.js';
import { SERVER_TICK_RATE_HZ, MELEE_HIT_RANGE_PX, CHEST_LOOT_RANGE_PX } from '../../shared/data/constants.js';
import * as MovementSystem from '../systems/MovementSystem.js';
import * as AISystem from '../systems/AISystem.js';
import { playerAttack } from '../systems/CombatSystem.js';

// All equippable items the server recognises, split by slot type.
const WEAPON_REGISTRY = {
  longsword: LONGSWORD, shortsword: SHORTSWORD,
  handaxe: HANDAXE, greataxe: GREATAXE, dagger: DAGGER,
};

const ROOM_WIDTH = 1600;
const ROOM_HEIGHT = 1200;
const WALL = 40;
const BOUNDS = { minX: WALL, maxX: ROOM_WIDTH - WALL, minY: WALL, maxY: ROOM_HEIGHT - WALL };

const FIGHTER_SPAWN = { x: 800, y: 600 };
const GOBLIN_SPAWNS = [
  { x: 300, y: 300 },
  { x: 1300, y: 900 },
];

export class DungeonRoom extends Room {
  onCreate(options) {
    this.setState(new GameState());
    this._enemyDefs = new Map();
    this._spawnGoblins();
    this._spawnChest();

    this.onMessage('move', (client, { dx, dy }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) { player.vx = 0; player.vy = 0; }
      else { player.vx = dx / len; player.vy = dy / len; }
    });

    this.onMessage('stop', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) { player.vx = 0; player.vy = 0; }
    });

    this.onMessage('attack', (client) => {
      playerAttack(this.state, client.sessionId);
    });

    // Equip an item from the player's inventory into the appropriate slot.
    // Server validates: item must be in inventory, SRD constraints must hold.
    // Two-handed weapons auto-unequip the shield (player made a deliberate choice).
    this.onMessage('equip', (client, { itemId }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const id = String(itemId);
      const idx = player.inventory.indexOf(id);
      if (idx === -1) return; // must be in inventory

      if (SHIELD_REGISTRY[id]) {
        // ── Shield slot ───────────────────────────────────────────────────────
        const currentWeapon = WEAPON_REGISTRY[player.equippedWeaponId];
        if (currentWeapon?.properties?.includes('two-handed')) return; // blocked by SRD
        if (player.equippedShieldId) player.inventory.push(player.equippedShieldId);
        player.inventory.splice(idx, 1);
        player.equippedShieldId = id;
      } else if (WEAPON_REGISTRY[id]) {
        // ── Weapon slot ───────────────────────────────────────────────────────
        const newWeapon = WEAPON_REGISTRY[id];
        if (newWeapon.properties?.includes('two-handed') && player.equippedShieldId) {
          // Two-handed weapon chosen — auto-unequip shield so the player can proceed.
          player.inventory.push(player.equippedShieldId);
          player.equippedShieldId = '';
        }
        if (player.equippedWeaponId) player.inventory.push(player.equippedWeaponId);
        player.inventory.splice(player.inventory.indexOf(id), 1);
        player.equippedWeaponId = id;
      }
      this._recomputeAC(player);
    });

    this.onMessage('unequip', (client, { slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (slot === 'weapon' && player.equippedWeaponId) {
        player.inventory.push(player.equippedWeaponId);
        player.equippedWeaponId = '';
      } else if (slot === 'shield' && player.equippedShieldId) {
        player.inventory.push(player.equippedShieldId);
        player.equippedShieldId = '';
        this._recomputeAC(player);
      }
    });

    // Loot a chest — moves all items to the player's inventory.
    // Server validates range and that the chest hasn't already been looted.
    this.onMessage('loot', (client, { chestId }) => {
      const player = this.state.players.get(client.sessionId);
      const chest = this.state.chests.get(String(chestId));
      if (!player || !chest || chest.open) return;
      const dx = player.x - chest.x;
      const dy = player.y - chest.y;
      if (Math.sqrt(dx * dx + dy * dy) > CHEST_LOOT_RANGE_PX) return;
      for (const item of chest.items) player.inventory.push(item);
      chest.items.splice(0, chest.items.length);
      chest.open = true;
      console.log(`[DungeonRoom] ${client.sessionId} looted chest ${chestId}`);
    });

    this.setSimulationInterval(
      (dt) => this._tick(dt),
      1000 / SERVER_TICK_RATE_HZ.tier1,
    );
  }

  onJoin(client) {
    const conMod = getModifier(FIGHTER.baseAbilityScores.con);
    const maxHp = FIGHTER.getStartingHp(conMod);

    const player = new PlayerState();
    player.x = FIGHTER_SPAWN.x;
    player.y = FIGHTER_SPAWN.y;
    player.hp = maxHp;
    player.maxHp = maxHp;
    const startingArmor = ARMOR_REGISTRY[FIGHTER.startingArmorId];
    const dexMod = getModifier(FIGHTER.baseAbilityScores.dex);
    const ac = computeAC(startingArmor, dexMod, false);

    player.ac = ac;
    player.level = 1;
    player.alive = true;
    player.equippedWeaponId = 'longsword'; // fighter starts with longsword equipped
    player.equippedArmorId = FIGHTER.startingArmorId;
    // inventory starts empty — loot the nearby chest for shield, dagger, greataxe

    this.state.players.set(client.sessionId, player);
    console.log(`[DungeonRoom] ${client.sessionId} joined — HP ${maxHp} AC ${ac}`);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log('[DungeonRoom] disposed');
  }

  _spawnChest() {
    const chest = new ChestState();
    chest.id = 'chest_0';
    chest.x = 880;  // just right of fighter spawn (800, 600)
    chest.y = 600;
    chest.open = false;
    chest.items.push('shield', 'dagger', 'greataxe');
    this.state.chests.set('chest_0', chest);
    console.log('[DungeonRoom] Spawned chest with shield, dagger, greataxe');
  }

  _spawnGoblins() {
    GOBLIN_SPAWNS.forEach((pos, i) => {
      const id = `goblin_${i}`;
      const enemy = new EnemyState();
      enemy.id = id;
      enemy.type = 'goblin';
      enemy.x = pos.x;
      enemy.y = pos.y;
      enemy.hp = GOBLIN.hp;
      enemy.maxHp = GOBLIN.hp;
      enemy.ac = GOBLIN.ac;
      enemy.alive = true;
      enemy.aiState = 'idle';
      this.state.enemies.set(id, enemy);
      this._enemyDefs.set(id, GOBLIN);
    });
    console.log('[DungeonRoom] Spawned 2 goblins');
  }

  /** Recompute player.ac from current armor + shield. Call after any equip/unequip. */
  _recomputeAC(player) {
    const armorDef = ARMOR_REGISTRY[player.equippedArmorId];
    const dexMod = getModifier(FIGHTER.baseAbilityScores.dex);
    player.ac = computeAC(armorDef, dexMod, !!player.equippedShieldId);
  }

  _tick(dt) {
    MovementSystem.update(this.state, dt, BOUNDS);
    AISystem.update(this.state, dt, this._enemyDefs, MELEE_HIT_RANGE_PX);

    const allDead = [...this.state.enemies.values()].every(e => !e.alive);
    if (allDead && this.state.phase === 'playing') {
      this.state.phase = 'complete';
      console.log('[DungeonRoom] All enemies defeated');
    }
  }
}
