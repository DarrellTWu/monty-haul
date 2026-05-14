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
    this.rageRemainingMs          = 0; // synced for HUD ring display
    this.rageUsesRemaining        = 0; // remaining rage activations this run
    this.gold                     = 0; // run-scope wallet; transferred to hub on extract, lost on death
    // Ability scores — set at join from player's point-buy choices, mutable during run
    // (potions, ASIs, racial bonuses, conditions). _recomputeStats(player) must be called
    // after any change so derived values (AC, etc.) stay in sync.
    this.str = 10;
    this.dex = 10;
    this.con = 10;
    this.int = 10;
    this.wis = 10;
    this.cha = 10;
    this.inventory  = new ArraySchema(); // unequipped item ids
    this.conditions = new ArraySchema(); // active condition ids (e.g. 'bless')
    this.hotbar     = new ArraySchema(); // 10 slots: ability/consumable id or ''
    // Geometry elevation: 0 = ground, 1 = elevated (on a platform). Schema is
    // a number to allow future multi-level stacking; only 0/1 used this sprint.
    this.elevation  = 0;
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
  rageRemainingMs:          'number',
  rageUsesRemaining:        'number',
  gold:                     'number',
  str:                      'number',
  dex:                      'number',
  con:                      'number',
  int:                      'number',
  wis:                      'number',
  cha:                      'number',
  inventory:  { array: 'string' },
  conditions: { array: 'string' },
  hotbar:     { array: 'string' },
  elevation:  'number',
});
