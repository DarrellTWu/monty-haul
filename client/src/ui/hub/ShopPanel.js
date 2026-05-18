// client/src/ui/hub/ShopPanel.js
// Shop tab on the left panel. Two vendor sub-tabs (potions / armor). Current
// vendor lives on `scene._shopVendor` so it survives panel rebuilds.

import { getHubGold, buyItem } from '../../store/stash.js';
import { VENDOR_CATALOG } from '../../../../shared/data/shop.js';
import { LP, ITEM_META } from './hub-data.js';
import { flashItemGain, flashGoldDelta } from './feedback.js';

export function renderShopPanel(scene) {
  const x = LP.x + 20;
  let   y = LP.y + 52;

  scene._l(scene.add.text(x, y, 'SHOP', {
    fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
  }));
  scene._l(scene.add.text(LP.x + LP.w - 20, y, 'click [ Buy ] to add to stash  ›', {
    fontSize: '10px', color: '#445566', fontFamily: 'monospace',
  }).setOrigin(1, 0));
  y += 22;

  const vendors = [{ id: 'potions', label: 'Potion Vendor' }, { id: 'armor', label: 'Armor Vendor' }];
  let vx = x;
  for (const { id, label } of vendors) {
    const active = scene._shopVendor === id;
    const btn = scene._l(scene.add.text(vx, y, `[ ${label} ]`, {
      fontSize: '13px',
      color: active ? '#ffcc44' : '#8888aa',
      fontFamily: 'monospace',
    }).setInteractive());
    btn.on('pointerover', () => { if (scene._shopVendor !== id) btn.setColor('#aabbdd'); });
    btn.on('pointerout',  () => { if (scene._shopVendor !== id) btn.setColor('#8888aa'); });
    btn.on('pointerdown', () => {
      if (scene._shopVendor === id) return;
      scene._shopVendor = id;
      refreshShopPanel(scene);
    });
    vx += btn.width + 16;
  }
  y += 28;

  scene._l(scene.add.graphics()
    .lineStyle(1, 0x223355)
    .lineBetween(x, y, LP.x + LP.w - 20, y));
  y += 12;

  const gold  = getHubGold();
  const items = VENDOR_CATALOG[scene._shopVendor] ?? [];

  for (const { id, price } of items) {
    const meta       = ITEM_META[id] ?? { label: id, detail: '' };
    const affordable = gold >= price;
    const itemColor  = affordable ? '#ffdd88' : '#445566';

    scene._l(scene.add.text(x + 8, y,
      `${meta.label.padEnd(18)} ${meta.detail.padEnd(20)} ${String(price).padStart(5)} gp`,
      { fontSize: '12px', color: itemColor, fontFamily: 'monospace' },
    ));

    const buyX = LP.x + LP.w - 24;
    const buyBtn = scene._l(scene.add.text(buyX, y, '[ Buy ]', {
      fontSize: '12px',
      color: affordable ? '#88ccff' : '#334455',
      fontFamily: 'monospace',
    }).setOrigin(1, 0));

    if (affordable) {
      buyBtn.setInteractive();
      buyBtn.on('pointerover', () => buyBtn.setColor('#ffffff'));
      buyBtn.on('pointerout',  () => buyBtn.setColor('#88ccff'));
      const fxX = buyX, fxY = y;
      buyBtn.on('pointerdown', () => {
        buyItem(id).then(r => {
          if (r.ok) {
            flashItemGain(scene, fxX, fxY, id, 1);
            flashGoldDelta(scene, -price);
            scene._onPurchase();
          } else {
            console.warn('[HubScene] buyItem failed:', r.error);
          }
        });
      });
    }

    y += 18;
  }
}

export function refreshShopPanel(scene) {
  for (const obj of scene._leftObjs) obj.destroy();
  scene._leftObjs = [];
  renderShopPanel(scene);
}
