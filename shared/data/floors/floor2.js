// shared/data/floors/floor2.js
// Floor 2 — combat-tuning debug room. NOT final design.
//
// Layout: 4000×4000 square, player + chest at center. Three arms
// radiate out (N=goblins, E=skeletons, W=dogs). Each arm has six
// sub-rooms holding 1, 2, 4, 6, 8, 10 enemies respectively. Sub-rooms
// are spaced 300 px apart — outside the 200 px aggro radius
// (constants.js COMBAT_DETECTION_RADIUS) so a player engaging one
// sub-room shouldn't pull the next.
//
// No stairs out — the only way back to the hub is the Scroll of
// Extraction in the entry chest.

const CENTER = { x: 2000, y: 2000 };
const SUBROOM_COUNTS = [1, 2, 4, 6, 8, 10]; // 31 enemies per arm, 93 total
const SUBROOM_SPACING = 300;
const CLUSTER_SPREAD  = 35;

// Walled center room — 400×400 around spawn, with one 80 px door on each
// face. N/E/W doors open into the existing enemy arms; S door is reserved
// for a future 4th testing arm (opens into empty floor for now).
const ROOM_HALF  = 200;
const WALL_THICK = 8;
const DOOR_WIDTH = 80;
const ROOM_LEFT   = CENTER.x - ROOM_HALF;   // 1800
const ROOM_RIGHT  = CENTER.x + ROOM_HALF;   // 2200
const ROOM_TOP    = CENTER.y - ROOM_HALF;   // 1800
const ROOM_BOTTOM = CENTER.y + ROOM_HALF;   // 2200
const DOOR_HALF   = DOOR_WIDTH / 2;
// Each wall band is 8 px thick centered on the room's edge coordinate, so
// the band occupies (edge - 4) to (edge + 4) along its perpendicular axis.
const WALL_OFFSET = WALL_THICK / 2;

// Distribute `count` enemies on a small ring around (cx, cy) so a single
// sub-room doesn't stack everyone on one pixel. Single-enemy rooms drop
// dead-center.
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

// Build one arm: enemies of `type`, extending along `axis` ('x'|'y') in
// `sign` direction (+1 or -1). Returns a flat list of enemy entries.
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

export const FLOOR_2 = {
  width: 4000,
  height: 4000,
  playerSpawn: { x: CENTER.x, y: CENTER.y },
  enemies: [
    ...buildArm('goblin',   'y', -1, 'goblin'),   // north arm (y decreasing)
    ...buildArm('skeleton', 'x', +1, 'skeleton'), // east arm
    ...buildArm('dog',      'x', -1, 'dog'),      // west arm
  ],
  chests: [{
    id: 'chest_floor2_entry',
    x: CENTER.x + 80,
    y: CENTER.y,
    items: ENTRY_CHEST_ITEMS,
  }],
  traps: [],
  stairs: [], // exit only via Scroll of Extraction
  // Walled center room: each face is a wall band split into two segments
  // around a centered door opening.
  walls: [
    // North band (y = ROOM_TOP - WALL_OFFSET .. ROOM_TOP + WALL_OFFSET)
    { id: 'wall_n_left',  x: ROOM_LEFT,            y: ROOM_TOP - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    { id: 'wall_n_right', x: CENTER.x + DOOR_HALF, y: ROOM_TOP - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    // South band
    { id: 'wall_s_left',  x: ROOM_LEFT,            y: ROOM_BOTTOM - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    { id: 'wall_s_right', x: CENTER.x + DOOR_HALF, y: ROOM_BOTTOM - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    // East band (x = ROOM_RIGHT - WALL_OFFSET .. ROOM_RIGHT + WALL_OFFSET)
    { id: 'wall_e_top',    x: ROOM_RIGHT - WALL_OFFSET, y: ROOM_TOP,             w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },
    { id: 'wall_e_bottom', x: ROOM_RIGHT - WALL_OFFSET, y: CENTER.y + DOOR_HALF, w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },
    // West band
    { id: 'wall_w_top',    x: ROOM_LEFT - WALL_OFFSET,  y: ROOM_TOP,             w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },
    { id: 'wall_w_bottom', x: ROOM_LEFT - WALL_OFFSET,  y: CENTER.y + DOOR_HALF, w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },
  ],
  doors: [
    { id: 'door_n', x: CENTER.x - DOOR_HALF,    y: ROOM_TOP - WALL_OFFSET,    w: DOOR_WIDTH, h: WALL_THICK, locked: false },
    { id: 'door_s', x: CENTER.x - DOOR_HALF,    y: ROOM_BOTTOM - WALL_OFFSET, w: DOOR_WIDTH, h: WALL_THICK, locked: false }, // reserved for future 4th arm
    { id: 'door_e', x: ROOM_RIGHT - WALL_OFFSET, y: CENTER.y - DOOR_HALF,     w: WALL_THICK, h: DOOR_WIDTH, locked: false },
    { id: 'door_w', x: ROOM_LEFT - WALL_OFFSET,  y: CENTER.y - DOOR_HALF,     w: WALL_THICK, h: DOOR_WIDTH, locked: false },
  ],
  platforms: [],
  // Walled-room routing hints for AI. The rect is the room *interior* (not
  // the wall band). An AI pursuing a target inside this room retargets to
  // the nearest unlocked door instead of jamming into a wall — mirrors the
  // platform/step routing model on floor 1.
  rooms: [{
    id: 'room_center',
    x: ROOM_LEFT, y: ROOM_TOP, w: ROOM_HALF * 2, h: ROOM_HALF * 2,
    doors: ['door_n', 'door_s', 'door_e', 'door_w'],
  }],
};
