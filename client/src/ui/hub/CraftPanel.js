// client/src/ui/hub/CraftPanel.js
// Crafting tab on the left panel. Bench sub-tabs with status badges; only
// `forge` and `apothecary` have recipes today, others render '(coming soon)'.

import { getStash, craftRecipe } from '../../store/stash.js';
import { BENCH_REGISTRY } from '../../../../shared/data/crafting/benches.js';
import { recipesForBench } from '../../../../shared/data/crafting/recipes.js';
import { LP, ITEM_META } from './hub-data.js';
import { flashItemGain } from './feedback.js';

export function renderCraftPanel(scene) {
  const x = LP.x + 20;
  let   y = LP.y + 52;

  scene._l(scene.add.text(x, y, 'CRAFTING', {
    fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
  }));
  scene._l(scene.add.text(LP.x + LP.w - 20, y, 'click [ Craft ] to consume mats  ›', {
    fontSize: '10px', color: '#445566', fontFamily: 'monospace',
  }).setOrigin(1, 0));
  y += 22;

  let bx = x;
  for (const bench of Object.values(BENCH_REGISTRY)) {
    const active = scene._craftBench === bench.id;
    const btn = scene._l(scene.add.text(bx, y, `[ ${bench.label} ]`, {
      fontSize: '12px',
      color: active ? '#ffcc44' : (bench.status === 'open' ? '#8888aa' : '#556677'),
      fontFamily: 'monospace',
    }).setInteractive());
    btn.on('pointerover', () => { if (scene._craftBench !== bench.id) btn.setColor('#aabbdd'); });
    btn.on('pointerout',  () => {
      if (scene._craftBench !== bench.id) {
        btn.setColor(bench.status === 'open' ? '#8888aa' : '#556677');
      }
    });
    btn.on('pointerdown', () => {
      if (scene._craftBench === bench.id) return;
      scene._craftBench = bench.id;
      refreshCraftPanel(scene);
    });
    bx += btn.width + 10;
  }
  y += 26;

  scene._l(scene.add.graphics()
    .lineStyle(1, 0x223355)
    .lineBetween(x, y, LP.x + LP.w - 20, y));
  y += 12;

  const bench = BENCH_REGISTRY[scene._craftBench];
  scene._l(scene.add.text(x, y, bench.label.toUpperCase(), {
    fontSize: '14px', color: '#ccddff', fontFamily: 'monospace', fontStyle: 'bold',
  })); y += 18;
  scene._l(scene.add.text(x, y, bench.blurb, {
    fontSize: '11px', color: '#778899', fontFamily: 'monospace',
  })); y += 22;

  if (bench.status !== 'open') {
    scene._l(scene.add.text(x + 8, y, '(coming soon)', {
      fontSize: '12px', color: '#445566', fontFamily: 'monospace',
    }));
    return;
  }

  const stash   = getStash();
  const stashOf = (id) => (stash.find(e => e.id === id)?.qty ?? 0);
  const recipes = recipesForBench(bench.id);

  if (recipes.length === 0) {
    scene._l(scene.add.text(x + 8, y, '(no recipes available)', {
      fontSize: '12px', color: '#445566', fontFamily: 'monospace',
    }));
    return;
  }

  for (const recipe of recipes) {
    const affordable = recipe.inputs.every(({ id, qty }) => stashOf(id) >= qty);

    const inputsStr = recipe.inputs.map(({ id, qty }) => {
      const meta = ITEM_META[id] ?? { label: id };
      return `${qty}× ${meta.label}`;
    }).join(' + ');

    const outMeta = ITEM_META[recipe.output.id] ?? { label: recipe.output.id };
    const outStr  = `${recipe.output.qty > 1 ? recipe.output.qty + '× ' : ''}${outMeta.label}`;

    const rowColor = affordable ? '#ffdd88' : '#445566';
    scene._l(scene.add.text(x + 8, y, recipe.label.padEnd(14), {
      fontSize: '12px', color: rowColor, fontFamily: 'monospace',
    }));
    scene._l(scene.add.text(x + 8 + 110, y, `${inputsStr}  →  ${outStr}`, {
      fontSize: '12px', color: rowColor, fontFamily: 'monospace',
    }));

    const buyX = LP.x + LP.w - 24;
    const craftBtn = scene._l(scene.add.text(buyX, y, '[ Craft ]', {
      fontSize: '12px',
      color: affordable ? '#88ccff' : '#334455',
      fontFamily: 'monospace',
    }).setOrigin(1, 0));

    if (affordable) {
      craftBtn.setInteractive();
      craftBtn.on('pointerover', () => craftBtn.setColor('#ffffff'));
      craftBtn.on('pointerout',  () => craftBtn.setColor('#88ccff'));
      const fxX = buyX, fxY = y;
      craftBtn.on('pointerdown', () => {
        craftRecipe(recipe.id).then(r => {
          if (r.ok) {
            flashItemGain(scene, fxX, fxY, recipe.output.id, recipe.output.qty);
            scene._onCraft();
          } else {
            console.warn('[HubScene] craftRecipe failed:', r.error);
          }
        });
      });
    }
    y += 20;
  }
}

export function refreshCraftPanel(scene) {
  for (const obj of scene._leftObjs) obj.destroy();
  scene._leftObjs = [];
  renderCraftPanel(scene);
}
