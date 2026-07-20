// shared/data/floors/floor3.js
// Floor 3 — elevation & geometry PLAYGROUND (tile-art prep). NOT final design.
//
// Keeps floor 2's combat-testing skeleton — central walled room (4 double
// doors), three enemy arms (N=goblins, E=skeletons, W=dogs, sub-rooms of
// 1/2/4/6/8/10), entry chest, permanently-locked stair down — and fills the
// four diagonal quadrants with playground areas exercising every geometry
// feature:
//
//   NE — THE MESA:     stacked hill (elev-1 base with an elev-2 summit).
//                      Ramps onto the base (S + W); one ramp up the summit (E).
//                      Non-climbers walk two ramps; climbers go straight up.
//   SE — THE TERRACES: elev-1 shelf with a stacked elev-2 ledge; ramps N + W
//                      onto the shelf, ramp N onto the ledge.
//   SW — THE KEEP:     walled compound with a SINGLE doorway (48 px — one
//                      body seals it from any position; see
//                      design/dynamic-combat.md §Chokepoint widths) and a
//                      climb-only perch inside (no ramps — monks/rogues only).
//   NW — THE PILLARS:  open arena of climb-only pillars (high-ground pedestals
//                      with no ramps) plus one ramped platform for contrast.
//
// All geometry authored on the TILE_PX (40 px) grid; door widths (80/48) and
// step gaps are the sanctioned off-grid gameplay constants. Gradient climb
// bands and ramp strips are painted by RoomRenderer from this data alone.

const CENTER = { x: 2000, y: 2000 };
const SUBROOM_COUNTS = [1, 2, 4, 6, 8, 10];
const SUBROOM_SPACING = 300;
const CLUSTER_SPREAD  = 35;

const ROOM_HALF  = 200;
const WALL_THICK = 8;
const DOOR_WIDTH        = 80; // double doorway — two friendlies pass abreast
const DOOR_WIDTH_SINGLE = 48; // single doorway — strictly single-file
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

