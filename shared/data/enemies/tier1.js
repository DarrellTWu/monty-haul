// shared/data/enemies/tier1.js
// Floor 1-3 enemy roster. Individual stat blocks live in their own files
// for easy per-enemy tuning.

import GOBLIN   from './goblin.js';
import DOG      from './dog.js';
import SKELETON from './skeleton.js';

export { GOBLIN, DOG, SKELETON };

// type string → stat block. Single source of truth for "what can the server
// spawn?" — used by DungeonRoom._loadFloor and the boot-time floor validator.
export const ENEMY_REGISTRY = { goblin: GOBLIN, dog: DOG, skeleton: SKELETON };
