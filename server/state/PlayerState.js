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
    this.class = '';             // class id (e.g. 'fighter')
    this.equippedWeaponId = '';  // weapon slot; '' = unarmed
    this.equippedArmorId = '';   // armor slot; '' = unarmored
    this.offhandId = '';         // offhand slot: weapon or shield; '' = empty
    this.secondWindAvailable = true;
    this.blessRemainingMs         = 0; // synced each tick for client HUD ring display
    this.longstriderRemainingMs   = 0; // synced each tick for client HUD ring display
    this.falseLifeRemainingMs     = 0; // synced each tick for client HUD ring display
    this.tempHp                   = 0; // temporary HP (absorbed before regular HP)
    this.inventory  = new ArraySchema(); // unequipped item ids
    this.conditions = new ArraySchema(); // active condition ids (e.g. 'bless')
    this.hotbar     = new ArraySchema(); // 10 slots: ability/consumable id or ''
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
  class: 'string',
  equippedWeaponId: 'string',
  equippedArmorId: 'string',
  offhandId: 'string',
  secondWindAvailable:      'boolean',
  blessRemainingMs:         'number',
  longstriderRemainingMs:   'number',
  falseLifeRemainingMs:     'number',
  tempHp:                   'number',
  inventory:  { array: 'string' },
  conditions: { array: 'string' },
  hotbar:     { array: 'string' },
});
