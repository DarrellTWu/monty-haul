// server/state/PlayerState.js
import { createRequire } from 'module';
const { Schema, ArraySchema, defineTypes } = createRequire(import.meta.url)('@colyseus/schema');

export class PlayerState extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.hp = 0;
    this.maxHp = 0;
    this.ac = 0;
    this.level = 1;
    this.vx = 0;
    this.vy = 0;
    this.attackCooldownMs = 0;
    this.alive = true;
    this.equippedWeaponId = ''; // weapon id string; '' = unarmed
    this.equippedArmorId = '';  // armor id string; '' = unarmored
    this.equippedShieldId = ''; // shield id string; '' = no shield
    this.inventory = new ArraySchema(); // unequipped item ids
  }
}

defineTypes(PlayerState, {
  x: 'number',
  y: 'number',
  hp: 'number',
  maxHp: 'number',
  ac: 'number',
  level: 'number',
  vx: 'number',
  vy: 'number',
  attackCooldownMs: 'number',
  alive: 'boolean',
  equippedWeaponId: 'string',
  equippedArmorId: 'string',
  equippedShieldId: 'string',
  inventory: { array: 'string' },
});