// ── The Keep (SW quadrant) — walled compound, single doorway on the north wall.
const KEEP = { x: 800, y: 2720, w: 560, h: 560 };
const KEEP_DOOR_CX = KEEP.x + KEEP.w / 2; // 1080
const KEEP_RIGHT   = KEEP.x + KEEP.w;
const KEEP_BOTTOM  = KEEP.y + KEEP.h;

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
    // Central room (unchanged from floor 2).
    { id: 'wall_n_left',  x: ROOM_LEFT,            y: ROOM_TOP - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    { id: 'wall_n_right', x: CENTER.x + DOOR_HALF, y: ROOM_TOP - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    { id: 'wall_s_left',  x: ROOM_LEFT,            y: ROOM_BOTTOM - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    { id: 'wall_s_right', x: CENTER.x + DOOR_HALF, y: ROOM_BOTTOM - WALL_OFFSET, w: ROOM_HALF - DOOR_HALF, h: WALL_THICK },
    { id: 'wall_e_top',    x: ROOM_RIGHT - WALL_OFFSET, y: ROOM_TOP,             w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },
    { id: 'wall_e_bottom', x: ROOM_RIGHT - WALL_OFFSET, y: CENTER.y + DOOR_HALF, w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },
    { id: 'wall_w_top',    x: ROOM_LEFT - WALL_OFFSET,  y: ROOM_TOP,             w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },
    { id: 'wall_w_bottom', x: ROOM_LEFT - WALL_OFFSET,  y: CENTER.y + DOOR_HALF, w: WALL_THICK, h: ROOM_HALF - DOOR_HALF },

    // The Keep (SW): solid on three sides, single doorway splitting the north wall.
    { id: 'wall_keep_n_left',  x: KEEP.x, y: KEEP.y - WALL_OFFSET, w: KEEP_DOOR_CX - DOOR_WIDTH_SINGLE / 2 - KEEP.x, h: WALL_THICK },
    { id: 'wall_keep_n_right', x: KEEP_DOOR_CX + DOOR_WIDTH_SINGLE / 2, y: KEEP.y - WALL_OFFSET, w: KEEP_RIGHT - (KEEP_DOOR_CX + DOOR_WIDTH_SINGLE / 2), h: WALL_THICK },
    { id: 'wall_keep_s', x: KEEP.x, y: KEEP_BOTTOM - WALL_OFFSET, w: KEEP.w, h: WALL_THICK },
    { id: 'wall_keep_w', x: KEEP.x - WALL_OFFSET,     y: KEEP.y, w: WALL_THICK, h: KEEP.h },
    { id: 'wall_keep_e', x: KEEP_RIGHT - WALL_OFFSET, y: KEEP.y, w: WALL_THICK, h: KEEP.h },
  ],
  doors: [
    // Central room: four double doorways (80 px).
    { id: 'door_n', x: CENTER.x - DOOR_HALF,    y: ROOM_TOP - WALL_OFFSET,    w: DOOR_WIDTH, h: WALL_THICK, locked: false },
    { id: 'door_s', x: CENTER.x - DOOR_HALF,    y: ROOM_BOTTOM - WALL_OFFSET, w: DOOR_WIDTH, h: WALL_THICK, locked: false },
    { id: 'door_e', x: ROOM_RIGHT - WALL_OFFSET, y: CENTER.y - DOOR_HALF,     w: WALL_THICK, h: DOOR_WIDTH, locked: false },
    { id: 'door_w', x: ROOM_LEFT - WALL_OFFSET,  y: CENTER.y - DOOR_HALF,     w: WALL_THICK, h: DOOR_WIDTH, locked: false },
    // The Keep: one single doorway (48 px) — a deliberate defensible bottleneck.
    { id: 'door_keep', x: KEEP_DOOR_CX - DOOR_WIDTH_SINGLE / 2, y: KEEP.y - WALL_OFFSET, w: DOOR_WIDTH_SINGLE, h: WALL_THICK, locked: false },
  ],
  platforms: [
    // ── NE: THE MESA — stacked hill. Ramps S + W onto the base; ramp E up the summit.
    {
      id: 'mesa_base', x: 2600, y: 600, w: 600, h: 600, elevation: 1,
      steps: [
        { id: 'step_mesa_s', x: 2900, y: 1200 }, // south edge ramp
        { id: 'step_mesa_w', x: 2600, y: 900 },  // west edge ramp
      ],
    },
    {
      id: 'mesa_summit', x: 2800, y: 800, w: 240, h: 240, elevation: 2,
      steps: [
        { id: 'step_summit_e', x: 3040, y: 920 }, // east edge ramp (the only walkable route up)
      ],
    },

    // ── SE: THE TERRACES — shelf with a stacked ledge.
    {
      id: 'terrace_shelf', x: 2600, y: 2600, w: 640, h: 400, elevation: 1,
      steps: [
        { id: 'step_terrace_n', x: 2760, y: 2600 }, // north edge ramp
        { id: 'step_terrace_w', x: 2600, y: 2800 }, // west edge ramp
      ],
    },
    {
      id: 'terrace_ledge', x: 2960, y: 2680, w: 240, h: 240, elevation: 2,
      steps: [
        { id: 'step_ledge_n', x: 3080, y: 2680 }, // north edge ramp
      ],
    },

    // ── SW: THE KEEP's perch — climb-only (no steps): monks/rogues/goblins only.
    { id: 'keep_perch', x: 960, y: 2880, w: 240, h: 240, elevation: 1, steps: [] },

    // ── NW: THE PILLARS — climb-only high-ground pedestals + one ramped contrast.
    { id: 'pillar_a', x: 800,  y: 800,  w: 160, h: 160, elevation: 1, steps: [] },
    { id: 'pillar_b', x: 1120, y: 1000, w: 160, h: 160, elevation: 1, steps: [] },
    { id: 'pillar_c', x: 920,  y: 1240, w: 160, h: 160, elevation: 1, steps: [] },
    {
      id: 'pillar_ramped', x: 1400, y: 700, w: 240, h: 200, elevation: 1,
      steps: [
        { id: 'step_pillar_s', x: 1520, y: 900 }, // south edge ramp — everyone's route up
      ],
    },
  ],
  rooms: [
    {
      id: 'room_center',
      x: ROOM_LEFT, y: ROOM_TOP, w: ROOM_HALF * 2, h: ROOM_HALF * 2,
      doors: ['door_n', 'door_s', 'door_e', 'door_w'],
    },
    {
      id: 'room_keep',
      x: KEEP.x, y: KEEP.y, w: KEEP.w, h: KEEP.h,
      doors: ['door_keep'],
    },
  ],
};
