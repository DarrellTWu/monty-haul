// client/src/scenes/DungeonScene.js
// Main gameplay scene. Reads authoritative state from the Colyseus room
// and renders it each frame. No local physics — positions come from the server.
//
// PLACEHOLDER GRAPHICS: entities are drawn as colored circles.
// When sprites exist, replace the Graphics draw calls in _createEntityGfx()
// with Phaser.GameObjects.Sprite instances. The update loop reads x/y from
// server state regardless of whether the visual is a circle or a sprite.
//
// PLACEHOLDER ROOM: the room boundary is a simple rectangle.
// When tilemaps arrive, replace drawRoom() in client/src/rendering/RoomRenderer.js with a Tilemap layer.

import { joinDungeon, sendDescend, sendUseHotbar, sendAttack, leave as leaveRoom } from '../network/ColyseusClient.js';
import { InputHandler } from '../input/InputHandler.js';
import { CHEST_LOOT_RANGE_PX, TRAP_RADIUS_PX, MELEE_SELECT_RANGE_PX } from '../../../shared/data/constants.js';
import { WEAPON_REGISTRY } from '../../../shared/data/weapons/index.js';
import { FLOOR_REGISTRY } from '../../../shared/data/floors/index.js';
import { getPlayerId } from '../store/stash.js';
import { drawRoom, drawDoorBand } from '../rendering/RoomRenderer.js';

// Visual config — swap these out when sprites land.
const PLAYER_RADIUS   = 16;
const ENEMY_RADIUS    = 12;
const PLAYER_COLOR    = 0x4488ff;
const ENEMY_COLOR     = 0x44cc44;
const DEAD_COLOR      = 0x444444;
const CORPSE_LOOTABLE_COLOR = 0x886633;  // dim gold/brown for unlooted corpses
const HP_BAR_WIDTH    = 32;
const HP_BAR_HEIGHT   = 5;
const HP_BAR_OFFSET_Y = 22;

// Room geometry rendering (walls, platforms, step strips, doors) lives in
// client/src/rendering/RoomRenderer.js. Visual constants for that module are
// owned there; this scene only references entity-rendering constants below.

// Render depths (Phaser default = 0).
//   room background (drawRoom output):             0
//   doors:                                         0.5
//   chests / traps / stairs:                       1
//   ground-level entities (elevation 0):           2
//   elevated entities (elevation 1):               4
//   HP bars:                                       entity depth + 1
const DEPTH_GROUND_ENTITY = 2;
const DEPTH_ELEVATED_ENTITY = 4;

export class DungeonScene extends Phaser.Scene {
  constructor() {
    super({ key: 'DungeonScene' });
  }

  init(data) {
    // Server loads the raider pack from playerStore using playerId — no items passed.
    this._joinOpts = { ...(data ?? {}), playerId: getPlayerId() };
  }

