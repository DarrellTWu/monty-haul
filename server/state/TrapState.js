// server/state/TrapState.js
import { createRequire } from 'module';
const { Schema, defineTypes } = createRequire(import.meta.url)('@colyseus/schema');

export class TrapState extends Schema {
  constructor() {
    super();
    this.id = '';
    this.x = 0;
    this.y = 0;
    this.cooldownMs = 0; // 0 = active, >0 = recently triggered
  }
}

defineTypes(TrapState, {
  id: 'string',
  x: 'number',
  y: 'number',
  cooldownMs: 'number',
});
