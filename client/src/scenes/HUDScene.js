// client/src/scenes/HUDScene.js
// Persistent HUD overlay. Runs on top of DungeonScene with a fixed camera.
// Shows: attack cooldown ring (bottom-center), condition rings (left of attack),
//        combat log (bottom-right).

import { getRoom } from '../network/ColyseusClient.js';
import { ATTACK_COOLDOWN_MS } from '../../../shared/data/constants.js';
import {
  BLESS_POTION, LONGSTRIDER_POTION, FALSE_LIFE_POTION,
} from '../../../shared/data/items/consumables.js';

// Attack timer ring — bottom-center.
const ATK_CX          = 640;
const CY              = 668;
const RING_RADIUS     = 17;
const RING_THICKNESS  = 3;
const RING_GAP        = 14; // px gap between ring edges

// Condition ring slot formula: cx(i) = ATK_CX - (i+1) * (RING_RADIUS*2 + RING_GAP)
// i=0 is the slot immediately left of ATK; filled newest-first from right.
// Fill the screen: compute how many slots fit before the left edge.
const MAX_CONDITION_SLOTS = Math.floor((ATK_CX - RING_RADIUS) / (RING_RADIUS * 2 + RING_GAP));
const CONDITION_META = {
  bless: {
    label: 'BLS', color: 0xaa55ff, dimColor: 0x221133, colorHex: '#aa55ff',
    durationMs:  BLESS_POTION.conditionDurationMs,
    getRemaining: (p) => p.blessRemainingMs       ?? 0,
    timerText:    (p) => `${((p.blessRemainingMs ?? 0) / 1000).toFixed(0)}s`,
  },
  longstrider: {
    label: 'SPD', color: 0x44ddff, dimColor: 0x112233, colorHex: '#44ddff',
    durationMs:  LONGSTRIDER_POTION.conditionDurationMs,
    getRemaining: (p) => p.longstriderRemainingMs ?? 0,
    timerText:    (p) => `${((p.longstriderRemainingMs ?? 0) / 1000).toFixed(0)}s`,
  },
  false_life: {
    label: 'THP', color: 0x55eebb, dimColor: 0x113322, colorHex: '#55eebb',
    durationMs:  FALSE_LIFE_POTION.conditionDurationMs,
    getRemaining: (p) => p.falseLifeRemainingMs   ?? 0,
    timerText:    (p) => `${p.tempHp ?? 0}hp`,
  },
};

// Hotbar display — to the right of the attack ring.
const HOTBAR_X      = ATK_CX + RING_RADIUS + RING_GAP;  // 671
const HOTBAR_Y      = CY - 16;
const HOTBAR_SLOT_W = 56;
const HOTBAR_SLOT_H = 32;
const HOTBAR_GAP    = 2;
const KEYS          = ['1','2','3','4','5','6','7','8','9','0'];

