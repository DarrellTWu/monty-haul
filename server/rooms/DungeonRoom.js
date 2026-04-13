// server/rooms/DungeonRoom.js
import { createRequire } from 'module';
const { Room } = createRequire(import.meta.url)('colyseus');

import { GameState } from '../state/GameState.js';
import { PlayerState } from '../state/PlayerState.js';
import { EnemyState } from '../state/EnemyState.js';
import { FIGHTER } from '../../shared/data/classes/fighter.js';
import { GOBLIN } from '../../shared/data/enemies/tier1.js';
import { getModifier } from '../../shared/logic/combat.js';
import { SERVER_TICK_RATE_HZ, MELEE_HIT_RANGE_PX } from '../../shared/data/constants.js';
import * as MovementSystem from '../systems/MovementSystem.js';
import * as AISystem from '../systems/AISystem.js';
import { playerAttack } from '../systems/CombatSystem.js';

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

    // Equip a weapon by id. Client is responsible for only sending valid ids
    // from the player's own inventory — server trusts the id only if it matches
    // a known weapon in CombatSystem's registry.
    this.onMessage('equip', (client, { itemId }) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.equippedWeaponId = String(itemId);
    });

    this.onMessage('unequip', (client, { slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (player && slot === 'weapon') player.equippedWeaponId = '';
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
    player.ac = FIGHTER.baseAC;
    player.level = 1;
    player.alive = true;
    player.equippedWeaponId = 'longsword'; // fighter starts with longsword equipped

    this.state.players.set(client.sessionId, player);
    console.log(`[DungeonRoom] ${client.sessionId} joined — HP ${maxHp} AC ${FIGHTER.baseAC}`);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log('[DungeonRoom] disposed');
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
