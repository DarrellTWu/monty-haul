// server/state/GameState.js
import { createRequire } from 'module';
const { Schema, MapSchema, defineTypes } = createRequire(import.meta.url)('@colyseus/schema');
import { PlayerState } from './PlayerState.js';
import { EnemyState } from './EnemyState.js';
import { ChestState } from './ChestState.js';
import { TrapState } from './TrapState.js';
import { StairState } from './StairState.js';

export class GameState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.enemies = new MapSchema();
    this.chests = new MapSchema();
    this.traps = new MapSchema();
    this.stairs = new MapSchema();
    this.phase = 'playing';
    this.floor = 1; // current floor number; populated by DungeonRoom._loadFloor
  }
}

defineTypes(GameState, {
  players: { map: PlayerState },
  enemies: { map: EnemyState },
  chests: { map: ChestState },
  traps: { map: TrapState },
  stairs: { map: StairState },
  phase: 'string',
  floor: 'number',
});
