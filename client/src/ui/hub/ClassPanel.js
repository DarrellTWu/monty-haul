// client/src/ui/hub/ClassPanel.js
// Class-select tab on the left panel. Includes 27-pt point-buy UI directly
// underneath the selected class blurb. State that survives panel rebuilds —
// `_selectedClass` and `_abilityScores` — lives on the scene.

import { CLASS_REGISTRY } from '../../../../shared/data/classes/index.js';
import { POINT_BUY_BUDGET, POINT_COST, SCORE_MIN, SCORE_MAX } from '../../../../shared/data/constants.js';
import {
  LP, CLASS_DISPLAY, STAT_KEYS, STAT_LABELS,
  scoreMod, scoreModStr, pointsSpent,
} from './hub-data.js';

export function renderClassPanel(scene) {
  const x = LP.x + 20;
  let y = LP.y + 52;

  scene._l(scene.add.text(x, y, 'SELECT CLASS', {
    fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
  })); y += 24;

  for (const [id, def] of Object.entries(CLASS_DISPLAY)) {
    const selected = scene._selectedClass === id;
    const row = scene._l(scene.add.text(x + 8, y,
      `${selected ? '► ' : '  '}${def.label}`,
      { fontSize: '15px', color: selected ? '#ffcc44' : '#8899bb', fontFamily: 'monospace' },
    ).setInteractive());
    row.on('pointerover',  () => { if (scene._selectedClass !== id) row.setColor('#ccddff'); });
    row.on('pointerout',   () => { if (scene._selectedClass !== id) row.setColor('#8899bb'); });
    row.on('pointerdown',  () => selectClass(scene, id));
    y += 24;
  }

  y += 8;
  scene._l(scene.add.graphics().lineStyle(1, 0x223355).lineBetween(x, y, LP.x + LP.w - 20, y));
  y += 14;

  if (scene._selectedClass) {
    const def = CLASS_DISPLAY[scene._selectedClass];
    scene._l(scene.add.text(x, y, def.label, {
      fontSize: '14px', color: '#ccddff', fontFamily: 'monospace', fontStyle: 'bold',
    })); y += 22;
    for (const trait of def.traits) {
      scene._l(scene.add.text(x + 8, y, `· ${trait}`, {
        fontSize: '12px', color: '#8899bb', fontFamily: 'monospace',
      })); y += 17;
    }
    y += 10;
    renderAbilityScores(scene, x, y);
  } else {
    scene._l(scene.add.text(x + 8, y, 'Select a class to see details.', {
      fontSize: '12px', color: '#334455', fontFamily: 'monospace',
    }));
  }
}

function renderAbilityScores(scene, x, startY) {
  let y = startY;
  const scores    = scene._abilityScores;
  const spent     = pointsSpent(scores);
  const remaining = POINT_BUY_BUDGET - spent;

  scene._l(scene.add.text(x, y, 'ABILITY SCORES', {
    fontSize: '11px', color: '#aaaacc', fontFamily: 'monospace',
  }));
  scene._l(scene.add.text(LP.x + LP.w - 20, y,
    `Points: ${remaining} / ${POINT_BUY_BUDGET}`,
    { fontSize: '11px', color: remaining === 0 ? '#88ccaa' : '#ffcc44', fontFamily: 'monospace' },
  ).setOrigin(1, 0));
  y += 16;

  scene._l(scene.add.graphics()
    .lineStyle(1, 0x223355)
    .lineBetween(x, y, LP.x + LP.w - 20, y));
  y += 10;

  for (const key of STAT_KEYS) {
    const score    = scores[key];
    const cost     = POINT_COST[score] ?? 0;
    const nextCost = POINT_COST[score + 1] ?? 999;
    const canDec   = score > SCORE_MIN;
    const canInc   = score < SCORE_MAX && (nextCost - cost) <= remaining;

    const decBtn = scene._l(scene.add.text(x + 8, y, '[ − ]', {
      fontSize: '12px',
      color: canDec ? '#88ccff' : '#334455',
      fontFamily: 'monospace',
    }));
    if (canDec) {
      decBtn.setInteractive();
      decBtn.on('pointerover', () => decBtn.setColor('#ffffff'));
      decBtn.on('pointerout',  () => decBtn.setColor('#88ccff'));
      decBtn.on('pointerdown', () => {
        scene._abilityScores[key] = score - 1;
        refreshClassPanel(scene);
      });
    }

    scene._l(scene.add.text(x + 55, y,
      `${STAT_LABELS[key]}  ${String(score).padStart(2)}  ${scoreModStr(score)}`,
      { fontSize: '12px', color: '#cccccc', fontFamily: 'monospace' },
    ));

    const incCost  = nextCost - cost;
    const incLabel = score < SCORE_MAX ? `[+](${incCost})` : '[ + ]';
    const incBtn = scene._l(scene.add.text(x + 168, y, incLabel, {
      fontSize: '12px',
      color: canInc ? '#88ccff' : '#334455',
      fontFamily: 'monospace',
    }));
    if (canInc) {
      incBtn.setInteractive();
      incBtn.on('pointerover', () => incBtn.setColor('#ffffff'));
      incBtn.on('pointerout',  () => incBtn.setColor('#88ccff'));
      incBtn.on('pointerdown', () => {
        scene._abilityScores[key] = score + 1;
        refreshClassPanel(scene);
      });
    }

    y += 18;
  }

  y += 4;
  scene._l(scene.add.graphics()
    .lineStyle(1, 0x223355)
    .lineBetween(x, y, LP.x + LP.w - 20, y));
  y += 10;

  const classDef = CLASS_REGISTRY[scene._selectedClass];
  if (classDef) {
    const conMod = scoreMod(scores.con);
    const hp     = Math.floor((classDef.hitDie + conMod) * 2);
    scene._l(scene.add.text(x + 8, y, `Estimated starting HP: ${hp}`, {
      fontSize: '11px', color: '#88ccaa', fontFamily: 'monospace',
    }));
    y += 18;
  }

  const resetBtn = scene._l(scene.add.text(x + 8, y, '[ Reset to Class Defaults ]', {
    fontSize: '11px', color: '#8888aa', fontFamily: 'monospace',
  }).setInteractive());
  resetBtn.on('pointerover', () => resetBtn.setColor('#aabbdd'));
  resetBtn.on('pointerout',  () => resetBtn.setColor('#8888aa'));
  resetBtn.on('pointerdown', () => {
    scene._abilityScores = { ...CLASS_DISPLAY[scene._selectedClass].defaultScores };
    refreshClassPanel(scene);
  });
}

function refreshClassPanel(scene) {
  for (const obj of scene._leftObjs) obj.destroy();
  scene._leftObjs = [];
  renderClassPanel(scene);
}

function selectClass(scene, classId) {
  scene._selectedClass = classId;
  scene._abilityScores = { ...CLASS_DISPLAY[classId].defaultScores };
  for (const obj of scene._leftObjs) obj.destroy();
  scene._leftObjs = [];
  renderClassPanel(scene);
  scene._refreshRaider();
}
