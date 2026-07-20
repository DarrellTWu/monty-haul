// client/src/rendering/RoomRenderer.js
// Floor geometry rendering: base ground, platform tint, step strips, walls,
// and door bands. Extracted from DungeonScene so visual-constant changes are
// isolated from scene lifecycle. All functions take a Phaser Graphics object
// (or scene) explicitly — no module-level Phaser dependency.

const WALL = 40; // outer wall thickness in px; matches the server-side WALL constant

// Geometry palette — placeholder colors until tile art lands.
// Walls and platforms are visually distinct: walls are dark *obstacles*,
// platforms are differently-coloured *ground*, one shade per elevation tier.
// ELEVATION_COLORS is the ladder: index = elevation (0 = base ground).
const ELEVATION_COLORS = [
  0x2a2a3a, // elevation 0 — base ground
  0x3a3a4f, // elevation 1 — platform
  0x4d4d68, // elevation 2 — stacked summit (lighter = higher)
];
const COLOR_WALL_FILL       = 0x111118;
const COLOR_WALL_BORDER     = 0x4a4a5a;
const COLOR_DOOR_UNLOCKED   = 0x4a4a5a;
const COLOR_DOOR_LOCKED     = 0x111118;

// Climbable-surface gradient bands ("gradient tiles"). The climb band along a
// platform's perimeter walls is deliberately NARROW — a short, steep gradient
// from the lower tier's color to the platform's color that reads as "a wall a
// monk could scale, not a slope anyone strolls up." Ramps (steps) use the
// same gradient stretched DEEPER, so they read as accommodating: anyone can
// walk a ramp.
const CLIMB_BAND_DEPTH = 12; // perpendicular to the edge, straddling it 6/6
const RAMP_STRIP_WIDTH = 48; // length parallel to the platform edge (matches the step gap)
const RAMP_STRIP_DEPTH = 32; // perpendicular — gentle, walkable read (split half/half)

/**
 * Draw a floor's static geometry (base ground, outer walls, platforms, step
 * transitions, interior walls) onto a fresh Graphics object and return it.
 * Doors are NOT drawn here — they have their own Graphics so lock-state
 * changes can repaint without redrawing the whole floor.
 *
 * @param {Phaser.Scene} scene - used only for `scene.add.graphics()`
 * @param {{ width: number, height: number, walls?: Array, platforms?: Array }} floor
 * @returns {Phaser.GameObjects.Graphics}
 */
export function drawRoom(scene, floor) {
  const { width, height } = floor;
  const gfx = scene.add.graphics();

  // Outer wall band (frames the playable area).
  gfx.fillStyle(ELEVATION_COLORS[0]);
  gfx.fillRect(WALL, WALL, width - WALL * 2, height - WALL * 2);
  gfx.fillStyle(COLOR_WALL_FILL);
  gfx.fillRect(0, 0, width, WALL);
  gfx.fillRect(0, height - WALL, width, WALL);
  gfx.fillRect(0, 0, WALL, height);
  gfx.fillRect(width - WALL, 0, WALL, height);
  gfx.lineStyle(2, 0x5555aa);
  gfx.strokeRect(WALL, WALL, width - WALL * 2, height - WALL * 2);

  // Platform ground tint (painted OVER the base ground), lowest tier first so
  // stacked summits (elev-2 inside elev-1) paint on top. Each platform then
  // gets its climb-gradient perimeter bands, and ramps paint over those.
  const platforms = [...(floor.platforms ?? [])]
    .sort((a, b) => (a.elevation ?? 1) - (b.elevation ?? 1));
  for (const platform of platforms) {
    const tier = Math.min(platform.elevation ?? 1, ELEVATION_COLORS.length - 1);
    gfx.fillStyle(ELEVATION_COLORS[tier]);
    gfx.fillRect(platform.x, platform.y, platform.w, platform.h);
    drawClimbBands(gfx, platform, ELEVATION_COLORS[tier - 1], ELEVATION_COLORS[tier]);
    for (const step of platform.steps ?? []) {
      drawRampStrip(gfx, platform, step, ELEVATION_COLORS[tier - 1], ELEVATION_COLORS[tier]);
    }
  }

  // Interior walls — drawn after platforms so they sit on top of any overlapping tint.
  for (const wall of floor.walls ?? []) {
    gfx.fillStyle(COLOR_WALL_FILL);
    gfx.fillRect(wall.x, wall.y, wall.w, wall.h);
    gfx.lineStyle(1, COLOR_WALL_BORDER);
    gfx.strokeRect(wall.x, wall.y, wall.w, wall.h);
  }

  return gfx;
}

