// client/src/scenes/HUDScene.js
// Persistent HUD overlay. Runs on top of DungeonScene with a fixed camera.
// Shows: attack cooldown ring (bottom-center), combat log (bottom-right).

import { getRoom } from '../network/ColyseusClient.js';
import { ATTACK_COOLDOWN_MS } from '../../../shared/data/constants.js';

// Attack timer ring — half-size from original design.
const CX             = 640;
const CY             = 668;
const RING_RADIUS    = 17;
const RING_THICKNESS = 3;

// Combat log — bottom-right, fixed screen space.
const LOG_X      = 738;
const LOG_Y      = 468;
const LOG_W      = 534;
const LOG_LINES  = 8;

export class HUDScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HUDScene' });
  }

  create() {
    this.cameras.main.setScroll(0, 0);

    // ── Attack ring ───────────────────────────────────────────────────────────
    this._ringGfx = this.add.graphics();

    this.add.text(CX, CY - RING_RADIUS - 8, 'ATK', {
      fontSize: '10px', color: '#aaaaaa', fontFamily: 'monospace',
    }).setOrigin(0.5, 1);

    this._statusLabel = this.add.text(CX, CY + RING_RADIUS + 5, 'READY', {
      fontSize: '10px', color: '#44ff44', fontFamily: 'monospace',
    }).setOrigin(0.5, 0);

    // ── Combat log ────────────────────────────────────────────────────────────
    this._logLines = [];

    // Dark background panel.
    const logBg = this.add.graphics();
    logBg.fillStyle(0x000000, 0.55);
    logBg.fillRect(LOG_X, LOG_Y, LOG_W, LOG_LINES * 15 + 10);
    logBg.setDepth(4);

    this._logText = this.add.text(LOG_X + 5, LOG_Y + 5, '', {
      fontSize: '11px',
      color: '#cccccc',
      fontFamily: 'monospace',
      wordWrap: { width: LOG_W - 10, useAdvancedWrap: false },
    }).setDepth(5).setOrigin(0, 0);
  }

  update() {
    const room = getRoom();
    if (!room) return;
    const player = room.state.players.get(room.sessionId);
    if (!player) return;

    const cooldown = player.attackCooldownMs;
    const progress = Math.max(0, Math.min(1, 1 - cooldown / ATTACK_COOLDOWN_MS));
    const ready    = cooldown <= 0;

    this._drawRing(progress, ready);

    if (ready) {
      this._statusLabel.setText('READY').setColor('#44ff44');
    } else {
      this._statusLabel.setText(`${(cooldown / 1000).toFixed(1)}s`).setColor('#ffaa44');
    }
  }

  /**
   * Add a line to the combat log. Called by DungeonScene when a 'combat_log'
   * message arrives from the server.
   * @param {string} message
   */
  addLog(message) {
    this._logLines.push(message);
    if (this._logLines.length > LOG_LINES) this._logLines.shift();
    this._logText.setText(this._logLines.join('\n'));
  }

  _drawRing(progress, ready) {
    const gfx = this._ringGfx;
    gfx.clear();

    gfx.lineStyle(RING_THICKNESS, 0x222233);
    gfx.strokeCircle(CX, CY, RING_RADIUS);

    if (progress <= 0) return;

    const startAngle = -Math.PI / 2;
    const endAngle   = startAngle + progress * Math.PI * 2;

    let color;
    if      (ready)          color = 0x44ff44;
    else if (progress > 0.6) color = 0xaaee44;
    else if (progress > 0.3) color = 0xffcc00;
    else                     color = 0xff7722;

    gfx.lineStyle(RING_THICKNESS, color);
    gfx.beginPath();
    gfx.arc(CX, CY, RING_RADIUS, startAngle, endAngle, false);
    gfx.strokePath();

    if (!ready && progress > 0.02) {
      const dotX = CX + Math.cos(endAngle) * RING_RADIUS;
      const dotY = CY + Math.sin(endAngle) * RING_RADIUS;
      gfx.fillStyle(color);
      gfx.fillCircle(dotX, dotY, RING_THICKNESS / 2);
    }
  }
}
