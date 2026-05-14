// server/state/DoorState.js
import { createRequire } from 'module';
const { Schema, defineTypes } = createRequire(import.meta.url)('@colyseus/schema');

export class DoorState extends Schema {
  constructor() {
    super();
    this.id = '';
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
    this.locked = false; // server-authoritative; future levers/keys flip this
  }
}

defineTypes(DoorState, {
  id: 'string',
  x: 'number',
  y: 'number',
  w: 'number',
  h: 'number',
  locked: 'boolean',
});