/**
 * Paint the narrow climb-gradient band along all four perimeter edges of a
 * platform — a short low-color → high-color gradient straddling the edge.
 * Ramps paint over these at step gaps (drawn after), so the wall band's
 * "steep" read survives only where the surface really is a wall.
 */
function drawClimbBands(gfx, platform, lowColor, highColor) {
  const half = CLIMB_BAND_DEPTH / 2;
  const { x, y, w, h } = platform;
  // North edge: low ground above, platform below.
  fillGradientRect(gfx, x - half, y - half, w + CLIMB_BAND_DEPTH, CLIMB_BAND_DEPTH, lowColor, highColor, 'down');
  // South edge: platform above, low ground below.
  fillGradientRect(gfx, x - half, y + h - half, w + CLIMB_BAND_DEPTH, CLIMB_BAND_DEPTH, lowColor, highColor, 'up');
  // West edge: low ground left, platform right.
  fillGradientRect(gfx, x - half, y - half, CLIMB_BAND_DEPTH, h + CLIMB_BAND_DEPTH, lowColor, highColor, 'right');
  // East edge: platform left, low ground right.
  fillGradientRect(gfx, x + w - half, y - half, CLIMB_BAND_DEPTH, h + CLIMB_BAND_DEPTH, lowColor, highColor, 'left');
}

/**
 * Paint a ramp (step) transition strip centered on the step location — the
 * same low→high gradient as the climb band, but stretched over a deeper strip
 * so it reads as a walkable slope rather than a scalable wall. Orientation is
 * derived from which platform edge the step is on.
 */
function drawRampStrip(gfx, platform, step, lowColor, highColor) {
  const onN = step.y === platform.y;
  const onS = step.y === platform.y + platform.h;
  const onE = step.x === platform.x + platform.w;
  const onW = step.x === platform.x;

  const halfD = RAMP_STRIP_DEPTH / 2;
  const halfW = RAMP_STRIP_WIDTH / 2;

  if (onN) {
    fillGradientRect(gfx, step.x - halfW, step.y - halfD, RAMP_STRIP_WIDTH, RAMP_STRIP_DEPTH, lowColor, highColor, 'down');
  } else if (onS) {
    fillGradientRect(gfx, step.x - halfW, step.y - halfD, RAMP_STRIP_WIDTH, RAMP_STRIP_DEPTH, lowColor, highColor, 'up');
  } else if (onE) {
    fillGradientRect(gfx, step.x - halfD, step.y - halfW, RAMP_STRIP_DEPTH, RAMP_STRIP_WIDTH, lowColor, highColor, 'left');
  } else if (onW) {
    fillGradientRect(gfx, step.x - halfD, step.y - halfW, RAMP_STRIP_DEPTH, RAMP_STRIP_WIDTH, lowColor, highColor, 'right');
  }
}

/**
 * Fill a rect with a linear low→high gradient. `towardHigh` names the
 * direction in which elevation increases across the rect:
 *   'down'  — high color at the bottom (north edges)
 *   'up'    — high color at the top (south edges)
 *   'right' — high color at the right (west edges)
 *   'left'  — high color at the left (east edges)
 * Phaser's fillGradientStyle takes corner colors (TL, TR, BL, BR).
 */
function fillGradientRect(gfx, x, y, w, h, lowColor, highColor, towardHigh) {
  if (towardHigh === 'down')       gfx.fillGradientStyle(lowColor, lowColor, highColor, highColor, 1);
  else if (towardHigh === 'up')    gfx.fillGradientStyle(highColor, highColor, lowColor, lowColor, 1);
  else if (towardHigh === 'right') gfx.fillGradientStyle(lowColor, highColor, lowColor, highColor, 1);
  else                             gfx.fillGradientStyle(highColor, lowColor, highColor, lowColor, 1);
  gfx.fillRect(x, y, w, h);
}

/**
 * Paint a door band into the given Graphics object. Caller is responsible for
 * gfx lifecycle; this function clears + redraws so it can be invoked when the
 * door's lock state changes.
 *
 * @param {Phaser.GameObjects.Graphics} gfx
 * @param {{ x: number, y: number, w: number, h: number, locked: boolean }} doorState
 */
export function drawDoorBand(gfx, doorState) {
  gfx.clear();
  const fill = doorState.locked ? COLOR_DOOR_LOCKED : COLOR_DOOR_UNLOCKED;
  gfx.fillStyle(fill);
  gfx.fillRect(doorState.x, doorState.y, doorState.w, doorState.h);
  gfx.lineStyle(1, COLOR_WALL_BORDER);
  gfx.strokeRect(doorState.x, doorState.y, doorState.w, doorState.h);
}
