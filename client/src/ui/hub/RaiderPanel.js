// client/src/ui/hub/RaiderPanel.js
// Right-side persistent panel: selected class summary + raider pack contents +
// Enter Dungeon button. Rebuilt on any raider state change (class swap, pack
// add/remove, rename — not currently rebuilt for rename, but cheap if needed).

import { getRaiderPack, raiderToStash, dumpRaiderPackToStash } from '../../store/stash.js';
import { validateAbilityScores } from '../../../../shared/logic/character.js';
import { RP, ITEM_META, STASH_ORDER, CLASS_DISPLAY } from './hub-data.js';

export function renderRaiderPanel(scene) {
  for (const obj of scene._rightObjs) obj.destroy();
  scene._rightObjs = [];

  const x = RP.x + 20;
  let y = RP.y + 16;

  scene._r(scene.add.text(x, y, 'RAIDER CONFIG', {
    fontSize: '13px', color: '#aaaacc', fontFamily: 'monospace',
  })); y += 26;

  scene._r(scene.add.text(x, y, 'CLASS', {
    fontSize: '11px', color: '#556677', fontFamily: 'monospace',
  })); y += 15;

  if (scene._selectedClass) {
    const def = CLASS_DISPLAY[scene._selectedClass];
    scene._r(scene.add.text(x + 8, y, def.label, {
      fontSize: '14px', color: '#ffcc44', fontFamily: 'monospace',
    })); y += 20;
    for (const trait of def.traits) {
      scene._r(scene.add.text(x + 8, y, `· ${trait}`, {
        fontSize: '11px', color: '#778899', fontFamily: 'monospace',
      })); y += 14;
    }
  } else {
    scene._r(scene.add.text(x + 8, y, '(none — select on Class tab)', {
      fontSize: '11px', color: '#445566', fontFamily: 'monospace',
    })); y += 16;
  }
  y += 10;

  scene._r(scene.add.graphics()
    .lineStyle(1, 0x223355)
    .lineBetween(RP.x + 8, y, RP.x + RP.w - 8, y));
  y += 12;

  scene._r(scene.add.text(x, y, 'PACK', {
    fontSize: '11px', color: '#556677', fontFamily: 'monospace',
  }));
  scene._r(scene.add.text(RP.x + RP.w - 20, y, '‹ click to return to stash', {
    fontSize: '10px', color: '#445566', fontFamily: 'monospace',
  }).setOrigin(1, 0));
  y += 15;

  const pack = getRaiderPack();
  if (pack.length === 0) {
    scene._r(scene.add.text(x + 8, y, '(empty — default class gear on entry)', {
      fontSize: '11px', color: '#334455', fontFamily: 'monospace',
    }));
  } else {
    const sorted = [...pack].sort((a, b) => {
      const ai = STASH_ORDER.indexOf(a.id), bi = STASH_ORDER.indexOf(b.id);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
    for (const { id, qty } of sorted) {
      const meta = ITEM_META[id] ?? { label: id, detail: '' };
      const row  = scene._r(scene.add.text(x + 8, y,
        `${meta.label.padEnd(16)} ${meta.detail}${qty > 1 ? `  ×${qty}` : ''}`,
        { fontSize: '12px', color: '#88ccff', fontFamily: 'monospace' },
      ).setInteractive());
      row.on('pointerover',  () => row.setColor('#ffffff'));
      row.on('pointerout',   () => row.setColor('#88ccff'));
      row.on('pointerdown',  () => {
        raiderToStash(id).then(r => {
          if (r.ok) scene._onPackChanged();
          else      console.warn('[HubScene] raiderToStash failed:', r.error);
        });
      });
      y += 16;
    }

    y += 4;
    const dumpBtn = scene._r(scene.add.text(x + 8, y, '[ Dump All to Stash ]', {
      fontSize: '11px', color: '#aabbdd', fontFamily: 'monospace',
    }).setInteractive());
    dumpBtn.on('pointerover', () => dumpBtn.setColor('#ffffff'));
    dumpBtn.on('pointerout',  () => dumpBtn.setColor('#aabbdd'));
    dumpBtn.on('pointerdown', () => {
      dumpRaiderPackToStash().then(r => {
        if (r.ok) scene._onPackChanged();
        else      console.warn('[HubScene] dumpRaiderPackToStash failed:', r.error);
      });
    });
  }

  const active = !!scene._selectedClass;
  const btnY   = RP.y + RP.h - 36;
  const enterBtn = scene._r(scene.add.text(RP.x + RP.w / 2, btnY, '[ Enter Dungeon ]', {
    fontSize: '18px', color: active ? '#ffcc44' : '#334455', fontFamily: 'monospace',
  }).setOrigin(0.5).setInteractive());
  enterBtn.on('pointerover',  () => { if (active) enterBtn.setColor('#ffffff'); });
  enterBtn.on('pointerout',   () => { enterBtn.setColor(active ? '#ffcc44' : '#334455'); });
  enterBtn.on('pointerdown',  () => {
    if (!active) return;
    const scores = scene._abilityScores ?? { ...CLASS_DISPLAY[scene._selectedClass].defaultScores };
    // Pre-submit assert against the same rule the server enforces. The UI's
    // incremental gating should already prevent invalid scores; this is a
    // defensive check so a UI bug can't ship invalid data to the room.
    const check = validateAbilityScores(scores);
    if (!check.ok) {
      console.warn('[HubScene] refusing to enter with invalid abilityScores:', check.error);
      return;
    }
    scene.scene.start('DungeonScene', { class: scene._selectedClass, abilityScores: scores });
  });
}