// Short display labels for hotbar items.
const HOTBAR_SHORT = {
  second_wind:        '2nd Wind',
  healing_potion:     'Heal Pot',
  bless_potion:       'Bless',
  longstrider_potion: 'Stride',
  false_life_potion:  'F.Life',
};

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
    this._atkRingGfx = this.add.graphics();

    this.add.text(ATK_CX, CY - RING_RADIUS - 8, 'ATK', {
      fontSize: '10px', color: '#aaaaaa', fontFamily: 'monospace',
    }).setOrigin(0.5, 1);

    this._statusLabel = this.add.text(ATK_CX, CY + RING_RADIUS + 5, 'READY', {
      fontSize: '10px', color: '#44ff44', fontFamily: 'monospace',
    }).setOrigin(0.5, 0);

    // ── Condition ring pool (dynamically filled left of attack ring) ──────────
    // Slots are assigned newest-first from right; unused slots are invisible.
    this._conditionPool = Array.from({ length: MAX_CONDITION_SLOTS }, () => ({
      gfx:        this.add.graphics(),
      label:      this.add.text(0, 0, '', { fontSize: '10px', fontFamily: 'monospace' }).setOrigin(0.5, 1).setVisible(false),
      timerLabel: this.add.text(0, 0, '', { fontSize: '10px', fontFamily: 'monospace' }).setOrigin(0.5, 0).setVisible(false),
    }));

    // ── Hotbar display (right of attack ring) ─────────────────────────────────
    this._hotbarSlotLabels = [];
    for (let i = 0; i < 10; i++) {
      const sx = HOTBAR_X + i * (HOTBAR_SLOT_W + HOTBAR_GAP);

      // Slot background.
      const bg = this.add.graphics();
      bg.fillStyle(0x0a0a14, 0.85);
      bg.fillRect(sx, HOTBAR_Y, HOTBAR_SLOT_W, HOTBAR_SLOT_H);
      bg.lineStyle(1, 0x223344, 0.8);
      bg.strokeRect(sx, HOTBAR_Y, HOTBAR_SLOT_W, HOTBAR_SLOT_H);

      // Key label.
      this.add.text(sx + 3, HOTBAR_Y + 3, `[${KEYS[i]}]`, {
        fontSize: '9px', color: '#445566', fontFamily: 'monospace',
      });

      // Item label (updated in update()).
      const itemLabel = this.add.text(sx + HOTBAR_SLOT_W / 2, HOTBAR_Y + HOTBAR_SLOT_H - 9, '—', {
        fontSize: '10px', color: '#334455', fontFamily: 'monospace',
      }).setOrigin(0.5, 0);

      this._hotbarSlotLabels.push(itemLabel);
    }

    // ── Combat log ────────────────────────────────────────────────────────────
    this._logLines = [];

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

    // ── Attack ring ──────────────────────────────────────────────────────────
    const cooldown = player.attackCooldownMs;
    const progress = Math.max(0, Math.min(1, 1 - cooldown / ATTACK_COOLDOWN_MS));
    const ready    = cooldown <= 0;

    this._drawAtkRing(progress, ready);

    if (ready) {
      this._statusLabel.setText('READY').setColor('#44ff44');
    } else {
      this._statusLabel.setText(`${(cooldown / 1000).toFixed(1)}s`).setColor('#ffaa44');
    }

    // ── Condition rings (dynamic, newest-first from right) ───────────────────
    // Reverse so index 0 = most recently activated = rightmost slot.
    const activeConditions = player.conditions ? [...player.conditions].reverse() : [];
    for (let i = 0; i < this._conditionPool.length; i++) {
      const { gfx, label, timerLabel } = this._conditionPool[i];
      const meta = CONDITION_META[activeConditions[i]];
      if (!meta) {
        gfx.clear();
        label.setVisible(false);
        timerLabel.setVisible(false);
        continue;
      }
      const cx          = ATK_CX - (i + 1) * (RING_RADIUS * 2 + RING_GAP);
      const remainingMs = meta.getRemaining(player);
      const progress    = Math.max(0, Math.min(1, remainingMs / meta.durationMs));
      const startAngle  = -Math.PI / 2;
      const endAngle    = startAngle + progress * Math.PI * 2;

      label.setPosition(cx, CY - RING_RADIUS - 8).setText(meta.label).setColor(meta.colorHex).setVisible(true);
      timerLabel.setPosition(cx, CY + RING_RADIUS + 5).setText(meta.timerText(player)).setColor(meta.colorHex).setVisible(true);

      gfx.clear();
      gfx.lineStyle(RING_THICKNESS, meta.dimColor);
      gfx.strokeCircle(cx, CY, RING_RADIUS);
      gfx.lineStyle(RING_THICKNESS, meta.color);
      gfx.beginPath();
      gfx.arc(cx, CY, RING_RADIUS, startAngle, endAngle, false);
      gfx.strokePath();
      if (progress > 0.02) {
        gfx.fillStyle(meta.color);
        gfx.fillCircle(cx + Math.cos(endAngle) * RING_RADIUS, CY + Math.sin(endAngle) * RING_RADIUS, RING_THICKNESS / 2);
      }
    }

    // ── Hotbar display ────────────────────────────────────────────────────────
    for (let i = 0; i < 10; i++) {
      const binding = player.hotbar?.[i] ?? '';
      const label   = this._hotbarSlotLabels[i];
      if (!label) continue;
      if (binding) {
        label.setText(HOTBAR_SHORT[binding] ?? binding).setColor('#ffdd88');
      } else {
        label.setText('—').setColor('#334455');
      }
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

  // ── Private drawing ───────────────────────────────────────────────────────────

  _drawAtkRing(progress, ready) {
    const gfx = this._atkRingGfx;
    gfx.clear();

    gfx.lineStyle(RING_THICKNESS, 0x222233);
    gfx.strokeCircle(ATK_CX, CY, RING_RADIUS);

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
    gfx.arc(ATK_CX, CY, RING_RADIUS, startAngle, endAngle, false);
    gfx.strokePath();

    if (!ready && progress > 0.02) {
      const dotX = ATK_CX + Math.cos(endAngle) * RING_RADIUS;
      const dotY = CY     + Math.sin(endAngle) * RING_RADIUS;
      gfx.fillStyle(color);
      gfx.fillCircle(dotX, dotY, RING_THICKNESS / 2);
    }
  }

}
