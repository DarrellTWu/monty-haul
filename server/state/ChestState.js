// server/state/ChestState.js
import { createRequire } from 'module';
const { Schema, ArraySchema, defineTypes } = createRequire(import.meta.url)('@colyseus/schema');

export class ChestState extends Schema {
  constructor() {
    super();
    this.id = '';
    this.x = 0;
    this.y = 0;
    this.open = false;
    this.items = new ArraySchema(); // item ids available to loot
    this.lockedBy = '';             // sessionId of the player currently looting; '' = free
  }
}

defineTypes(ChestState, {
  id: 'string',
  x: 'number',
  y: 'number',
  open: 'boolean',
  items: { array: 'string' },
  lockedBy: 'string',
});
