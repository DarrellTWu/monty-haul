// client/src/ui/level-up/LevelUpModal.js
// Multiclass-pick modal shown after descend while player.pendingLevelUp is true.
// Overlays the DungeonScene viewport (not its own scene — avoids scene-switch
// teardown). Caller owns lifetime: openLevelUpModal returns a handle with a
// destroy() method; close it when state.pendingLevelUp clears.
//
// Uses screen-space (setScrollFactor(0)) so it sits over the camera regardless
// of player position.

import { CLASS_REGISTRY } from '../../../../shared/data/classes/index.js';
import { HP_MULTIPLIER }  from '../../../../shared/data/constants.js';
import { getModifier }    from '../../../../shared/logic/combat.js';
import { sendChooseLevelUp } from '../../network/ColyseusClient.js';

const W = 720;
const H = 360;
const COLS = 3;

/**
 * Open the level-up modal. `eligibleClassIds` lists the classes the player
 * may choose from (server is authoritative; client filters its own untaken
 * set for the preview). Returns { destroy }.
 */
export function openLevelUpModal(scene, { player, eligibleClassIds, newTotalLevel }) {
  const cam = scene.cameras.main;
  const cx  = cam.width / 2;
  const cy  = cam.height / 2;
  const x0  = cx - W / 2;
  const y0  = cy - H / 2;

  const refs = [];
  const _l = (obj) => { refs.push(obj); return obj; };

  // Dimmer.
  const dimmer = _l(scene.add.rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.55))
    .setScrollFactor(0).setDepth(1000).setInteractive();
  // Swallow clicks behind the modal.
  dimmer.on('pointerdown', () => {});

  // Frame.
  const frame = _l(scene.add.graphics()).setScrollFactor(0).setDepth(1001);
  frame.fillStyle(0x111826, 0.96);
  frame.fillRoundedRect(x0, y0, W, H, 12);
  frame.lineStyle(2, 0x4488ff, 0.9);
  frame.strokeRoundedRect(x0, y0, W, H, 12);

  // Title.
  _l(scene.add.text(cx, y0 + 22, `Level ${newTotalLevel}`, {
    fontSize: '20px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
  })).setOrigin(0.5).setScrollFactor(0).setDepth(1002);
  _l(scene.add.text(cx, y0 + 48, 'Choose a class to multiclass into.', {
    fontSize: '12px', color: '#aaccdd', fontFamily: 'monospace',
  })).setOrigin(0.5).setScrollFactor(0).setDepth(1002);

  // Cards.
  const cardW = 200;
  const cardH = 220;
  const gap   = 16;
  const totalRowW = COLS * cardW + (COLS - 1) * gap;
  const rowX0 = cx - totalRowW / 2;
  const rowY  = y0 + 80;

  const conMod = getModifier(player.con);

  eligibleClassIds.slice(0, COLS).forEach((classId, i) => {
    const def = CLASS_REGISTRY[classId];
    if (!def) return;
    const cardX = rowX0 + i * (cardW + gap);

    const card = _l(scene.add.graphics()).setScrollFactor(0).setDepth(1002);
    const repaint = (hover) => {
      card.clear();
      card.fillStyle(hover ? 0x223355 : 0x182032, 1);
      card.fillRoundedRect(cardX, rowY, cardW, cardH, 8);
      card.lineStyle(2, hover ? 0xffcc44 : 0x3355aa, 1);
      card.strokeRoundedRect(cardX, rowY, cardW, cardH, 8);
    };
    repaint(false);

    // Hit zone (must be a separate rect so we get pointer events).
    const hit = _l(scene.add.rectangle(cardX + cardW / 2, rowY + cardH / 2, cardW, cardH, 0xffffff, 0.001))
      .setScrollFactor(0).setDepth(1003).setInteractive({ useHandCursor: true });

    let ty = rowY + 16;
    _l(scene.add.text(cardX + cardW / 2, ty, def.name ?? classId, {
      fontSize: '18px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
    })).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1003);
    ty += 28;

    const hpGain = Math.floor((def.hitDie / 2 + 1 + conMod) * HP_MULTIPLIER);
    _l(scene.add.text(cardX + cardW / 2, ty, `Hit die d${def.hitDie}  ·  +${hpGain} HP`, {
      fontSize: '12px', color: '#aaccdd', fontFamily: 'monospace',
    })).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1003);
    ty += 22;

    const features = def.levels?.[1]?.features ?? [];
    const grants   = def.levels?.[1]?.grants ?? {};
    const lines = [];
    if (features.length) lines.push(`Features: ${features.join(', ')}`);
    if (grants.fightingStyle) lines.push(`Style: ${grants.fightingStyle}`);
    if (def.unarmoredDefense)  lines.push(`Unarmored Defense (${def.unarmoredDefense.toUpperCase()})`);
    if (def.canClimb)          lines.push('Can climb platforms');
    if (def.rageUses)          lines.push(`Rage ×${def.rageUses} / rest`);
    if (lines.length === 0)    lines.push('(no level-1 active features)');

    for (const ln of lines) {
      _l(scene.add.text(cardX + 12, ty, `· ${ln}`, {
        fontSize: '11px', color: '#ccddee', fontFamily: 'monospace',
        wordWrap: { width: cardW - 24 },
      })).setScrollFactor(0).setDepth(1003);
      ty += 32;
    }

    hit.on('pointerover', () => repaint(true));
    hit.on('pointerout',  () => repaint(false));
    hit.on('pointerdown', () => {
      // Server clears pendingLevelUp on accept; the caller's state watcher
      // then closes the modal. Optimistically disable the hit rect so a
      // double-click doesn't queue a second send.
      hit.disableInteractive();
      sendChooseLevelUp(classId);
    });
  });

  return {
    destroy() {
      for (const r of refs) r.destroy();
      refs.length = 0;
    },
  };
}
