// client/src/ui/hub/feedback.js
// Lightweight floating-text feedback for hub mutations (buy/craft/sell).
// Text objects are created on the scene root (not registered in _leftObjs),
// so they survive the panel refresh that follows a successful mutation.

import { ITEM_META, RP } from './hub-data.js';

function floatText(scene, x, y, label, color, originX = 1) {
  const t = scene.add.text(x, y, label, {
    fontSize: '12px', color, fontFamily: 'monospace',
  }).setOrigin(originX, 0);
  scene.tweens.add({
    targets: t,
    y: y - 24,
    alpha: { from: 1, to: 0 },
    duration: 1500,
    ease: 'Sine.easeOut',
    onComplete: () => t.destroy(),
  });
}

export function flashItemGain(scene, x, y, itemId, qty = 1) {
  const meta = ITEM_META[itemId] ?? { label: itemId };
  floatText(scene, x, y - 4, `+${qty} ${meta.label} → Stash`, '#88ff88');
}

export function flashItemLoss(scene, x, y, itemId, qty = 1) {
  const meta = ITEM_META[itemId] ?? { label: itemId };
  floatText(scene, x, y - 4, `-${qty} ${meta.label}`, '#ff9999');
}

export function flashGoldDelta(scene, amount) {
  if (!amount) return;
  const sign  = amount > 0 ? '+' : '';
  const color = amount > 0 ? '#88ff88' : '#ff9999';
  const t = scene.add.text(RP.x + RP.w, 62, `${sign}${amount} gp`, {
    fontSize: '13px', color, fontFamily: 'monospace',
  }).setOrigin(1, 0);
  scene.tweens.add({
    targets: t,
    y: 82,
    alpha: { from: 1, to: 0 },
    duration: 1500,
    ease: 'Sine.easeOut',
    onComplete: () => t.destroy(),
  });
}
