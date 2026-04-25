// client/src/scenes/HubScene.js
// Hub layout: left panel cycles through sub-screens (Class, Stash, future additions);
// right panel is a persistent Raider Config summary. Enter Dungeon lives on the right.

import { getStash, getRaiderPack, stashToRaider, raiderToStash } from '../store/stash.js';

// Panel geometry
const LP = { x: 30,  y: 70, w: 760, h: 600 }; // left panel
const RP = { x: 810, y: 70, w: 440, h: 600 }; // right panel (raider config)

// Item display metadata (label + one-line detail).
const ITEM_META = {
  longsword:           { label: 'Longsword',        detail: '1d8  slashing'    },
  shortsword:          { label: 'Shortsword',       detail: '1d6  piercing'    },
  dagger:              { label: 'Dagger',           detail: '1d4  piercing'    },
  handaxe:             { label: 'Handaxe',          detail: '1d6  slashing'    },
  mace:                { label: 'Mace',             detail: '1d6  bludgeoning' },
  greataxe:            { label: 'Greataxe',         detail: '1d12 slashing'    },
  greatsword:          { label: 'Greatsword',       detail: '2d6  slashing'    },
  chain_mail:          { label: 'Chain Mail',       detail: 'AC 16  heavy'     },
  half_plate:          { label: 'Half Plate',       detail: 'AC 15+DEX  med'   },
  shield:              { label: 'Shield',           detail: '+2 AC'            },
  healing_potion:      { label: 'Healing Potion',   detail: '2d4+2 HP'         },
  bless_potion:        { label: 'Bless Potion',     detail: '+1d4 atk 60s'     },
  longstrider_potion:  { label: 'Longstrider Pot',  detail: '+10ft spd 2m'     },
  false_life_potion:   { label: 'False Life Pot',   detail: '1d4+4 tmp HP 2m'  },
};

const STASH_ORDER = [
  'longsword','shortsword','dagger','handaxe','mace','greataxe','greatsword',
  'chain_mail','half_plate','shield',
  'healing_potion','bless_potion','longstrider_potion','false_life_potion',
];

const STASH_SECTIONS = [
  { label: 'Weapons',        ids: new Set(['longsword','shortsword','dagger','handaxe','mace','greataxe','greatsword']) },
  { label: 'Armor & Shield', ids: new Set(['chain_mail','half_plate','shield']) },
  { label: 'Potions',        ids: new Set(['healing_potion','bless_potion','longstrider_potion','false_life_potion']) },
];

// Class display metadata for the hub UI.
const CLASS_DISPLAY = {
  fighter: {
    label: 'Fighter',
    traits: [
      'Longsword · Chain Mail',
      'Second Wind — 1d10+level HP (1/rest)',
      'Fighting Style: Dueling (+2 dmg)',
    ],
  },
  monk: {
    label: 'Monk',
    traits: [
      'Shortsword · Unarmored Defense (AC = 10+DEX+WIS)',
      'Martial Arts — DEX attacks, d4 unarmed',
      'Bonus unarmed strike after monk weapon attack',
    ],
  },
  barbarian: {
    label: 'Barbarian',
    traits: [
      'Greatsword · Chain Mail',
      'Rage — +2 dmg, resist physical dmg (2 uses, 30s)',
    ],
  },
};

