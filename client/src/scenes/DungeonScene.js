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

import { joinDungeon, sendLoot, sendUseHotbar } from '../network/ColyseusClient.js';
import { InputHandler } from '../input/InputHandler.js';
import { CHEST_LOOT_RANGE_PX, TRAP_RADIUS_PX } from '../../../shared/data/constants.js';
import { getRaiderPackFlat, setRaiderPack } from '../store/stash.js';

// Visual config — swap these out when sprites land.
const PLAYER_RADIUS   = 16;
const ENEMY_RADIUS    = 12;
const PLAYER_COLOR    = 0x4488ff;
const ENEMY_COLOR     = 0x44cc44;
const DEAD_COLOR      = 0x444444;
const HP_BAR_WIDTH    = 32;
const HP_BAR_HEIGHT   = 5;
const HP_BAR_OFFSET_Y = 22;

// Room dimensions must match DungeonRoom.js server constants.
const ROOM_WIDTH  = 1600;
const ROOM_HEIGHT = 1200;
const WALL        = 40;

export class DungeonScene extends Phaser.Scene {
  constructor() {
    super({ key: 'DungeonScene' });
  }

  init(data) {
    this._joinOpts = { ...(data ?? {}), items: getRaiderPackFlat() };
  }

  async create() {
    this._room      = null;
    this._playerGfx = new Map();  // sessionId → { circle, hpBar }
    this._enemyGfx  = new Map();  // enemyId   → { circle, hpBar }
    this._chestGfx  = new Map();  // chestId   → { gfx, hint, chestState }
    this._trapGfx   = new Map();  // trapId    → { gfx, trapState }
    this._input     = null;
    this._runEnded  = false;
    this._lastHitBy = 'an enemy';

    this._drawRoom();

    this._statusText = this.add.text(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 'Connecting…', {
      fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5);

    try {
      this._room = await joinDungeon(this._joinOpts);
      this._statusText.destroy();
      this._statusText = null;
    } catch (err) {
      this._statusText.setText(`Connection failed:\n${err.message}`);
      console.error('[DungeonScene] Failed to join room:', err);
      return;
    }

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

    this._room.state.chests.onAdd((chest, id) => {
      this._createChestGfx(id, chest);
    });

    this._room.state.traps.onAdd((trap, id) => {
      this._createTrapGfx(id, trap);
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

    // Input.
    this._input = new InputHandler(this);
    this._input.onInventoryDown = () => this._toggleInventory();
    this._input.onInteract      = () => this._tryLootNearbyChest();
    this._input.onHotbar        = (slot) => sendUseHotbar(slot);

    this.cameras.main.setBounds(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    this.scene.launch('HUDScene');

    this._room.state.onChange(() => {
      if (this._room.state.phase === 'complete' && !this._runEnded) {
        this._runEnded = true;
        this._onRunComplete();
      }
    });
  }

  update() {
    if (!this._room) return;

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

    // Enemy visuals.
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

  _tryLootNearbyChest() {
    if (!this._room) return;
    const myPlayer = this._room.state.players.get(this._room.sessionId);
    if (!myPlayer) return;
    for (const [id, { chestState }] of this._chestGfx) {
      if (chestState.open) continue;
      const dx = myPlayer.x - chestState.x;
      const dy = myPlayer.y - chestState.y;
      if (Math.sqrt(dx * dx + dy * dy) < CHEST_LOOT_RANGE_PX) {
        sendLoot(id);
        break;
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
    gfx.fillStyle(0x2a2a3a);
    gfx.fillRect(WALL, WALL, ROOM_WIDTH - WALL * 2, ROOM_HEIGHT - WALL * 2);
    gfx.fillStyle(0x111118);
    gfx.fillRect(0, 0, ROOM_WIDTH, WALL);
    gfx.fillRect(0, ROOM_HEIGHT - WALL, ROOM_WIDTH, WALL);
    gfx.fillRect(0, 0, WALL, ROOM_HEIGHT);
    gfx.fillRect(ROOM_WIDTH - WALL, 0, WALL, ROOM_HEIGHT);
    gfx.lineStyle(2, 0x5555aa);
    gfx.strokeRect(WALL, WALL, ROOM_WIDTH - WALL * 2, ROOM_HEIGHT - WALL * 2);
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
    const store  = kind === 'player' ? this._playerGfx : this._enemyGfx;
    store.set(id, { circle, hpBar });
  }

  _destroyEntityGfx(id, store) {
    const gfx = store.get(id);
    if (gfx) { gfx.circle.destroy(); gfx.hpBar.destroy(); store.delete(id); }
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
    setRaiderPack(items);
    const packLines = items.length === 0
      ? ['(nothing — only default class gear)']
      : this._groupItems(items).map(({ label, qty }) => `· ${label}${qty > 1 ? `  ×${qty}` : ''}`);
    this._showRunSummary({
      title:      '── RUN COMPLETE ──',
      titleColor: '#88ffaa',
      bodyLines:  ['All enemies defeated.', '', 'Extracting with:'],
      packLines,
    });
  }

  _onRunFailed() {
    setRaiderPack([]);
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
    try { await this._room?.leave(); } catch { /* ignore if already disconnected */ }
    this.scene.stop('HUDScene');
    this.scene.stop('InventoryScene');
    this.scene.start('HubScene', { view: 'stash' });
  }
}
