// client/src/scenes/HUDScene.js
// Persistent HUD overlay. Runs on top of DungeonScene with a fixed camera.
// Currently shows the attack cooldown timer. Expand here for HP bar, combat
// log, conditions, and other persistent HUD elements.
//
// ATTACK TIMER:
// A ring at the bottom-center of the screen fills clockwise over
// ATTACK_COOLDOWN_MS milliseconds. Full + green = ready to attack.
// The GDD specifies the timer should eventually live around the player sprite;
// this screen-space version is the HUD prototype.
// TODO: add a small arc around the player circle in DungeonScene when sprites land.

import { getRoom } from '../network/ColyseusClient.js';
import { ATTACK_COOLDOWN_MS } from '../../../shared/data/constants.js';

// Timer ring position in screen space (1280 × 720 viewport).
const CX = 640;
const CY = 668;
const RING_RADIUS = 34;
const RING_THICKNESS = 6;

export class HUDScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HUDScene' });
  }

  create() {
    // Fixed camera — HUD stays in screen space regardless of world scroll.
    this.cameras.main.setScroll(0, 0);

    this._ringGfx = this.add.graphics();

    // "ATK" label above the ring.
    this.add.text(CX, CY - RING_RADIUS - 10, 'ATK', {
      fontSize: '11px',
      color: '#aaaaaa',
      fontFamily: 'monospace',
    }).setOrigin(0.5, 1);

    // Status label below the ring: "READY" or countdown.
    this._statusLabel = this.add.text(CX, CY + RING_RADIUS + 8, 'READY', {
      fontSize: '11px',
      color: '#44ff44',
      fontFamily: 'monospace',
    }).setOrigin(0.5, 0);
  }

  update() {
    const room = getRoom();
    if (!room) return;

    const player = room.state.players.get(room.sessionId);
    if (!player) return;

    const cooldown = player.attackCooldownMs;
    // progress 0 = just attacked (empty ring), 1 = ready (full ring).
    const progress = Math.max(0, Math.min(1, 1 - cooldown / ATTACK_COOLDOWN_MS));
    const ready = cooldown <= 0;

    this._drawRing(progress, ready);

    if (ready) {
      this._statusLabel.setText('READY').setColor('#44ff44');
    } else {
      const secs = (cooldown / 1000).toFixed(1);
      this._statusLabel.setText(`${secs}s`).setColor('#ffaa44');
    }
  }

  /** @param {number} progress - 0..1 fill fraction */
  _drawRing(progress, ready) {
    const gfx = this._ringGfx;
    gfx.clear();

    // Background ring.
    gfx.lineStyle(RING_THICKNESS, 0x222233);
    gfx.strokeCircle(CX, CY, RING_RADIUS);

    if (progress <= 0) return;

    // Filled arc: clockwise from 12 o'clock (-π/2).
    const startAngle = -Math.PI / 2;
    const endAngle   = startAngle + progress * Math.PI * 2;

    // Color shifts from orange → yellow → green as it fills.
    let color;
    if (ready) {
      color = 0x44ff44;
    } else if (progress > 0.6) {
      color = 0xaaee44;
    } else if (progress > 0.3) {
      color = 0xffcc00;
    } else {
      color = 0xff7722;
    }

    gfx.lineStyle(RING_THICKNESS, color);
    gfx.beginPath();
    gfx.arc(CX, CY, RING_RADIUS, startAngle, endAngle, false);
    gfx.strokePath();

    // Small dot at the tip of the arc to soften the hard end.
    if (!ready && progress > 0.02) {
      const dotX = CX + Math.cos(endAngle) * RING_RADIUS;
      const dotY = CY + Math.sin(endAngle) * RING_RADIUS;
      gfx.fillStyle(color);
      gfx.fillCircle(dotX, dotY, RING_THICKNESS / 2);
    }
  }
}
