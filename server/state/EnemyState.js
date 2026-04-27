// server/state/EnemyState.js
import { createRequire } from 'module';
const { Schema, ArraySchema, defineTypes } = createRequire(import.meta.url)('@colyseus/schema');

export class EnemyState extends Schema {
  constructor() {
    super();
    this.id = '';
    this.type = '';
    this.x = 0;
    this.y = 0;
    this.hp = 0;
    this.maxHp = 0;
    this.ac = 0;
    this.alive = true;
    this.attackCooldownMs = 0;
    this.aiState = 'idle';
    this.vx = 0;
    this.vy = 0;
    this.lootGold  = 0;                  // populated on death from LOOT_TABLE_REGISTRY
    this.lootItems = new ArraySchema();  // item ids available to loot from corpse
    this.looted    = false;              // flips true after a player loots the corpse
    this.lockedBy  = '';                 // sessionId of the player currently looting; '' = free
  }
}

defineTypes(EnemyState, {
  id: 'string',
  type: 'string',
  x: 'number',
  y: 'number',
  hp: 'number',
  maxHp: 'number',
  ac: 'number',
  alive: 'boolean',
  attackCooldownMs: 'number',
  aiState: 'string',
  vx: 'number',
  vy: 'number',
  lootGold:  'number',
  lootItems: { array: 'string' },
  looted:    'boolean',
  lockedBy:  'string',
});
