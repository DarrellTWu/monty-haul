// shared/data/floors/floor1.js
// Floor 1 — the original prototype room, now declared as data.
// Stair to floor 2 sits east of the chest near spawn; locked until
// every enemy is dead.

export const FLOOR_1 = {
  width: 1600,
  height: 1200,
  playerSpawn: { x: 800, y: 600 },
  enemies: [
    { id: 'goblin_0',   type: 'goblin',   x: 300,  y: 300 },
    { id: 'goblin_1',   type: 'goblin',   x: 1300, y: 900 },
    { id: 'dog_0',      type: 'dog',      x: 1300, y: 300 },
    { id: 'skeleton_0', type: 'skeleton', x: 300,  y: 900 },
  ],
  chests: [{
    id: 'chest_floor1',
    x: 880, y: 600,
    items: [
      'shield', 'dagger', 'greataxe', 'mace',
      'half_plate',
      'healing_potion', 'bless_potion', 'longstrider_potion', 'false_life_potion',
    ],
  }],
  traps: [{ id: 'trap_floor1_ne', x: 1380, y: 160 }],
  stairs: [{
    id: 'stair_floor1_down',
    x: 980, y: 600,
    toFloor: 2,
    lockedUntilAllEnemiesDead: true,
  }],
};
