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
};
