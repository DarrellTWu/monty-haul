// shared/data/floors/floor3.js
// Floor 3 — verbatim clone of floor 2 (combat-tuning debug room) with one
// addition: a permanently-locked stair down to a not-yet-built floor 4. NOT
// final design.
//
// Layout: 4000×4000 square, player + chest at center. Three arms radiate out
// (N=goblins, E=skeletons, W=dogs), each with six sub-rooms holding 1, 2, 4,
// 6, 8, 10 enemies. Identical to floor 2 — see floor2.js for layout notes.
//
// Stair to floor 4 sits inside the central walled room, north of spawn. It
// carries unlock: { kind: 'never' } — visible but permanently locked until
// floor 4 ships (see shared/logic/unlock.js).

const CENTER = { x: 2000, y: 2000 };
const SUBROOM_COUNTS = [1, 2, 4, 6, 8, 10];
const SUBROOM_SPACING = 300;
const CLUSTER_SPREAD  = 35;

const ROOM_HALF  = 200;
const WALL_THICK = 8;
const DOOR_WIDTH = 80;
const ROOM_LEFT   = CENTER.x - ROOM_HALF;
const ROOM_RIGHT  = CENTER.x + ROOM_HALF;
const ROOM_TOP    = CENTER.y - ROOM_HALF;
const ROOM_BOTTOM = CENTER.y + ROOM_HALF;
const DOOR_HALF   = DOOR_WIDTH / 2;
const WALL_OFFSET = WALL_THICK / 2;

function cluster(cx, cy, count) {
  if (count === 1) return [{ x: cx, y: cy }];
  const out = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    out.push({
      x: Math.round(cx + Math.cos(angle) * CLUSTER_SPREAD),
      y: Math.round(cy + Math.sin(angle) * CLUSTER_SPREAD),
    });
  }
  return out;
}

function buildArm(type, axis, sign, idPrefix) {
  const enemies = [];
  let n = 0;
  SUBROOM_COUNTS.forEach((count, roomIdx) => {
    const offset = SUBROOM_SPACING * (roomIdx + 1);
    const cx = axis === 'x' ? CENTER.x + sign * offset : CENTER.x;
    const cy = axis === 'y' ? CENTER.y + sign * offset : CENTER.y;
    for (const pos of cluster(cx, cy, count)) {
      enemies.push({ id: `${idPrefix}_${n++}`, type, x: pos.x, y: pos.y });
    }
  });
  return enemies;
}

const ENTRY_CHEST_ITEMS = [
  'extraction_scroll',
  ...Array(10).fill('healing_potion'),
  ...Array(10).fill('bless_potion'),
  ...Array(10).fill('longstrider_potion'),
  ...Array(10).fill('false_life_potion'),
];

export const FLOOR_3 = {
  width: 4000,
  height: 4000,
  playerSpawn: { x: CENTER.x, y: CENTER.y },
  enemies: [
    ...buildArm('goblin',   'y', -1, 'goblin'),
    ...buildArm('skeleton', 'x', +1, 'skeleton'),
    ...buildArm('dog',      'x', -1, 'dog'),
  ],
  chests: [{
    id: 'chest_floor3_entry',
    x: CENTER.x + 80,
    y: CENTER.y,
    items: ENTRY_CHEST_ITEMS,
  }],
  traps: [],
  // Stair down to floor 4: unlock 'never' — visible but permanently locked
  // (floor 4 doesn't exist yet; the validator allows the missing target).
  stairs: [{
    id: 'stair_floor3_down',
    x: CENTER.x,
    y: CENTER.y - 60,
    toFloor: 4,
    unlock: { kind: 'never' },
  }],
  walls: [
    { id: 'wall_n_left',  x: ROOM_LEFT,            y: ROOM_TOP - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    { id: 'wall_n_right', x: CENTER.x + DOOR_HALF, y: ROOM_TOP - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    { id: 'wall_s_left',  x: ROOM_LEFT,            y: ROOM_BOTTOM - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    { id: 'wall_s_right', x: CENTER.x + DOOR_HALF, y: ROOM_BOTTOM - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    { id: 'wall_e_top',    x: ROOM_RIGHT - WALL_OFFSET, y: ROOM_TOP,             w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },
    { id: 'wall_e_bottom', x: ROOM_RIGHT - WALL_OFFSET, y: CENTER.y + DOOR_HALF, w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },
    { id: 'wall_w_top',    x: ROOM_LEFT - WALL_OFFSET,  y: ROOM_TOP,             w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },
    { id: 'wall_w_bottom', x: ROOM_LEFT - WALL_OFFSET,  y: CENTER.y + DOOR_HALF, w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },
  ],
  doors: [
    { id: 'door_n', x: CENTER.x - DOOR_HALF,    y: ROOM_TOP - WALL_OFFSET,    w: DOOR_WIDTH, h: WALL_THICK, locked: false },
    { id: 'door_s', x: CENTER.x - DOOR_HALF,    y: ROOM_BOTTOM - WALL_OFFSET, w: DOOR_WIDTH, h: WALL_THICK, locked: false },
    { id: 'door_e', x: ROOM_RIGHT - WALL_OFFSET, y: CENTER.y - DOOR_HALF,     w: WALL_THICK, h: DOOR_WIDTH, locked: false },
    { id: 'door_w', x: ROOM_LEFT - WALL_OFFSET,  y: CENTER.y - DOOR_HALF,     w: WALL_THICK, h: DOOR_WIDTH, locked: false },
  ],
  platforms: [],
  rooms: [{
    id: 'room_center',
    x: ROOM_LEFT, y: ROOM_TOP, w: ROOM_HALF * 2, h: ROOM_HALF * 2,
    doors: ['door_n', 'door_s', 'door_e', 'door_w'],
  }],
};
