// client/src/scenes/HubScene.js
// Hub entry point. Top-level nav: Class Select | Stash.
// Class Select → choose class → enter dungeon.
// Stash        → view stored items and raider's pack (equip-raider coming next pass).

const STASH_ITEMS = [
  // Weapons
  { id: 'longsword',           label: 'Longsword',        detail: '1d8  slashing',    qty: 1 },
  { id: 'shortsword',          label: 'Shortsword',       detail: '1d6  piercing',    qty: 1 },
  { id: 'dagger',              label: 'Dagger',           detail: '1d4  piercing',    qty: 1 },
  { id: 'handaxe',             label: 'Handaxe',          detail: '1d6  slashing',    qty: 1 },
  { id: 'mace',                label: 'Mace',             detail: '1d6  bludgeoning', qty: 1 },
  { id: 'greataxe',            label: 'Greataxe',         detail: '1d12 slashing',    qty: 1 },
  { id: 'greatsword',          label: 'Greatsword',       detail: '2d6  slashing',    qty: 1 },
  // Armor & shield
  { id: 'chain_mail',          label: 'Chain Mail',       detail: 'AC 16  heavy',     qty: 1 },
  { id: 'half_plate',          label: 'Half Plate',       detail: 'AC 15+DEX  med',   qty: 1 },
  { id: 'shield',              label: 'Shield',           detail: '+2 AC',            qty: 1 },
  // Potions
  { id: 'healing_potion',      label: 'Healing Potion',   detail: '2d4+2 HP',         qty: 2 },
  { id: 'bless_potion',        label: 'Bless Potion',     detail: '+1d4 atk 60s',     qty: 2 },
  { id: 'longstrider_potion',  label: 'Longstrider Pot',  detail: '+10ft spd 2m',     qty: 2 },
  { id: 'false_life_potion',   label: 'False Life Pot',   detail: '1d4+4 tmp HP 2m',  qty: 2 },
];

const STASH_SECTIONS = [
  { label: 'Weapons',       start: 0,  end: 7  },
  { label: 'Armor & Shield', start: 7,  end: 10 },
  { label: 'Potions',       start: 10, end: 14 },
];

