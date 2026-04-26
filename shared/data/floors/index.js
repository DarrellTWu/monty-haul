// shared/data/floors/index.js
// Floor registry — keyed by floor number.
// Server reads this in DungeonRoom._loadFloor(n) to spawn entities.
// Client reads this for room dimensions and any client-side layout cues.

import { FLOOR_1 } from './floor1.js';
import { FLOOR_2 } from './floor2.js';

export const FLOOR_REGISTRY = {
  1: FLOOR_1,
  2: FLOOR_2,
};