export class HubScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HubScene' });
  }

  init(data) {
    this._initData = data ?? {};
  }

  create() {
    this._selectedClass = null;
    this._leftView      = this._initData.view === 'stash' ? 'stash' : 'class';
    this._leftObjs      = [];
    this._rightObjs     = [];

    this.add.text(640, 38, "MONTY HAUL'S DUNGEON CRAWL", {
      fontSize: '26px', color: '#ffdd88', fontFamily: 'monospace',
    }).setOrigin(0.5);

    this._drawShells();
    this._buildSubNav();
    this._showLeftContent();
    this._buildRaiderPanel();
  }

  // ── Permanent shell ───────────────────────────────────────────────────────────

  _drawShells() {
    const g = this.add.graphics();
    g.fillStyle(0x12121e, 0.97);
    g.fillRect(LP.x, LP.y, LP.w, LP.h);
    g.fillRect(RP.x, RP.y, RP.w, RP.h);
    g.lineStyle(1, 0x334466);
    g.strokeRect(LP.x, LP.y, LP.w, LP.h);
    g.strokeRect(RP.x, RP.y, RP.w, RP.h);
  }

  // ── Sub-nav (left panel tabs — permanent) ─────────────────────────────────────

  _buildSubNav() {
    const tabs = [{ id: 'class', label: 'Class' }, { id: 'stash', label: 'Stash' }];
    this._subNavBtns = {};
    let tx = LP.x + 16;
    const ty = LP.y + 14;
    for (const { id, label } of tabs) {
      const btn = this.add.text(tx, ty, `[ ${label} ]`, {
        fontSize: '14px', color: '#8888aa', fontFamily: 'monospace',
      }).setInteractive();
      btn.on('pointerdown', () => this._switchLeftView(id));
      btn.on('pointerover',  () => { if (this._leftView !== id) btn.setColor('#aabbdd'); });
      btn.on('pointerout',   () => { if (this._leftView !== id) btn.setColor('#8888aa'); });
      this._subNavBtns[id] = btn;
      tx += btn.width + 20;
    }
    this.add.graphics()
      .lineStyle(1, 0x223355)
      .lineBetween(LP.x + 8, LP.y + 40, LP.x + LP.w - 8, LP.y + 40);
    this._updateSubNav();
  }

  _updateSubNav() {
    for (const [id, btn] of Object.entries(this._subNavBtns)) {
      btn.setColor(id === this._leftView ? '#ffcc44' : '#8888aa');
    }
  }

  _switchLeftView(view) {
    if (this._leftView === view) return;
    this._leftView = view;
    this._updateSubNav();
    for (const obj of this._leftObjs) obj.destroy();
    this._leftObjs = [];
    this._showLeftContent();
  }

  // ── Left panel content ────────────────────────────────────────────────────────

  _showLeftContent() {
    if (this._leftView === 'class') this._showClassScreen();
    else                            this._showStashScreen();
  }

  _showClassScreen() {
    const x = LP.x + 20;
    let y = LP.y + 52;

    this._l(this.add.text(x, y, 'SELECT CLASS', {
      fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
    })); y += 24;

    for (const [id, def] of Object.entries(CLASS_DISPLAY)) {
      const selected = this._selectedClass === id;
      const row = this._l(this.add.text(x + 8, y,
        `${selected ? '► ' : '  '}${def.label}`,
        { fontSize: '15px', color: selected ? '#ffcc44' : '#8899bb', fontFamily: 'monospace' },
      ).setInteractive());
      row.on('pointerover',  () => { if (this._selectedClass !== id) row.setColor('#ccddff'); });
      row.on('pointerout',   () => { if (this._selectedClass !== id) row.setColor('#8899bb'); });
      row.on('pointerdown',  () => this._selectClass(id));
      y += 24;
    }

    y += 8;
    this._l(this.add.graphics().lineStyle(1, 0x223355).lineBetween(x, y, LP.x + LP.w - 20, y));
    y += 14;

    if (this._selectedClass) {
      const def = CLASS_DISPLAY[this._selectedClass];
      this._l(this.add.text(x, y, def.label, {
        fontSize: '14px', color: '#ccddff', fontFamily: 'monospace', fontStyle: 'bold',
      })); y += 22;
      for (const trait of def.traits) {
        this._l(this.add.text(x + 8, y, `· ${trait}`, {
          fontSize: '12px', color: '#8899bb', fontFamily: 'monospace',
        })); y += 17;
      }
    } else {
      this._l(this.add.text(x + 8, y, 'Select a class to see details.', {
        fontSize: '12px', color: '#334455', fontFamily: 'monospace',
      }));
    }
  }

  _showStashScreen() {
    const stash = getStash();
    const x = LP.x + 20;
    let y = LP.y + 52;

    this._l(this.add.text(x, y, 'STASH', {
      fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
    }));
    this._l(this.add.text(LP.x + LP.w - 20, y, 'click item to add to pack  ›', {
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
      this._l(this.add.text(x, y, section.label, {
        fontSize: '11px', color: '#556677', fontFamily: 'monospace',
      })); y += 14;

      for (const { id, qty } of items) {
        const meta = ITEM_META[id] ?? { label: id, detail: '' };
        const row  = this._l(this.add.text(x + 8, y,
          `${meta.label.padEnd(18)} ${meta.detail}${qty > 1 ? `  ×${qty}` : ''}`,
          { fontSize: '12px', color: '#ffdd88', fontFamily: 'monospace' },
        ).setInteractive());
        row.on('pointerover',  () => row.setColor('#ffffff'));
        row.on('pointerout',   () => row.setColor('#ffdd88'));
        row.on('pointerdown',  () => { stashToRaider(id); this._onPackChanged(); });
        y += 16;
      }
      y += 8;
    }

    if (!hasItems) {
      this._l(this.add.text(x + 8, y, '(empty)', {
        fontSize: '12px', color: '#334455', fontFamily: 'monospace',
      }));
    }
  }

  _selectClass(classId) {
    this._selectedClass = classId;
    for (const obj of this._leftObjs) obj.destroy();
    this._leftObjs = [];
    this._showClassScreen();
    this._buildRaiderPanel();
  }

  // ── Right panel: Raider Config (rebuilt on any raider state change) ───────────

  _buildRaiderPanel() {
    for (const obj of this._rightObjs) obj.destroy();
    this._rightObjs = [];

    const x = RP.x + 20;
    let y = RP.y + 16;

    this._r(this.add.text(x, y, 'RAIDER CONFIG', {
      fontSize: '13px', color: '#aaaacc', fontFamily: 'monospace',
    })); y += 26;

    // ── Class ──────────────────────────────────────────────────────────────────
    this._r(this.add.text(x, y, 'CLASS', {
      fontSize: '11px', color: '#556677', fontFamily: 'monospace',
    })); y += 15;

    if (this._selectedClass) {
      const def = CLASS_DISPLAY[this._selectedClass];
      this._r(this.add.text(x + 8, y, def.label, {
        fontSize: '14px', color: '#ffcc44', fontFamily: 'monospace',
      })); y += 20;
      for (const trait of def.traits) {
        this._r(this.add.text(x + 8, y, `· ${trait}`, {
          fontSize: '11px', color: '#778899', fontFamily: 'monospace',
        })); y += 14;
      }
    } else {
      this._r(this.add.text(x + 8, y, '(none — select on Class tab)', {
        fontSize: '11px', color: '#445566', fontFamily: 'monospace',
      })); y += 16;
    }
    y += 10;

    // ── Divider ────────────────────────────────────────────────────────────────
    this._r(this.add.graphics()
      .lineStyle(1, 0x223355)
      .lineBetween(RP.x + 8, y, RP.x + RP.w - 8, y));
    y += 12;

    // ── Pack ───────────────────────────────────────────────────────────────────
    this._r(this.add.text(x, y, 'PACK', {
      fontSize: '11px', color: '#556677', fontFamily: 'monospace',
    }));
    this._r(this.add.text(RP.x + RP.w - 20, y, '‹ click to return to stash', {
      fontSize: '10px', color: '#445566', fontFamily: 'monospace',
    }).setOrigin(1, 0));
    y += 15;

    const pack = getRaiderPack();
    if (pack.length === 0) {
      this._r(this.add.text(x + 8, y, '(empty — default class gear on entry)', {
        fontSize: '11px', color: '#334455', fontFamily: 'monospace',
      }));
    } else {
      const sorted = [...pack].sort((a, b) => {
        const ai = STASH_ORDER.indexOf(a.id), bi = STASH_ORDER.indexOf(b.id);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
      });
      for (const { id, qty } of sorted) {
        const meta = ITEM_META[id] ?? { label: id, detail: '' };
        const row  = this._r(this.add.text(x + 8, y,
          `${meta.label.padEnd(16)} ${meta.detail}${qty > 1 ? `  ×${qty}` : ''}`,
          { fontSize: '12px', color: '#88ccff', fontFamily: 'monospace' },
        ).setInteractive());
        row.on('pointerover',  () => row.setColor('#ffffff'));
        row.on('pointerout',   () => row.setColor('#88ccff'));
        row.on('pointerdown',  () => { raiderToStash(id); this._onPackChanged(); });
        y += 16;
      }
    }

    // ── Enter Dungeon ──────────────────────────────────────────────────────────
    const active = !!this._selectedClass;
    const btnY   = RP.y + RP.h - 36;
    const enterBtn = this._r(this.add.text(RP.x + RP.w / 2, btnY, '[ Enter Dungeon ]', {
      fontSize: '18px', color: active ? '#ffcc44' : '#334455', fontFamily: 'monospace',
    }).setOrigin(0.5).setInteractive());
    enterBtn.on('pointerover',  () => { if (active) enterBtn.setColor('#ffffff'); });
    enterBtn.on('pointerout',   () => { enterBtn.setColor(active ? '#ffcc44' : '#334455'); });
    enterBtn.on('pointerdown',  () => {
      if (active) this.scene.start('DungeonScene', { class: this._selectedClass });
    });
  }

  /** Called when stash/pack changes: rebuilds stash view (if active) + raider panel. */
  _onPackChanged() {
    if (this._leftView === 'stash') {
      for (const obj of this._leftObjs) obj.destroy();
      this._leftObjs = [];
      this._showStashScreen();
    }
    this._buildRaiderPanel();
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────

  _l(obj) { this._leftObjs.push(obj);  return obj; }
  _r(obj) { this._rightObjs.push(obj); return obj; }
}