  async create() {
    this._room        = null;
    this._playerGfx   = new Map();  // sessionId → { circle, hpBar }
    this._enemyGfx    = new Map();  // enemyId   → { circle, hpBar, lootHint }
    this._chestGfx    = new Map();  // chestId   → { gfx, hint, chestState }
    this._trapGfx     = new Map();  // trapId    → { gfx, warnText, trapState }
    this._stairGfx    = new Map();  // stairId   → { gfx, label, hint, stairState }
    this._doorGfx     = new Map();  // doorId    → { gfx, doorState }
    this._roomGfx     = null;       // background room rectangle (recreated on floor change)
    this._currentFloor = 0;         // last-rendered floor; drives floor-change detection
    this._input       = null;
    this._runEnded    = false;
    this._lastHitBy   = 'an enemy';
    this._selectedEnemyId = null;

    // Connecting overlay sits in screen space until join resolves and we know
    // the floor (room dimensions / camera bounds depend on it).
    this._statusText = this.add.text(640, 360, 'Connecting…', {
      fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0);

    try {
      this._room = await joinDungeon(this._joinOpts);
      this._statusText.destroy();
      this._statusText = null;
    } catch (err) {
      this._statusText.setText(`Connection failed:\n${err.message}`);
      console.error('[DungeonScene] Failed to join room:', err);
      return;
    }

    this._applyFloorLayout(this._room.state.floor);

    // Entity add/remove handlers.
    this._room.state.players.onAdd((player, sessionId) => {
      this._createEntityGfx(sessionId, player, 'player');
      if (sessionId === this._room.sessionId) {
        const gfx = this._playerGfx.get(sessionId);
        if (gfx) gfx.circle.setFillStyle(0xffcc00);
      }
    });

    this._room.state.players.onRemove((player, sessionId) => {
      this._destroyEntityGfx(sessionId, this._playerGfx);
    });

    this._room.state.enemies.onAdd((enemy, id) => {
      this._createEntityGfx(id, enemy, 'enemy');
    });
    this._room.state.enemies.onRemove((enemy, id) => {
      this._destroyEntityGfx(id, this._enemyGfx);
      if (this._selectedEnemyId === id) this._selectedEnemyId = null;
    });

    this._room.state.chests.onAdd((chest, id) => {
      this._createChestGfx(id, chest);
    });
    this._room.state.chests.onRemove((chest, id) => {
      this._destroyChestGfx(id);
    });

    this._room.state.traps.onAdd((trap, id) => {
      this._createTrapGfx(id, trap);
    });
    this._room.state.traps.onRemove((trap, id) => {
      this._destroyTrapGfx(id);
    });

    this._room.state.stairs.onAdd((stair, id) => {
      this._createStairGfx(id, stair);
    });
    this._room.state.stairs.onRemove((stair, id) => {
      this._destroyStairGfx(id);
    });

    this._room.state.doors.onAdd((door, id) => {
      this._createDoorGfx(id, door);
    });
    this._room.state.doors.onRemove((door, id) => {
      this._destroyDoorGfx(id);
    });

    // Relay combat log messages to HUDScene; track last entity to hit the player.
    const playerLabel = this._joinOpts.class
      ? this._joinOpts.class[0].toUpperCase() + this._joinOpts.class.slice(1)
      : 'Player';
    this._room.onMessage('combat_log', ({ message }) => {
      const hud = this.scene.get('HUDScene');
      if (hud?.addLog) hud.addLog(message);
      if (message.includes(`→ ${playerLabel}:`) && message.includes(': hit')) {
        this._lastHitBy = message.split('→')[0].trim();
      }
    });

    this._room.onMessage('attack_denied', ({ reason }) => {
      const hud = this.scene.get('HUDScene');
      let msg = 'Invalid target.';
      if (reason === 'out_of_range')        msg = 'Target out of range.';
      else if (reason === 'no_line_of_sight') msg = 'No line of sight.';
      else if (reason === 'no_target')        msg = 'Select a target before firing.';
      if (hud?.addLog) hud.addLog(msg);
    });

    this._room.onMessage('projectile_fired', (p) => this._renderProjectile(p));

    // Pointer-down: hit-test enemies in world space. Hit → select. Miss → clear.
    // Suppressed while inventory/loot overlay is up so its own clicks don't leak.
    this.input.on('pointerdown', (pointer) => {
      if (this.scene.isActive('InventoryScene')) return;
      const wx = pointer.worldX;
      const wy = pointer.worldY;
      let bestId = null;
      let bestDist = Infinity;
      for (const [id, enemy] of this._room.state.enemies) {
        if (!enemy.alive) continue;
        const dx = wx - enemy.x;
        const dy = wy - enemy.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d <= ENEMY_RADIUS && d < bestDist) { bestDist = d; bestId = id; }
      }
      this._selectedEnemyId = bestId;
    });

    // Input.
    this._input = new InputHandler(this);
    this._input.onInventoryDown = () => this._toggleInventory();
    this._input.onInteract      = () => this._tryInteractNearby();
    this._input.onHotbar        = (slot) => sendUseHotbar(slot);
    this._input.onAttack        = () => sendAttack(this._selectedEnemyId);
    this._input.onTabCycle      = () => this._cycleTarget();

    this.scene.launch('HUDScene');

    this._room.state.onChange(() => {
      if (this._room.state.phase === 'complete' && !this._runEnded) {
        this._runEnded = true;
        this._onRunComplete();
      }
      if (this._room.state.floor !== this._currentFloor) {
        this._applyFloorLayout(this._room.state.floor);
      }
    });
  }

