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
// When tilemaps arrive, replace _drawRoom() with a Tilemap layer.

import { joinDungeon } from '../network/ColyseusClient.js';
import { InputHandler } from '../input/InputHandler.js';

// Visual config — swap these out when sprites land.
const PLAYER_RADIUS = 16;
const ENEMY_RADIUS = 12;
const PLAYER_COLOR = 0x4488ff;   // blue
const ENEMY_COLOR = 0x44cc44;    // green (goblins)
const DEAD_COLOR = 0x444444;     // gray
const HP_BAR_WIDTH = 32;
const HP_BAR_HEIGHT = 5;
const HP_BAR_OFFSET_Y = 22;      // px above entity center

// Room dimensions must match DungeonRoom.js server constants.
// TODO: receive these from server state once room metadata is implemented.
const ROOM_WIDTH = 1600;
const ROOM_HEIGHT = 1200;
const WALL = 40;

export class DungeonScene extends Phaser.Scene {
  constructor() {
    super({ key: 'DungeonScene' });
  }

  async create() {
    this._room = null;
    this._playerGfx = new Map();  // sessionId → { circle, hpBar }
    this._enemyGfx = new Map();   // enemyId   → { circle, hpBar }
    this._input = null;

    // Draw the static room background.
    this._drawRoom();

    // Status text while connecting.
    this._statusText = this.add.text(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 'Connecting…', {
      fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5);

    try {
      this._room = await joinDungeon();
      this._statusText.destroy();
      this._statusText = null;
    } catch (err) {
      this._statusText.setText(`Connection failed:\n${err.message}`);
      console.error('[DungeonScene] Failed to join room:', err);
      return;
    }

    // Register handlers for entities being added/removed.
    this._room.state.players.onAdd((player, sessionId) => {
      this._createEntityGfx(sessionId, player, 'player');

      // Track own player with a different tint.
      if (sessionId === this._room.sessionId) {
        const gfx = this._playerGfx.get(sessionId);
        if (gfx) gfx.circle.setFillStyle(0xffcc00); // gold for self
      }
    });

    this._room.state.players.onRemove((player, sessionId) => {
      this._destroyEntityGfx(sessionId, this._playerGfx);
    });

    this._room.state.enemies.onAdd((enemy, id) => {
      this._createEntityGfx(id, enemy, 'enemy');
    });

    // Wire up keyboard input.
    this._input = new InputHandler(this);
    this._input.onTabDown = () => this._toggleInventory();

    // Camera: follow own player, clamped to room.
    this.cameras.main.setBounds(0, 0, ROOM_WIDTH, ROOM_HEIGHT);

    // Launch persistent HUD overlay (attack timer, future HUD elements).
    this.scene.launch('HUDScene');

    // Phase-complete message handler.
    this._room.state.onChange(() => {
      if (this._room.state.phase === 'complete' && !this._victoryText) {
        this._victoryText = this.add.text(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 'All enemies defeated!', {
          fontSize: '36px', color: '#ffff00', backgroundColor: '#000000',
        }).setOrigin(0.5).setDepth(10);
      }
    });
  }

  update() {
    if (!this._room) return;

    this._input?.update();

    const state = this._room.state;

    // Update player visuals from server state.
    for (const [sessionId, player] of state.players) {
      const gfx = this._playerGfx.get(sessionId);
      if (!gfx) continue;

      gfx.circle.setPosition(player.x, player.y);
      if (!player.alive) gfx.circle.setFillStyle(DEAD_COLOR);

      this._updateHpBar(gfx.hpBar, player.x, player.y, player.hp, player.maxHp);

      // Make camera follow own player.
      if (sessionId === this._room.sessionId) {
        this.cameras.main.centerOn(player.x, player.y);
      }
    }

    // Update enemy visuals from server state.
    for (const [id, enemy] of state.enemies) {
      const gfx = this._enemyGfx.get(id);
      if (!gfx) continue;

      gfx.circle.setPosition(enemy.x, enemy.y);
      if (!enemy.alive) {
        gfx.circle.setFillStyle(DEAD_COLOR);
        gfx.hpBar.setVisible(false);
      } else {
        this._updateHpBar(gfx.hpBar, enemy.x, enemy.y, enemy.hp, enemy.maxHp);
      }
    }
  }

  _toggleInventory() {
    if (this.scene.isActive('InventoryScene')) {
      this.scene.stop('InventoryScene');
      this._input.enabled = true;
    } else {
      this.scene.launch('InventoryScene');
      this._input.enabled = false;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  _drawRoom() {
    const gfx = this.add.graphics();

    // Floor
    gfx.fillStyle(0x2a2a3a);
    gfx.fillRect(WALL, WALL, ROOM_WIDTH - WALL * 2, ROOM_HEIGHT - WALL * 2);

    // Walls
    gfx.fillStyle(0x111118);
    gfx.fillRect(0, 0, ROOM_WIDTH, WALL);                          // top
    gfx.fillRect(0, ROOM_HEIGHT - WALL, ROOM_WIDTH, WALL);         // bottom
    gfx.fillRect(0, 0, WALL, ROOM_HEIGHT);                         // left
    gfx.fillRect(ROOM_WIDTH - WALL, 0, WALL, ROOM_HEIGHT);         // right

    // Wall border line
    gfx.lineStyle(2, 0x5555aa);
    gfx.strokeRect(WALL, WALL, ROOM_WIDTH - WALL * 2, ROOM_HEIGHT - WALL * 2);
  }

  /**
   * @param {string} id
   * @param {object} entityState - PlayerState or EnemyState
   * @param {'player'|'enemy'} kind
   */
  _createEntityGfx(id, entityState, kind) {
    const radius = kind === 'player' ? PLAYER_RADIUS : ENEMY_RADIUS;
    const color = kind === 'player' ? PLAYER_COLOR : ENEMY_COLOR;

    const circle = this.add.arc(entityState.x, entityState.y, radius, 0, 360);
    circle.setFillStyle(color);
    circle.setDepth(2);

    const hpBar = this.add.graphics();
    hpBar.setDepth(3);

    const store = kind === 'player' ? this._playerGfx : this._enemyGfx;
    store.set(id, { circle, hpBar });
  }

  _destroyEntityGfx(id, store) {
    const gfx = store.get(id);
    if (gfx) {
      gfx.circle.destroy();
      gfx.hpBar.destroy();
      store.delete(id);
    }
  }

  /**
   * Redraws an HP bar above the given position.
   * @param {Phaser.GameObjects.Graphics} gfx
   */
  _updateHpBar(gfx, x, y, hp, maxHp) {
    gfx.clear();
    if (maxHp <= 0) return;

    const frac = Math.max(0, hp / maxHp);
    const bx = x - HP_BAR_WIDTH / 2;
    const by = y - HP_BAR_OFFSET_Y;

    // Background
    gfx.fillStyle(0x330000);
    gfx.fillRect(bx, by, HP_BAR_WIDTH, HP_BAR_HEIGHT);

    // Health
    const hpColor = frac > 0.5 ? 0x44cc44 : frac > 0.25 ? 0xffaa00 : 0xcc2222;
    gfx.fillStyle(hpColor);
    gfx.fillRect(bx, by, HP_BAR_WIDTH * frac, HP_BAR_HEIGHT);
  }
}
