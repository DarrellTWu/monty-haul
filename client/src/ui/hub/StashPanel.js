// client/src/ui/hub/StashPanel.js
// Stash tab on the left panel. Click a row to move to raider pack; click
// the inline [ Sell ] to convert to vault gold.

import { getStash, stashToRaider, sellItem } from '../../store/stash.js';
import { sellPrice } from '../../../../shared/data/values.js';
import { LP, ITEM_META, STASH_ORDER, STASH_SECTIONS } from './hub-data.js';

export function renderStashPanel(scene) {
  const stash = getStash();
  const x = LP.x + 20;
  let y = LP.y + 52;

  scene._l(scene.add.text(x, y, 'STASH', {
    fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
  }));
  scene._l(scene.add.text(LP.x + LP.w - 20, y, 'click row → pack  ·  [ Sell ] → vault', {
    fontSize: '10px', color: '#445566', fontFamily: 'monospace',
  }).setOrigin(1, 0));
  y += 22;

  let hasItems = false;
  for (const section of STASH_SECTIONS) {
    const items = stash
      .filter(e => section.ids.has(e.id))
      .sort((a, b) => STASH_ORDER.indexOf(a.id) - STASH_ORDER.indexOf(b.id));
    if (!items.length) continue;

    hasItems = true;
    scene._l(scene.add.text(x, y, section.label, {
      fontSize: '11px', color: '#556677', fontFamily: 'monospace',
    })); y += 14;

    for (const { id, qty } of items) {
      const meta = ITEM_META[id] ?? { label: id, detail: '' };
      const row  = scene._l(scene.add.text(x + 8, y,
        `${meta.label.padEnd(18)} ${meta.detail}${qty > 1 ? `  ×${qty}` : ''}`,
        { fontSize: '12px', color: '#ffdd88', fontFamily: 'monospace' },
      ).setInteractive());
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
        const sellBtn = scene._l(scene.add.text(LP.x + LP.w - 20, y, `[ Sell ${price} gp ]`, {
          fontSize: '11px', color: '#88ccff', fontFamily: 'monospace',
        }).setOrigin(1, 0).setInteractive());
        sellBtn.on('pointerover', () => sellBtn.setColor('#ffffff'));
        sellBtn.on('pointerout',  () => sellBtn.setColor('#88ccff'));
        sellBtn.on('pointerdown', () => {
          sellItem(id).then(r => {
            if (r.ok) scene._onSold();
            else      console.warn('[HubScene] sellItem failed:', r.error);
          });
        });
      }

      y += 16;
    }
    y += 8;
  }

  if (!hasItems) {
    scene._l(scene.add.text(x + 8, y, '(empty)', {
      fontSize: '12px', color: '#334455', fontFamily: 'monospace',
    }));
  }
}