  update() {
    if (!this._room) return;

    // Input is suppressed whenever an overlay scene (inventory or loot) is up,
    // and re-enabled the moment it closes — covers Esc / I / range-auto-close
    // paths uniformly without each path needing to call back here.
    if (this._input) this._input.enabled = !this.scene.isActive('InventoryScene');
    this._input?.update();

    const state    = this._room.state;
    const myPlayer = state.players.get(this._room.sessionId);

    if (myPlayer && !myPlayer.alive && !this._runEnded) {
      this._runEnded = true;
      this._onRunFailed();
    }

    // Player visuals.
    for (const [sessionId, player] of state.players) {
      const gfx = this._playerGfx.get(sessionId);
      if (!gfx) continue;
      gfx.circle.setPosition(player.x, player.y);
      if (!player.alive) gfx.circle.setFillStyle(DEAD_COLOR);
      this._updateHpBar(gfx.hpBar, player.x, player.y, player.hp, player.maxHp);
      // Layer above platform tint when elevated, so the player visually sits
      // "on top of" the platform rather than being absorbed into its colour.
      const depth = player.elevation === 1 ? DEPTH_ELEVATED_ENTITY : DEPTH_GROUND_ENTITY;
      gfx.circle.setDepth(depth);
      gfx.hpBar.setDepth(depth + 1);
      if (sessionId === this._room.sessionId) {
        this.cameras.main.centerOn(player.x, player.y);
      }
    }

    // Chest visuals.
    for (const [, { gfx, hint, chestState }] of this._chestGfx) {
      if (chestState.open) {
        gfx.clear();
        gfx.lineStyle(2, 0x664422);
        gfx.strokeRect(chestState.x - 20, chestState.y - 14, 40, 28);
        hint.setVisible(false);
      } else if (myPlayer) {
        const dx   = myPlayer.x - chestState.x;
        const dy   = myPlayer.y - chestState.y;
        hint.setVisible(Math.sqrt(dx * dx + dy * dy) < CHEST_LOOT_RANGE_PX);
      }
    }

    // Trap visuals — diamond flashes red when active, dims on cooldown.
    for (const [, { gfx, warnText, trapState }] of this._trapGfx) {
      const active = trapState.cooldownMs <= 0;
      gfx.clear();
      this._drawTrapDiamond(gfx, trapState.x, trapState.y, active);
      warnText.setAlpha(active ? 1 : 0.3);
    }

    // Stair visuals — color shifts when unlocked; F: Descend hint when in range.
    for (const [, { gfx, label, hint, stairState }] of this._stairGfx) {
      this._drawStairBox(gfx, stairState);
      label.setText(stairState.locked ? 'Stairs (locked)' : 'Stairs ↓');
      label.setColor(stairState.locked ? '#666688' : '#ffaa55');
      if (!stairState.locked && myPlayer) {
        const dx = myPlayer.x - stairState.x;
        const dy = myPlayer.y - stairState.y;
        hint.setVisible(Math.sqrt(dx * dx + dy * dy) < CHEST_LOOT_RANGE_PX);
      } else {
        hint.setVisible(false);
      }
    }

    // Auto-clear selection if the selected enemy is dead (onRemove handles
    // missing-id case for floor swaps).
    if (this._selectedEnemyId) {
      const sel = state.enemies.get(this._selectedEnemyId);
      if (!sel || !sel.alive) this._selectedEnemyId = null;
    }

    // Enemy visuals.
    for (const [id, enemy] of state.enemies) {
      const gfx = this._enemyGfx.get(id);
      if (!gfx) continue;
      gfx.circle.setPosition(enemy.x, enemy.y);
      this._updateSelectionRing(gfx, enemy, id === this._selectedEnemyId);
      if (!enemy.alive) {
        gfx.hpBar.setVisible(false);
        const hasLoot = !enemy.looted && (enemy.lootGold > 0 || enemy.lootItems.length > 0);
        gfx.circle.setFillStyle(hasLoot ? CORPSE_LOOTABLE_COLOR : DEAD_COLOR);
        if (hasLoot && myPlayer) {
          const dx = myPlayer.x - enemy.x;
          const dy = myPlayer.y - enemy.y;
          gfx.lootHint.setPosition(enemy.x, enemy.y + 22);
          gfx.lootHint.setVisible(Math.sqrt(dx * dx + dy * dy) < CHEST_LOOT_RANGE_PX);
        } else {
          gfx.lootHint.setVisible(false);
        }
      } else {
        this._updateHpBar(gfx.hpBar, enemy.x, enemy.y, enemy.hp, enemy.maxHp);
        gfx.lootHint.setVisible(false);
      }
      const depth = enemy.elevation === 1 ? DEPTH_ELEVATED_ENTITY : DEPTH_GROUND_ENTITY;
      gfx.circle.setDepth(depth);
      gfx.hpBar.setDepth(depth + 1);
    }

    // Door visuals — redraw on locked-state change. Currently no runtime
    // mutation source exists; the per-tick repaint is the wiring for when
    // lever/key mechanics land. Cheap (4 doors max on floor 2).
    for (const [, { gfx, doorState }] of this._doorGfx) {
      drawDoorBand(gfx, doorState);
    }
  }

