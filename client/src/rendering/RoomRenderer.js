// client/src/rendering/RoomRenderer.js
// Floor geometry rendering: base ground, platform tint, step strips, walls,
// and door bands. Extracted from DungeonScene so visual-constant changes are
// isolated from scene lifecycle. All functions take a Phaser Graphics object
// (or scene) explicitly — no module-level Phaser dependency.

const WALL = 40; // outer wall thickness in px; matches the server-side WALL constant

// Geometry palette — placeholder colors until tile art lands.
// Walls and platforms are visually distinct: walls are dark *obstacles*,
// platforms are differently-coloured *ground* indicating elevation 1.
const COLOR_BASE_GROUND     = 0x2a2a3a;
const COLOR_PLATFORM_GROUND = 0x3a3a4f;
const COLOR_STEP_INNER      = 0x36364a;
const COLOR_STEP_OUTER      = 0x30303d;
const COLOR_WALL_FILL       = 0x111118;
const COLOR_WALL_BORDER     = 0x4a4a5a;
const COLOR_DOOR_UNLOCKED   = 0x4a4a5a;
const COLOR_DOOR_LOCKED     = 0x111118;

// Step transition strip — visual size at each step location.
const STEP_STRIP_WIDTH = 48; // length parallel to the platform edge
const STEP_STRIP_DEPTH = 24; // perpendicular to the edge (split half/half)

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
  gfx.fillStyle(COLOR_BASE_GROUND);
  gfx.fillRect(WALL, WALL, width - WALL * 2, height - WALL * 2);
  gfx.fillStyle(COLOR_WALL_FILL);
  gfx.fillRect(0, 0, width, WALL);
  gfx.fillRect(0, height - WALL, width, WALL);
  gfx.fillRect(0, 0, WALL, height);
  gfx.fillRect(width - WALL, 0, WALL, height);
  gfx.lineStyle(2, 0x5555aa);
  gfx.strokeRect(WALL, WALL, width - WALL * 2, height - WALL * 2);

  // Platform ground tint (painted OVER the base ground).
  for (const platform of floor.platforms ?? []) {
    gfx.fillStyle(COLOR_PLATFORM_GROUND);
    gfx.fillRect(platform.x, platform.y, platform.w, platform.h);
    for (const step of platform.steps ?? []) {
      drawStepStrip(gfx, platform, step);
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
 * Paint a step transition strip centered on the step location. Half the strip
 * sits inside the platform (brighter tint), half outside (dimmer). Orientation
 * is derived from which platform edge the step is on.
 */
function drawStepStrip(gfx, platform, step) {
  const onN = step.y === platform.y;
  const onS = step.y === platform.y + platform.h;
  const onE = step.x === platform.x + platform.w;
  const onW = step.x === platform.x;

  const halfStripDepth = STEP_STRIP_DEPTH / 2;
  const halfStripWidth = STEP_STRIP_WIDTH / 2;

  if (onN) {
    gfx.fillStyle(COLOR_STEP_INNER);
    gfx.fillRect(step.x - halfStripWidth, step.y, STEP_STRIP_WIDTH, halfStripDepth);
    gfx.fillStyle(COLOR_STEP_OUTER);
    gfx.fillRect(step.x - halfStripWidth, step.y - halfStripDepth, STEP_STRIP_WIDTH, halfStripDepth);
  } else if (onS) {
    gfx.fillStyle(COLOR_STEP_INNER);
    gfx.fillRect(step.x - halfStripWidth, step.y - halfStripDepth, STEP_STRIP_WIDTH, halfStripDepth);
    gfx.fillStyle(COLOR_STEP_OUTER);
    gfx.fillRect(step.x - halfStripWidth, step.y, STEP_STRIP_WIDTH, halfStripDepth);
  } else if (onE) {
    gfx.fillStyle(COLOR_STEP_INNER);
    gfx.fillRect(step.x - halfStripDepth, step.y - halfStripWidth, halfStripDepth, STEP_STRIP_WIDTH);
    gfx.fillStyle(COLOR_STEP_OUTER);
    gfx.fillRect(step.x, step.y - halfStripWidth, halfStripDepth, STEP_STRIP_WIDTH);
  } else if (onW) {
    gfx.fillStyle(COLOR_STEP_INNER);
    gfx.fillRect(step.x, step.y - halfStripWidth, halfStripDepth, STEP_STRIP_WIDTH);
    gfx.fillStyle(COLOR_STEP_OUTER);
    gfx.fillRect(step.x - halfStripDepth, step.y - halfStripWidth, halfStripDepth, STEP_STRIP_WIDTH);
  }
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
