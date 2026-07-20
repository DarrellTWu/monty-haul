// scripts/render-floor.mjs
// SVG floor preview from floor data alone — the review loop for floor
// authoring (roadmap Sprint E, workflow W2; seeded early during the
// elevation/gradient pass). Mirrors RoomRenderer's placeholder look:
// elevation color ladder, narrow climb-gradient perimeter bands, wide ramp
// gradients at steps, walls/doors, plus entity markers.
//
// Usage: node scripts/render-floor.mjs <floorNumber> [outPath]
//   e.g. node scripts/render-floor.mjs 3            → floor3-preview.svg
//        node scripts/render-floor.mjs 1 /tmp/f1.svg

import { writeFileSync } from 'node:fs';
import { FLOOR_REGISTRY } from '../shared/data/floors/index.js';

const ELEVATION_COLORS = ['#2a2a3a', '#3a3a4f', '#4d4d68'];
const COLOR_WALL = '#111118';
const COLOR_DOOR = '#4a4a5a';
const CLIMB_BAND = 12;
const RAMP_W = 48;
const RAMP_D = 32;
const OUTER_WALL = 40;

const floorNum = process.argv[2] ?? '3';
const floor = FLOOR_REGISTRY[floorNum];
if (!floor) {
  console.error(`Unknown floor ${floorNum}. Known: ${Object.keys(FLOOR_REGISTRY).join(', ')}`);
  process.exit(1);
}
const outPath = process.argv[3] ?? `floor${floorNum}-preview.svg`;

const parts = [];
const defs = [];
let gradId = 0;

function rect(x, y, w, h, fill, extra = '') {
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`);
}

/** Gradient rect: towardHigh names the direction elevation increases.
 *  Corner directions (nw/ne/sw/se — the platform corner the tile sits on)
 *  run the gradient diagonally: outer corner low → inner corner high. */
function gradRect(x, y, w, h, low, high, towardHigh) {
  const id = `g${gradId++}`;
  const dir = {
    down:  'x1="0" y1="0" x2="0" y2="1"',
    up:    'x1="0" y1="1" x2="0" y2="0"',
    right: 'x1="0" y1="0" x2="1" y2="0"',
    left:  'x1="1" y1="0" x2="0" y2="0"',
    nw:    'x1="0" y1="0" x2="1" y2="1"',
    ne:    'x1="1" y1="0" x2="0" y2="1"',
    sw:    'x1="0" y1="1" x2="1" y2="0"',
    se:    'x1="1" y1="1" x2="0" y2="0"',
  }[towardHigh];
  defs.push(`<linearGradient id="${id}" ${dir}><stop offset="0" stop-color="${low}"/><stop offset="1" stop-color="${high}"/></linearGradient>`);
  rect(x, y, w, h, `url(#${id})`);
}

function circle(x, y, r, fill, extra = '') {
  parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`);
}

// ── Ground + outer walls ─────────────────────────────────────────────────────
rect(0, 0, floor.width, floor.height, COLOR_WALL);
rect(OUTER_WALL, OUTER_WALL, floor.width - 2 * OUTER_WALL, floor.height - 2 * OUTER_WALL, ELEVATION_COLORS[0]);

// ── Platforms (lowest tier first) + climb bands + ramps ──────────────────────
const platforms = [...(floor.platforms ?? [])].sort((a, b) => (a.elevation ?? 1) - (b.elevation ?? 1));
for (const p of platforms) {
  const tier = Math.min(p.elevation ?? 1, ELEVATION_COLORS.length - 1);
  const low = ELEVATION_COLORS[tier - 1];
  const high = ELEVATION_COLORS[tier];
  rect(p.x, p.y, p.w, p.h, high);
  const hb = CLIMB_BAND / 2;
  // Edge bands shortened by one corner tile at each end; corner tiles turn
  // the gradient diagonally (mirrors RoomRenderer.drawClimbBands).
  gradRect(p.x + hb, p.y - hb,       p.w - CLIMB_BAND, CLIMB_BAND, low, high, 'down'); // N
  gradRect(p.x + hb, p.y + p.h - hb, p.w - CLIMB_BAND, CLIMB_BAND, low, high, 'up');   // S
  gradRect(p.x - hb,       p.y + hb, CLIMB_BAND, p.h - CLIMB_BAND, low, high, 'right'); // W
  gradRect(p.x + p.w - hb, p.y + hb, CLIMB_BAND, p.h - CLIMB_BAND, low, high, 'left');  // E
  gradRect(p.x - hb,       p.y - hb,       CLIMB_BAND, CLIMB_BAND, low, high, 'nw');
  gradRect(p.x + p.w - hb, p.y - hb,       CLIMB_BAND, CLIMB_BAND, low, high, 'ne');
  gradRect(p.x - hb,       p.y + p.h - hb, CLIMB_BAND, CLIMB_BAND, low, high, 'sw');
  gradRect(p.x + p.w - hb, p.y + p.h - hb, CLIMB_BAND, CLIMB_BAND, low, high, 'se');
  for (const s of p.steps ?? []) {
    const onN = s.y === p.y, onS = s.y === p.y + p.h, onE = s.x === p.x + p.w;
    if (onN)      gradRect(s.x - RAMP_W / 2, s.y - RAMP_D / 2, RAMP_W, RAMP_D, low, high, 'down');
    else if (onS) gradRect(s.x - RAMP_W / 2, s.y - RAMP_D / 2, RAMP_W, RAMP_D, low, high, 'up');
    else if (onE) gradRect(s.x - RAMP_D / 2, s.y - RAMP_W / 2, RAMP_D, RAMP_W, low, high, 'left');
    else          gradRect(s.x - RAMP_D / 2, s.y - RAMP_W / 2, RAMP_D, RAMP_W, low, high, 'right');
  }
}

// ── Interior walls + doors ───────────────────────────────────────────────────
for (const w of floor.walls ?? []) rect(w.x, w.y, w.w, w.h, COLOR_WALL, 'stroke="#4a4a5a" stroke-width="1"');
for (const d of floor.doors ?? []) rect(d.x, d.y, d.w, d.h, d.locked ? COLOR_WALL : COLOR_DOOR, 'stroke="#6a6a7a" stroke-width="1"');

// ── Entities ─────────────────────────────────────────────────────────────────
const ENEMY_COLORS = { goblin: '#44bb44', dog: '#bb8844', skeleton: '#cccccc' };
for (const e of floor.enemies ?? []) circle(e.x, e.y, 12, ENEMY_COLORS[e.type] ?? '#ff4444');
for (const c of floor.chests ?? []) rect(c.x - 14, c.y - 10, 28, 20, '#ccaa33', 'stroke="#000"');
for (const s of floor.stairs ?? []) rect(s.x - 16, s.y - 16, 32, 32, '#33bbcc', 'stroke="#000"');
circle(floor.playerSpawn.x, floor.playerSpawn.y, 14, '#ffffff', 'stroke="#4488ff" stroke-width="3"');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${floor.width} ${floor.height}" width="1000" height="${Math.round(1000 * floor.height / floor.width)}">
<defs>${defs.join('')}</defs>
${parts.join('\n')}
</svg>`;

writeFileSync(outPath, svg);
console.log(`Wrote ${outPath} (${floor.platforms?.length ?? 0} platforms, ${floor.walls?.length ?? 0} walls, ${floor.doors?.length ?? 0} doors, ${floor.enemies?.length ?? 0} enemies)`);