  _tryInteractNearby() {
    if (!this._room) return;
    const myPlayer = this._room.state.players.get(this._room.sessionId);
    if (!myPlayer) return;

    // Find the closest interactable — chest, corpse, or unlocked stair — in range.
    let bestKind = null;
    let bestId   = null;
    let bestDist = CHEST_LOOT_RANGE_PX;

    for (const [id, { chestState }] of this._chestGfx) {
      if (chestState.open) continue;
      const dx = myPlayer.x - chestState.x;
      const dy = myPlayer.y - chestState.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; bestKind = 'chest'; bestId = id; }
    }

    for (const [id, enemy] of this._room.state.enemies) {
      if (enemy.alive || enemy.looted) continue;
      if (enemy.lootGold === 0 && enemy.lootItems.length === 0) continue;
      const dx = myPlayer.x - enemy.x;
      const dy = myPlayer.y - enemy.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; bestKind = 'corpse'; bestId = id; }
    }

    for (const [id, { stairState }] of this._stairGfx) {
      if (stairState.locked) continue;
      const dx = myPlayer.x - stairState.x;
      const dy = myPlayer.y - stairState.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; bestKind = 'stair'; bestId = id; }
    }

    if (bestKind === 'chest' || bestKind === 'corpse') {
      // Defensive: input gating should prevent F while a scene is up, but
      // skip-if-active is cheap insurance against double launches.
      if (this.scene.isActive('InventoryScene')) return;
      this.scene.launch('InventoryScene', { lootSource: { kind: bestKind, id: bestId } });
      return;
    }
    if (bestKind === 'stair') sendDescend(bestId);
  }

  _toggleInventory() {
    if (this.scene.isActive('InventoryScene')) {
      this.scene.stop('InventoryScene');
    } else {
      this.scene.launch('InventoryScene', {});
    }
    // _input.enabled is derived from scene state in update(), no need to set here.
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Apply floor-level layout: redraw the room background and reset camera
   * bounds for the new floor's dimensions. Entity gfx are NOT touched here —
   * the server's MapSchema clear/repopulate fires onRemove/onAdd, which the
   * registered handlers translate into per-entity destroy/create.
   */
  _applyFloorLayout(floorNumber) {
    const floor = FLOOR_REGISTRY[floorNumber];
    if (!floor) {
      console.warn(`[DungeonScene] no FLOOR_REGISTRY entry for floor ${floorNumber}`);
      return;
    }
    if (this._roomGfx) this._roomGfx.destroy();
    this._roomGfx      = drawRoom(this, floor);
    this._currentFloor = floorNumber;
    this.cameras.main.setBounds(0, 0, floor.width, floor.height);
  }

  _createDoorGfx(id, doorState) {
    const gfx = this.add.graphics().setDepth(0.5); // above platforms, below entities
    drawDoorBand(gfx, doorState);
    this._doorGfx.set(id, { gfx, doorState });
  }

  _destroyDoorGfx(id) {
    const e = this._doorGfx.get(id);
    if (!e) return;
    e.gfx.destroy();
    this._doorGfx.delete(id);
  }

  _createChestGfx(id, chestState) {
    const { x, y } = chestState;
    const gfx = this.add.graphics();
    gfx.fillStyle(0xaa6600);
    gfx.fillRect(x - 20, y - 14, 40, 28);
    gfx.lineStyle(2, 0xffcc44);
    gfx.strokeRect(x - 20, y - 14, 40, 28);
    gfx.setDepth(1);
    this.add.text(x, y - 26, 'Chest', { fontSize: '11px', color: '#ccaa55', fontFamily: 'monospace' }).setOrigin(0.5).setDepth(1);
    const hint = this.add.text(x, y + 22, 'F: Loot', { fontSize: '11px', color: '#aaffaa', fontFamily: 'monospace' })
      .setOrigin(0.5).setDepth(1).setVisible(false);
    this._chestGfx.set(id, { gfx, hint, chestState });
  }

  _createTrapGfx(id, trapState) {
    const gfx = this.add.graphics().setDepth(1);
    this._drawTrapDiamond(gfx, trapState.x, trapState.y, true);
    const warnText = this.add.text(trapState.x, trapState.y - 24, '! Spike Trap', {
      fontSize: '10px', color: '#ff4444', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(1);
    this._trapGfx.set(id, { gfx, warnText, trapState });
  }

  _createStairGfx(id, stairState) {
    const { x, y } = stairState;
    const gfx = this.add.graphics().setDepth(1);
    this._drawStairBox(gfx, stairState);
    const label = this.add.text(x, y - 26, stairState.locked ? 'Stairs (locked)' : 'Stairs ↓', {
      fontSize: '11px', color: stairState.locked ? '#666688' : '#ffaa55', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(1);
    const hint = this.add.text(x, y + 22, 'F: Descend', {
      fontSize: '11px', color: '#aaffaa', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(1).setVisible(false);
    this._stairGfx.set(id, { gfx, label, hint, stairState });
  }

  _drawStairBox(gfx, stairState) {
    gfx.clear();
    const fill   = stairState.locked ? 0x222236 : 0x553311;
    const border = stairState.locked ? 0x444466 : 0xff9933;
    gfx.fillStyle(fill);
    gfx.fillRect(stairState.x - 20, stairState.y - 14, 40, 28);
    gfx.lineStyle(2, border);
    gfx.strokeRect(stairState.x - 20, stairState.y - 14, 40, 28);
    // Down arrow inside the box
    gfx.fillStyle(border);
    gfx.fillTriangle(
      stairState.x - 7, stairState.y - 4,
      stairState.x + 7, stairState.y - 4,
      stairState.x,     stairState.y + 7,
    );
  }

  _destroyChestGfx(id) {
    const e = this._chestGfx.get(id);
    if (!e) return;
    e.gfx.destroy();
    e.hint.destroy();
    this._chestGfx.delete(id);
  }

  _destroyTrapGfx(id) {
    const e = this._trapGfx.get(id);
    if (!e) return;
    e.gfx.destroy();
    e.warnText.destroy();
    this._trapGfx.delete(id);
  }

  _destroyStairGfx(id) {
    const e = this._stairGfx.get(id);
    if (!e) return;
    e.gfx.destroy();
    e.label.destroy();
    e.hint.destroy();
    this._stairGfx.delete(id);
  }

  _drawTrapDiamond(gfx, x, y, active) {
    const color = active ? 0xff3333 : 0x552222;
    const border = active ? 0xff8888 : 0x774444;
    const s = 13;
    gfx.fillStyle(color);
    gfx.fillTriangle(x, y - s, x + s, y, x - s, y);  // top half
    gfx.fillTriangle(x, y + s, x + s, y, x - s, y);  // bottom half
    gfx.lineStyle(1, border);
    gfx.beginPath();
    gfx.moveTo(x, y - s);
    gfx.lineTo(x + s, y);
    gfx.lineTo(x, y + s);
    gfx.lineTo(x - s, y);
    gfx.closePath();
    gfx.strokePath();
  }

  _createEntityGfx(id, entityState, kind) {
    const radius = kind === 'player' ? PLAYER_RADIUS : ENEMY_RADIUS;
    const color  = kind === 'player' ? PLAYER_COLOR  : ENEMY_COLOR;
    const circle = this.add.arc(entityState.x, entityState.y, radius, 0, 360);
    circle.setFillStyle(color).setDepth(2);
    const hpBar = this.add.graphics().setDepth(3);
    if (kind === 'enemy') {
      // Corpse loot hint — hidden until the enemy dies, has loot, and player is in range.
      const lootHint = this.add.text(entityState.x, entityState.y + 22, 'F: Loot', {
        fontSize: '11px', color: '#ffdd88', fontFamily: 'monospace',
      }).setOrigin(0.5).setDepth(1).setVisible(false);
      const selectionRing = this.add.graphics().setVisible(false);
      this._enemyGfx.set(id, { circle, hpBar, lootHint, selectionRing });
    } else {
      this._playerGfx.set(id, { circle, hpBar });
    }
  }

  _destroyEntityGfx(id, store) {
    const gfx = store.get(id);
    if (gfx) {
      gfx.circle.destroy();
      gfx.hpBar.destroy();
      gfx.lootHint?.destroy();
      gfx.selectionRing?.destroy();
      store.delete(id);
    }
  }

  _updateSelectionRing(gfx, enemy, selected) {
    if (!gfx.selectionRing) return;
    if (!selected) {
      gfx.selectionRing.setVisible(false);
      return;
    }
    const ring = gfx.selectionRing;
    ring.clear();
    ring.lineStyle(2, 0xffff44, 1);
    ring.strokeCircle(enemy.x, enemy.y, ENEMY_RADIUS + 4);
    ring.setDepth(enemy.elevation === 1 ? DEPTH_ELEVATED_ENTITY + 1 : DEPTH_GROUND_ENTITY + 1);
    ring.setVisible(true);
  }

  /**
   * Advance _selectedEnemyId to the next living enemy within MELEE_SELECT_RANGE_PX
   * of the local player, sorted by distance ascending. Wraps. No-op if no enemies
   * are in range.
   */
  _cycleTarget() {
    const me = this._room.state.players.get(this._room.sessionId);
    if (!me || !me.alive) return;
    // Range scales with equipped weapon: ranged weapons cycle up to long range,
    // melee/empty use the constant. Reading `type === 'ranged'` (not "has range")
    // keeps this future-safe for thrown weapons whose primary mode is still melee.
    const weapon = WEAPON_REGISTRY[me.equippedWeaponId];
    const cycleRange = (weapon?.type === 'ranged' && weapon.range)
      ? weapon.range.long
      : MELEE_SELECT_RANGE_PX;
    const candidates = [];
    for (const [id, enemy] of this._room.state.enemies) {
      if (!enemy.alive) continue;
      const dx = me.x - enemy.x;
      const dy = me.y - enemy.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d <= cycleRange) candidates.push({ id, d });
    }
    if (candidates.length === 0) { this._selectedEnemyId = null; return; }
    candidates.sort((a, b) => a.d - b.d);
    const currentIdx = candidates.findIndex(c => c.id === this._selectedEnemyId);
    const nextIdx    = currentIdx === -1 ? 0 : (currentIdx + 1) % candidates.length;
    this._selectedEnemyId = candidates[nextIdx].id;
  }

  /**
   * Render a projectile (cosmetic). The server has already resolved the to-hit;
   * we just tween something visible from from→to. `style` is a future-proof
   * discriminator — bolts, thrown daggers, firebolts, and magic missiles will
   * reuse this path with different sprites/colours.
   */
  _renderProjectile({ fromX, fromY, toX, toY, hit, style }) {
    const color = style === 'arrow' ? 0xeeddaa : 0xffffff;
    // Slight miss overshoot so a miss reads visually as flying past.
    const endX = hit ? toX : toX + (toX - fromX) * 0.15;
    const endY = hit ? toY : toY + (toY - fromY) * 0.15;
    const dot = this.add.circle(fromX, fromY, 3, color).setDepth(5);
    this.tweens.add({
      targets: dot,
      x: endX, y: endY,
      duration: 250,
      ease: 'Linear',
      onComplete: () => dot.destroy(),
    });
  }

  _updateHpBar(gfx, x, y, hp, maxHp) {
    gfx.clear();
    if (maxHp <= 0) return;
    const frac = Math.max(0, hp / maxHp);
    const bx   = x - HP_BAR_WIDTH / 2;
    const by   = y - HP_BAR_OFFSET_Y;
    gfx.fillStyle(0x330000);
    gfx.fillRect(bx, by, HP_BAR_WIDTH, HP_BAR_HEIGHT);
    const hpColor = frac > 0.5 ? 0x44cc44 : frac > 0.25 ? 0xffaa00 : 0xcc2222;
    gfx.fillStyle(hpColor);
    gfx.fillRect(bx, by, HP_BAR_WIDTH * frac, HP_BAR_HEIGHT);
  }

  // ── Run end ───────────────────────────────────────────────────────────────────

  _onRunComplete() {
    const player = this._room.state.players.get(this._room.sessionId);
    const items  = player ? this._collectItems(player) : [];
    const gold   = player?.gold ?? 0;

    const packLines = [];
    if (gold > 0) packLines.push(`· ${gold} gp`);
    if (items.length > 0) {
      packLines.push(...this._groupItems(items).map(({ label, qty }) => `· ${label}${qty > 1 ? `  ×${qty}` : ''}`));
    }
    if (packLines.length === 0) packLines.push('(nothing — only default class gear)');

    this._showRunSummary({
      title:      '── RUN COMPLETE ──',
      titleColor: '#88ffaa',
      bodyLines:  ['Extraction successful.', '', 'Extracting with:'],
      packLines,
    });
  }

  _onRunFailed() {
    this._showRunSummary({
      title:      '── RUN FAILED ──',
      titleColor: '#ff6666',
      bodyLines:  [`Your raider was slain by ${this._lastHitBy}.`, 'All carried items were lost.'],
      packLines:  [],
    });
  }

  _showRunSummary({ title, titleColor, bodyLines, packLines }) {
    this._input.enabled = false;
    if (this.scene.isActive('InventoryScene')) this.scene.stop('InventoryScene');
    if (this.scene.isActive('HUDScene'))       this.scene.stop('HUDScene');

    const SW = 1280, SH = 720;
    const PW = 560,  PH = 400;
    const PX = (SW - PW) / 2;
    const PY = (SH - PH) / 2;
    const D  = 22;

    const bg = this.add.graphics().setScrollFactor(0).setDepth(D);
    bg.fillStyle(0x000000, 0.78);
    bg.fillRect(0, 0, SW, SH);
    bg.fillStyle(0x12121e, 0.97);
    bg.fillRect(PX, PY, PW, PH);
    bg.lineStyle(1, 0x334466);
    bg.strokeRect(PX, PY, PW, PH);

    let ty = PY + 26;
    this.add.text(SW / 2, ty, title, {
      fontSize: '20px', color: titleColor, fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 1);
    ty += 38;

    for (const line of bodyLines) {
      if (line === '') { ty += 8; continue; }
      this.add.text(PX + 24, ty, line, {
        fontSize: '13px', color: '#aaaacc', fontFamily: 'monospace',
      }).setScrollFactor(0).setDepth(D + 1);
      ty += 18;
    }

    for (const line of packLines) {
      this.add.text(PX + 32, ty, line, {
        fontSize: '12px', color: line.startsWith('(') ? '#445566' : '#ffdd88', fontFamily: 'monospace',
      }).setScrollFactor(0).setDepth(D + 1);
      ty += 16;
    }

    this.add.text(SW / 2, PY + PH - 28, '[ click or press any key to return to hub ]', {
      fontSize: '12px', color: '#6688aa', fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 1);

    // Short delay so an accidental click doesn't immediately dismiss the summary.
    this.time.delayedCall(600, () => {
      this.input.once('pointerdown', () => this._exitToHub());
      this.input.keyboard.once('keydown', () => this._exitToHub());
    });
  }

  _collectItems(player) {
    const ids = [...player.inventory];
    if (player.equippedWeaponId && player.equippedWeaponId !== 'unarmed') ids.push(player.equippedWeaponId);
    if (player.offhandId)       ids.push(player.offhandId);
    if (player.equippedArmorId) ids.push(player.equippedArmorId);
    return ids;
  }

  _groupItems(ids) {
    const counts = {};
    for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    return Object.entries(counts).map(([id, qty]) => ({
      label: id.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
      qty,
    }));
  }

  async _exitToHub() {
    try { await leaveRoom(); } catch { /* ignore if already disconnected */ }
    this.scene.stop('HUDScene');
    this.scene.stop('InventoryScene');
    this.scene.start('HubScene', { view: 'stash' });
  }
}
