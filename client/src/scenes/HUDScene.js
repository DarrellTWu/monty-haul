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

// Condition rings — stacked to the left of the attack ring.
const BLESS_CX           = ATK_CX - (RING_RADIUS * 2 + RING_GAP);
const LONGSTRIDER_CX     = BLESS_CX - (RING_RADIUS * 2 + RING_GAP);
const FALSE_LIFE_CX      = LONGSTRIDER_CX - (RING_RADIUS * 2 + RING_GAP);

const BLESS_DURATION      = BLESS_POTION.conditionDurationMs;
const LONGSTRIDER_DURATION = LONGSTRIDER_POTION.conditionDurationMs;
const FALSE_LIFE_DURATION  = FALSE_LIFE_POTION.conditionDurationMs;

const BLESS_COLOR       = 0xaa55ff;   const BLESS_DIM       = 0x221133;
const LONGSTRIDER_COLOR = 0x44ddff;   const LONGSTRIDER_DIM = 0x112233;
const FALSE_LIFE_COLOR  = 0x55eebb;   const FALSE_LIFE_DIM  = 0x113322;

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

    // ── Condition rings (left of attack ring, order: BLS · SPD · THP) ─────────
    this._blessRingGfx      = this.add.graphics();
    this._longstriderRingGfx = this.add.graphics();
    this._falseLifeRingGfx  = this.add.graphics();

    this._blessLabel = this.add.text(BLESS_CX, CY - RING_RADIUS - 8, 'BLS', {
      fontSize: '10px', color: '#aa55ff', fontFamily: 'monospace',
    }).setOrigin(0.5, 1);
    this._blessTimerLabel = this.add.text(BLESS_CX, CY + RING_RADIUS + 5, '', {
      fontSize: '10px', color: '#aa55ff', fontFamily: 'monospace',
    }).setOrigin(0.5, 0);
    this._blessLabel.setVisible(false);
    this._blessTimerLabel.setVisible(false);

    this._longstriderLabel = this.add.text(LONGSTRIDER_CX, CY - RING_RADIUS - 8, 'SPD', {
      fontSize: '10px', color: '#44ddff', fontFamily: 'monospace',
    }).setOrigin(0.5, 1);
    this._longstriderTimerLabel = this.add.text(LONGSTRIDER_CX, CY + RING_RADIUS + 5, '', {
      fontSize: '10px', color: '#44ddff', fontFamily: 'monospace',
    }).setOrigin(0.5, 0);
    this._longstriderLabel.setVisible(false);
    this._longstriderTimerLabel.setVisible(false);

    this._falseLifeLabel = this.add.text(FALSE_LIFE_CX, CY - RING_RADIUS - 8, 'THP', {
      fontSize: '10px', color: '#55eebb', fontFamily: 'monospace',
    }).setOrigin(0.5, 1);
    this._falseLifeTimerLabel = this.add.text(FALSE_LIFE_CX, CY + RING_RADIUS + 5, '', {
      fontSize: '10px', color: '#55eebb', fontFamily: 'monospace',
    }).setOrigin(0.5, 0);
    this._falseLifeLabel.setVisible(false);
    this._falseLifeTimerLabel.setVisible(false);

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

    // ── Condition rings ───────────────────────────────────────────────────────
    this._updateConditionRing({
      gfx: this._blessRingGfx, label: this._blessLabel, timerLabel: this._blessTimerLabel,
      cx: BLESS_CX, remainingMs: player.blessRemainingMs ?? 0,
      durationMs: BLESS_DURATION, color: BLESS_COLOR, dimColor: BLESS_DIM,
      timerText: (ms) => `${(ms / 1000).toFixed(0)}s`,
    });

    this._updateConditionRing({
      gfx: this._longstriderRingGfx, label: this._longstriderLabel, timerLabel: this._longstriderTimerLabel,
      cx: LONGSTRIDER_CX, remainingMs: player.longstriderRemainingMs ?? 0,
      durationMs: LONGSTRIDER_DURATION, color: LONGSTRIDER_COLOR, dimColor: LONGSTRIDER_DIM,
      timerText: (ms) => `${(ms / 1000).toFixed(0)}s`,
    });

    this._updateConditionRing({
      gfx: this._falseLifeRingGfx, label: this._falseLifeLabel, timerLabel: this._falseLifeTimerLabel,
      cx: FALSE_LIFE_CX, remainingMs: player.falseLifeRemainingMs ?? 0,
      durationMs: FALSE_LIFE_DURATION, color: FALSE_LIFE_COLOR, dimColor: FALSE_LIFE_DIM,
      timerText: (ms) => `${player.tempHp ?? 0}hp`,
    });

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

  /**
   * Update one condition ring: show/hide labels, draw drain arc.
   * @param {{ gfx, label, timerLabel, cx, remainingMs, durationMs, color, dimColor, timerText }} opts
   */
  _updateConditionRing({ gfx, label, timerLabel, cx, remainingMs, durationMs, color, dimColor, timerText }) {
    const active = remainingMs > 0;
    gfx.clear();
    label.setVisible(active);
    timerLabel.setVisible(active);

    // Dim track always drawn so the slot remains visible.
    gfx.lineStyle(RING_THICKNESS, dimColor);
    gfx.strokeCircle(cx, CY, RING_RADIUS);

    if (!active) return;

    const progress  = Math.max(0, Math.min(1, remainingMs / durationMs));
    const startAngle = -Math.PI / 2;
    const endAngle   = startAngle + progress * Math.PI * 2;

    gfx.lineStyle(RING_THICKNESS, color);
    gfx.beginPath();
    gfx.arc(cx, CY, RING_RADIUS, startAngle, endAngle, false);
    gfx.strokePath();

    if (progress > 0.02) {
      const dotX = cx + Math.cos(endAngle) * RING_RADIUS;
      const dotY = CY + Math.sin(endAngle) * RING_RADIUS;
      gfx.fillStyle(color);
      gfx.fillCircle(dotX, dotY, RING_THICKNESS / 2);
    }

    timerLabel.setText(timerText(remainingMs));
  }
}
