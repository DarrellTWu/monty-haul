// shared/data/floors/floor1.js
// Floor 1 — the original prototype room, now declared as data.
// Spawn, chest, and stairs sit on a central elevated platform. Players
// begin elevated; to engage ground-level enemies they must descend via
// one of four steps (or walk off any edge — see geometry-sprint-plan).
//
// Stair to floor 2 sits on the platform, west of spawn; locked until
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
    x: 760, y: 600,           // on the platform, west of spawn; clear of step_w
    toFloor: 2,
    lockedUntilAllEnemiesDead: true,
  }],
  walls: [],                  // no walls this floor — the platform edge IS the choke point
  doors: [],
  rooms: [],                  // no walled rooms this floor
  platforms: [{
    id: 'platform_center',
    x: 680, y: 480, w: 300, h: 240,     // 300 × 240 px, centered on (800, 600)
    elevation: 1,
    steps: [
      { id: 'step_n', x: 800, y: 480 }, // north edge midpoint
      { id: 'step_s', x: 800, y: 720 }, // south edge midpoint
      { id: 'step_e', x: 980, y: 600 }, // east  edge midpoint
      { id: 'step_w', x: 680, y: 600 }, // west  edge midpoint
    ],
  }],
};
