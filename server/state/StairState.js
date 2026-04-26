// server/state/StairState.js
import { createRequire } from 'module';
const { Schema, defineTypes } = createRequire(import.meta.url)('@colyseus/schema');

export class StairState extends Schema {
  constructor() {
    super();
    this.id = '';
    this.x = 0;
    this.y = 0;
    this.toFloor = 0; // floor number this stair leads to
    this.locked = false; // true while gated (e.g. enemies still alive)
  }
}

defineTypes(StairState, {
  id: 'string',
  x: 'number',
  y: 'number',
  toFloor: 'number',
  locked: 'boolean',
});
