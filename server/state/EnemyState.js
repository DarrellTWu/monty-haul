// server/state/EnemyState.js
import { createRequire } from 'module';
const { Schema, defineTypes } = createRequire(import.meta.url)('@colyseus/schema');

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
});
