// client/src/ui/hub/StashPanel.js
// Stash tab on the left panel. Click a row to move to raider pack; click
// the inline [ Sell ] to convert to vault gold.

import { getStash, stashToRaider, sellItem } from '../../store/stash.js';
import { sellPrice } from '../../../../shared/data/values.js';
import { LP, ITEM_META, STASH_ORDER, STASH_SECTIONS } from './hub-data.js';
import { flashItemLoss, flashGoldDelta } from './feedback.js';
import { ScrollViewport } from '../ScrollViewport.js';

export function renderStashPanel(scene) {
  const stash = getStash();
  const x = LP.x + 20;

  // Panel chrome — fixed at top, not part of the scroll viewport.
  let chromeY = LP.y + 52;
  scene._l(scene.add.text(x, chromeY, 'STASH', {
    fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
  }));
  scene._l(scene.add.text(LP.x + LP.w - 20, chromeY, 'click row → pack  ·  [ Sell ] → vault', {
    fontSize: '10px', color: '#445566', fontFamily: 'monospace',
  }).setOrigin(1, 0));

  // Scrollable region — section headers + rows scroll together (single
  // column). Viewport sits below the panel chrome above and the panel border
  // below; row teardown is the existing scene._l(...) path. The viewport
  // itself is also tracked via scene._l so its mask gfx is destroyed on tab
  // switch / pack-change rebuild.
  const vpTop = LP.y + 74;
  const vpH   = LP.h - 84;
  const vp = new ScrollViewport(scene, {
    x: LP.x + 10,
    y: vpTop,
    w: LP.w - 20,
    h: vpH,
    step: 16,
  });
  scene._leftVp = vp;
  scene._l(vp);

  let y = vpTop + 4;
  let hasItems = false;
  for (const section of STASH_SECTIONS) {
    const items = stash
      .filter(e => section.ids.has(e.id))
      .sort((a, b) => STASH_ORDER.indexOf(a.id) - STASH_ORDER.indexOf(b.id));
    if (!items.length) continue;

    hasItems = true;
    vp.track(scene._l(scene.add.text(x, y, section.label, {
      fontSize: '11px', color: '#556677', fontFamily: 'monospace',
    })));
    y += 14;

    for (const { id, qty } of items) {
      const meta = ITEM_META[id] ?? { label: id, detail: '' };
      const row  = vp.track(scene._l(scene.add.text(x + 8, y,
        `${meta.label.padEnd(18)} ${meta.detail}${qty > 1 ? `  ×${qty}` : ''}`,
        { fontSize: '12px', color: '#ffdd88', fontFamily: 'monospace' },
      ).setInteractive()));
      row.on('pointerover',  () => row.setColor('#ffffff'));
      row.on('pointerout',   () => row.setColor('#ffdd88'));
      row.on('pointerdown',  () => {
        stashToRaider(id).then(r => {
          if (r.ok) scene._onPackChanged();
          else      console.warn('[HubScene] stashToRaider failed:', r.error);
        });
      });

      const price = sellPrice(id);
      if (price > 0) {
        const sellBtn = vp.track(scene._l(scene.add.text(LP.x + LP.w - 20, y, `[ Sell ${price} gp ]`, {
          fontSize: '11px', color: '#88ccff', fontFamily: 'monospace',
        }).setOrigin(1, 0).setInteractive()));
        sellBtn.on('pointerover', () => sellBtn.setColor('#ffffff'));
        sellBtn.on('pointerout',  () => sellBtn.setColor('#88ccff'));
        const fxX = LP.x + LP.w - 20, fxY = y;
        sellBtn.on('pointerdown', () => {
          sellItem(id).then(r => {
            if (r.ok) {
              flashItemLoss(scene, fxX, fxY, id, 1);
              flashGoldDelta(scene, price);
              scene._onSold();
            } else {
              console.warn('[HubScene] sellItem failed:', r.error);
            }
          });
        });
      }

      y += 16;
    }
    y += 8;
  }

  if (!hasItems) {
    vp.track(scene._l(scene.add.text(x + 8, y, '(empty)', {
      fontSize: '12px', color: '#334455', fontFamily: 'monospace',
    })));
  }
}