export class HubScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HubScene' });
  }

  create() {
    this._selected  = null;
    this._cards     = {};
    this._view      = 'class';
    this._panelObjs = [];

    this.add.text(640, 55, "MONTY HAUL'S DUNGEON CRAWL", {
      fontSize: '26px', color: '#ffdd88', fontFamily: 'monospace',
    }).setOrigin(0.5);

    this._navClass = this._makeNavBtn(450, 108, 'Class Select', () => this._switchView('class'));
    this._navStash = this._makeNavBtn(790, 108, 'Stash',        () => this._switchView('stash'));
    this._updateNav();

    this._showClassSelect();
  }

  // ── Navigation ────────────────────────────────────────────────────────────────

  _makeNavBtn(x, y, label, cb) {
    const btn = this.add.text(x, y, `[ ${label} ]`, {
      fontSize: '16px', color: '#8888aa', fontFamily: 'monospace',
    }).setOrigin(0.5).setInteractive();
    btn.on('pointerdown', cb);
    btn.on('pointerover',  () => { if (!btn.getData('active')) btn.setColor('#aabbdd'); });
    btn.on('pointerout',   () => { if (!btn.getData('active')) btn.setColor('#8888aa'); });
    return btn;
  }

  _updateNav() {
    const isClass = this._view === 'class';
    this._navClass.setColor(isClass  ? '#ffcc44' : '#8888aa').setData('active', isClass);
    this._navStash.setColor(!isClass ? '#ffcc44' : '#8888aa').setData('active', !isClass);
  }

  _switchView(view) {
    if (this._view === view) return;
    for (const obj of this._panelObjs) obj.destroy();
    this._panelObjs = [];
    this._view      = view;
    this._updateNav();
    if (view === 'class') this._showClassSelect();
    else                  this._showStash();
  }

  // ── Class Select view ─────────────────────────────────────────────────────────

  _showClassSelect() {
    this._cards    = {};
    this._selected = null;

    this._t(this.add.text(640, 152, 'Choose Your Class', {
      fontSize: '16px', color: '#8888aa', fontFamily: 'monospace',
    }).setOrigin(0.5));

    this._makeClassCard(330, 345, 'fighter',   'Fighter',   ['Longsword', 'Chain Mail', 'Second Wind']);
    this._makeClassCard(640, 345, 'monk',      'Monk',      ['Shortsword', 'Unarmored Defense', 'Martial Arts']);
    this._makeClassCard(950, 345, 'barbarian', 'Barbarian', ['Greatsword', 'Chain Mail', 'Rage (2 uses)']);

    this._enterBtn = this._t(this.add.text(640, 608, '[ Enter Dungeon ]', {
      fontSize: '20px', color: '#444455', fontFamily: 'monospace',
    }).setOrigin(0.5).setInteractive());

    this._enterBtn.on('pointerdown', () => {
      if (this._selected) this.scene.start('DungeonScene', { class: this._selected });
    });
  }

  _makeClassCard(x, y, classId, label, traits) {
    const card = this._t(
      this.add.rectangle(x, y, 280, 260, 0x111122).setStrokeStyle(2, 0x334466).setInteractive()
    );
    this._t(this.add.text(x, y - 90, label, { fontSize: '20px', color: '#ccddff', fontFamily: 'monospace' }).setOrigin(0.5));
    this._t(this.add.graphics().lineStyle(1, 0x334466).lineBetween(x - 100, y - 65, x + 100, y - 65));
    traits.forEach((trait, i) => {
      this._t(this.add.text(x, y - 38 + i * 30, `· ${trait}`, { fontSize: '14px', color: '#8899bb', fontFamily: 'monospace' }).setOrigin(0.5));
    });
    card.on('pointerdown', () => this._select(classId));
    card.on('pointerover',  () => { if (this._selected !== classId) card.setStrokeStyle(2, 0x5566aa); });
    card.on('pointerout',   () => { if (this._selected !== classId) card.setStrokeStyle(2, 0x334466); });
    this._cards[classId] = card;
  }

  _select(classId) {
    this._selected = classId;
    for (const [id, card] of Object.entries(this._cards)) {
      card.setStrokeStyle(2, id === classId ? 0xffcc44 : 0x334466);
    }
    this._enterBtn.setColor('#ffcc44');
  }

  // ── Stash view ────────────────────────────────────────────────────────────────

  _showStash() {
    const PX = 100, PY = 140, PW = 1080, PH = 500;
    const MID = PX + Math.floor(PW / 2);  // 640

    const bg = this._t(this.add.graphics());
    bg.fillStyle(0x12121e, 0.97);
    bg.fillRect(PX, PY, PW, PH);
    bg.lineStyle(1, 0x334466);
    bg.strokeRect(PX, PY, PW, PH);
    bg.lineStyle(1, 0x223355);
    bg.lineBetween(MID, PY + 12, MID, PY + PH - 12);

    // Left column — stash
    let lx = PX + 20, ly = PY + 16;
    this._t(this.add.text(lx, ly, 'STASH', { fontSize: '13px', color: '#aaaacc', fontFamily: 'monospace' })); ly += 22;

    for (const { label, start, end } of STASH_SECTIONS) {
      this._t(this.add.text(lx, ly, label, { fontSize: '11px', color: '#556677', fontFamily: 'monospace' })); ly += 14;
      for (let i = start; i < end; i++) {
        const { label: name, detail, qty } = STASH_ITEMS[i];
        const qtyTag = qty > 1 ? `  ×${qty}` : '';
        this._t(this.add.text(lx + 8, ly,
          `${name.padEnd(18)} ${detail}${qtyTag}`,
          { fontSize: '12px', color: '#ffdd88', fontFamily: 'monospace' },
        )); ly += 16;
      }
      ly += 8;
    }

    // Right column — raider's pack
    let rx = MID + 20, ry = PY + 16;
    this._t(this.add.text(rx, ry, "RAIDER'S PACK", { fontSize: '13px', color: '#aaaacc', fontFamily: 'monospace' })); ry += 22;
    this._t(this.add.text(rx, ry, '(empty)', { fontSize: '12px', color: '#445566', fontFamily: 'monospace' })); ry += 20;
    this._t(this.add.text(rx, ry,
      'Raider enters with default class starter gear.',
      { fontSize: '11px', color: '#445566', fontFamily: 'monospace' },
    )); ry += 18;
    this._t(this.add.text(rx, ry,
      'Equip raider — coming next pass',
      { fontSize: '10px', color: '#334455', fontFamily: 'monospace', fontStyle: 'italic' },
    ));
  }

  // ── Utility ───────────────────────────────────────────────────────────────────

  /** Track a Phaser object so it is destroyed when the view switches. */
  _t(obj) { this._panelObjs.push(obj); return obj; }
}
