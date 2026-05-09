// client/src/scenes/HubScene.js
// Hub layout: left panel cycles through sub-screens (Class, Stash, future additions);
// right panel is a persistent Raider Config summary. Enter Dungeon lives on the right.

import {
  getStash, getRaiderPack, stashToRaider, raiderToStash, getHubGold,
  buyItem, sellItem, craftRecipe, dumpRaiderPackToStash,
  initFromServer, getPlayerId,
} from '../store/stash.js';
import { HubAPI } from '../network/HubAPI.js';
import { VENDOR_CATALOG } from '../../../shared/data/shop.js';
import { sellPrice } from '../../../shared/data/values.js';
import { BENCH_REGISTRY } from '../../../shared/data/crafting/benches.js';
import { recipesForBench } from '../../../shared/data/crafting/recipes.js';
import { CLASS_REGISTRY } from '../../../shared/data/classes/index.js';
import { POINT_BUY_BUDGET, POINT_COST, SCORE_MIN, SCORE_MAX } from '../../../shared/data/constants.js';

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
  padded:              { label: 'Padded',           detail: 'AC 11+DEX  light' },
  leather:             { label: 'Leather',          detail: 'AC 11+DEX  light' },
  studded_leather:     { label: 'Studded Leather',  detail: 'AC 12+DEX  light' },
  hide:                { label: 'Hide',             detail: 'AC 12+DEX  med'   },
  chain_shirt:         { label: 'Chain Shirt',      detail: 'AC 13+DEX  med'   },
  scale_mail:          { label: 'Scale Mail',       detail: 'AC 14+DEX  med'   },
  breastplate:         { label: 'Breastplate',      detail: 'AC 14+DEX  med'   },
  ring_mail:           { label: 'Ring Mail',        detail: 'AC 14  heavy'     },
  chain_mail:          { label: 'Chain Mail',       detail: 'AC 16  heavy'     },
  splint:              { label: 'Splint',           detail: 'AC 17  heavy'     },
  half_plate:          { label: 'Half Plate',       detail: 'AC 15+DEX  med'   },
  plate:               { label: 'Plate',            detail: 'AC 18  heavy'     },
  shield:              { label: 'Shield',           detail: '+2 AC'            },
  healing_potion:      { label: 'Healing Potion',   detail: '2d4+2 HP'         },
  bless_potion:        { label: 'Bless Potion',     detail: '+1d4 atk 60s'     },
  longstrider_potion:  { label: 'Longstrider Pot',  detail: '+10ft spd 2m'     },
  false_life_potion:   { label: 'False Life Pot',   detail: '1d4+4 tmp HP 2m'  },
  skeleton_bone:       { label: 'Skeleton Bone',    detail: 'crafting material'},
  wolf_pelt:           { label: 'Wolf Pelt',        detail: 'crafting material'},
};

const STASH_ORDER = [
  'longsword','shortsword','dagger','handaxe','mace','greataxe','greatsword',
  'padded','leather','studded_leather',
  'hide','chain_shirt','scale_mail','breastplate','half_plate',
  'ring_mail','chain_mail','splint','plate',
  'shield',
  'healing_potion','longstrider_potion','false_life_potion','bless_potion',
  'skeleton_bone','wolf_pelt',
];

const ARMOR_IDS = [
  'padded','leather','studded_leather',
  'hide','chain_shirt','scale_mail','breastplate','half_plate',
  'ring_mail','chain_mail','splint','plate',
];

const STASH_SECTIONS = [
  { label: 'Weapons',        ids: new Set(['longsword','shortsword','dagger','handaxe','mace','greataxe','greatsword']) },
  { label: 'Armor & Shield', ids: new Set([...ARMOR_IDS, 'shield']) },
  { label: 'Potions',        ids: new Set(['healing_potion','bless_potion','longstrider_potion','false_life_potion']) },
  { label: 'Materials',      ids: new Set(['skeleton_bone','wolf_pelt']) },
];

// Stat labels for the point buy UI, in display order.
const STAT_KEYS   = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const STAT_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };

function scoreMod(score) { return Math.floor((score - 10) / 2); }
function scoreModStr(score) { const m = scoreMod(score); return `(${m >= 0 ? '+' : ''}${m})`; }
function pointsSpent(scores) {
  return STAT_KEYS.reduce((sum, k) => sum + (POINT_COST[scores[k]] ?? 0), 0);
}

// Class display metadata for the hub UI.
// defaultScores: the recommended standard-array allocation for each class (costs exactly 27 pts).
const CLASS_DISPLAY = {
  fighter: {
    label: 'Fighter',
    traits: [
      'Longsword · Chain Mail',
      'Second Wind — 1d10+level HP (1/rest)',
      'Fighting Style: Dueling (+2 dmg)',
    ],
    defaultScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  monk: {
    label: 'Monk',
    traits: [
      'Shortsword · Unarmored Defense (AC = 10+DEX+WIS)',
      'Martial Arts — DEX attacks, d4 unarmed',
      'Bonus unarmed strike after monk weapon attack',
    ],
    defaultScores: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  barbarian: {
    label: 'Barbarian',
    traits: [
      'Greatsword · Chain Mail',
      'Rage — +2 dmg, resist physical dmg (2 uses, 30s)',
    ],
    defaultScores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 },
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
    this._selectedClass  = null;
    this._abilityScores  = null;
    this._leftView       = this._initData.view === 'stash' ? 'stash' : 'class';
    this._shopVendor     = 'potions';
    this._craftBench     = 'forge';
    this._leftObjs       = [];
    this._rightObjs      = [];
    this._loginObjs      = [];
    this._keyHandler     = null;

    const playerId = getPlayerId();
    if (!playerId) {
      this._showLoginScreen();
      return;
    }

    this._loadingText = this.add.text(640, 360, 'Loading...', {
      fontSize: '18px', color: '#556677', fontFamily: 'monospace',
    }).setOrigin(0.5);

    this._loadHubFromServer(playerId);
  }

  // ── Login flow ────────────────────────────────────────────────────────────────

  _showLoginScreen() {
    const cx = 640, cy = 340;

    this._loginObjs.push(this.add.text(cx, cy - 120, "MONTY HAUL'S DUNGEON CRAWL", {
      fontSize: '26px', color: '#ffdd88', fontFamily: 'monospace',
    }).setOrigin(0.5));

    const panel = this.add.graphics();
    panel.fillStyle(0x12121e, 0.97);
    panel.fillRect(cx - 240, cy - 70, 480, 180);
    panel.lineStyle(1, 0x334466);
    panel.strokeRect(cx - 240, cy - 70, 480, 180);
    this._loginObjs.push(panel);

    this._loginObjs.push(this.add.text(cx, cy - 44, 'RAIDER NAME', {
      fontSize: '12px', color: '#556677', fontFamily: 'monospace',
    }).setOrigin(0.5));

    this._loginInputDisplay = this.add.text(cx, cy - 8, '█', {
      fontSize: '22px', color: '#ffcc44', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this._loginObjs.push(this._loginInputDisplay);

    this._loginObjs.push(this.add.graphics()
      .lineStyle(1, 0x334466)
      .lineBetween(cx - 200, cy + 22, cx + 200, cy + 22));

    this._loginStatusText = this.add.text(cx, cy + 44, 'type your name and press Enter', {
      fontSize: '11px', color: '#445566', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this._loginObjs.push(this._loginStatusText);

    const enterBtn = this.add.text(cx, cy + 80, '[ Enter the Dungeon ]', {
      fontSize: '15px', color: '#334455', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this._loginObjs.push(enterBtn);
    this._loginEnterBtn = enterBtn;

    this._loginUsername = '';

    this._keyHandler = (e) => {
      if (e.key === 'Backspace') {
        this._loginUsername = this._loginUsername.slice(0, -1);
      } else if (e.key === 'Enter') {
        if (this._loginUsername.trim()) this._submitLogin();
      } else if (e.key.length === 1 && this._loginUsername.length < 20) {
        this._loginUsername += e.key;
      }
      const display = this._loginUsername || '';
      this._loginInputDisplay?.setText(display + '█');
      const ready = !!this._loginUsername.trim();
      this._loginEnterBtn?.setColor(ready ? '#ffcc44' : '#334455');
      if (ready) {
        this._loginEnterBtn?.setInteractive();
        this._loginEnterBtn?.removeAllListeners();
        this._loginEnterBtn?.on('pointerdown', () => this._submitLogin());
        this._loginEnterBtn?.on('pointerover', () => this._loginEnterBtn.setColor('#ffffff'));
        this._loginEnterBtn?.on('pointerout',  () => this._loginEnterBtn.setColor('#ffcc44'));
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  async _submitLogin() {
    const username = this._loginUsername.trim();
    if (!username) return;
    this._loginStatusText?.setText('Connecting...');
    this._loginEnterBtn?.setColor('#556677');

    try {
      const data = await HubAPI.login(username);
      if (!data.ok) {
        this._loginStatusText?.setText('Could not connect — is the server running?');
        return;
      }
      this._cleanupLogin();
      initFromServer(data.playerId, data);
      this._buildHub();
    } catch {
      this._loginStatusText?.setText('Could not connect — is the server running?');
    }
  }

  async _loadHubFromServer(playerId) {
    try {
      const data = await HubAPI.getState(playerId);
      this._loadingText?.destroy();
      this._loadingText = null;
      if (!data.ok) {
        // Player not in server store (server restarted) — fall back to login.
        localStorage.removeItem('mh_player_id');
        this._showLoginScreen();
        return;
      }
      initFromServer(playerId, data);
      this._buildHub();
    } catch {
      this._loadingText?.destroy();
      this._loadingText = null;
      this._showLoginScreen();
    }
  }

  _cleanupLogin() {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    for (const obj of this._loginObjs) obj.destroy();
    this._loginObjs = [];
    this._loginInputDisplay = null;
    this._loginStatusText   = null;
    this._loginEnterBtn     = null;
  }

  // ── Hub build (was create() body) ─────────────────────────────────────────────

  _buildHub() {
    this.add.text(640, 38, "MONTY HAUL'S DUNGEON CRAWL", {
      fontSize: '26px', color: '#ffdd88', fontFamily: 'monospace',
    }).setOrigin(0.5);

    this.add.text(RP.x + RP.w, 30, 'VAULT', {
      fontSize: '10px', color: '#556677', fontFamily: 'monospace',
    }).setOrigin(1, 0);
    this._vaultGoldText = this.add.text(RP.x + RP.w, 42, `${getHubGold()} gp`, {
      fontSize: '15px', color: '#ffcc44', fontFamily: 'monospace',
    }).setOrigin(1, 0);

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
    const tabs = [
      { id: 'class', label: 'Class' },
      { id: 'stash', label: 'Stash' },
      { id: 'shop',  label: 'Shop'  },
      { id: 'craft', label: 'Craft' },
    ];
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
    if      (this._leftView === 'class') this._showClassScreen();
    else if (this._leftView === 'shop')  this._showShopScreen();
    else if (this._leftView === 'craft') this._showCraftScreen();
    else                                 this._showStashScreen();
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
      y += 10;
      this._showAbilityScores(x, y);
    } else {
      this._l(this.add.text(x + 8, y, 'Select a class to see details.', {
        fontSize: '12px', color: '#334455', fontFamily: 'monospace',
      }));
    }
  }

  _refreshClassScreen() {
    for (const obj of this._leftObjs) obj.destroy();
    this._leftObjs = [];
    this._showClassScreen();
  }

  _showAbilityScores(x, startY) {
    let y = startY;
    const scores  = this._abilityScores;
    const spent   = pointsSpent(scores);
    const remaining = POINT_BUY_BUDGET - spent;

    this._l(this.add.text(x, y, 'ABILITY SCORES', {
      fontSize: '11px', color: '#aaaacc', fontFamily: 'monospace',
    }));
    this._l(this.add.text(LP.x + LP.w - 20, y,
      `Points: ${remaining} / ${POINT_BUY_BUDGET}`,
      { fontSize: '11px', color: remaining === 0 ? '#88ccaa' : '#ffcc44', fontFamily: 'monospace' },
    ).setOrigin(1, 0));
    y += 16;

    this._l(this.add.graphics()
      .lineStyle(1, 0x223355)
      .lineBetween(x, y, LP.x + LP.w - 20, y));
    y += 10;

    for (const key of STAT_KEYS) {
      const score   = scores[key];
      const cost    = POINT_COST[score] ?? 0;
      const nextCost = POINT_COST[score + 1] ?? 999;
      const canDec  = score > SCORE_MIN;
      const canInc  = score < SCORE_MAX && (nextCost - cost) <= remaining;

      const decBtn = this._l(this.add.text(x + 8, y, '[ − ]', {
        fontSize: '12px',
        color: canDec ? '#88ccff' : '#334455',
        fontFamily: 'monospace',
      }));
      if (canDec) {
        decBtn.setInteractive();
        decBtn.on('pointerover', () => decBtn.setColor('#ffffff'));
        decBtn.on('pointerout',  () => decBtn.setColor('#88ccff'));
        decBtn.on('pointerdown', () => {
          this._abilityScores[key] = score - 1;
          this._refreshClassScreen();
        });
      }

      this._l(this.add.text(x + 55, y,
        `${STAT_LABELS[key]}  ${String(score).padStart(2)}  ${scoreModStr(score)}`,
        { fontSize: '12px', color: '#cccccc', fontFamily: 'monospace' },
      ));

      const incCost  = nextCost - cost;
      const incLabel = score < SCORE_MAX ? `[+](${incCost})` : '[ + ]';
      const incBtn = this._l(this.add.text(x + 168, y, incLabel, {
        fontSize: '12px',
        color: canInc ? '#88ccff' : '#334455',
        fontFamily: 'monospace',
      }));
      if (canInc) {
        incBtn.setInteractive();
        incBtn.on('pointerover', () => incBtn.setColor('#ffffff'));
        incBtn.on('pointerout',  () => incBtn.setColor('#88ccff'));
        incBtn.on('pointerdown', () => {
          this._abilityScores[key] = score + 1;
          this._refreshClassScreen();
        });
      }

      y += 18;
    }

    y += 4;
    this._l(this.add.graphics()
      .lineStyle(1, 0x223355)
      .lineBetween(x, y, LP.x + LP.w - 20, y));
    y += 10;

    const classDef = CLASS_REGISTRY[this._selectedClass];
    if (classDef) {
      const conMod = scoreMod(scores.con);
      const hp     = Math.floor((classDef.hitDie + conMod) * 2);
      this._l(this.add.text(x + 8, y, `Estimated starting HP: ${hp}`, {
        fontSize: '11px', color: '#88ccaa', fontFamily: 'monospace',
      }));
      y += 18;
    }

    const resetBtn = this._l(this.add.text(x + 8, y, '[ Reset to Class Defaults ]', {
      fontSize: '11px', color: '#8888aa', fontFamily: 'monospace',
    }).setInteractive());
    resetBtn.on('pointerover', () => resetBtn.setColor('#aabbdd'));
    resetBtn.on('pointerout',  () => resetBtn.setColor('#8888aa'));
    resetBtn.on('pointerdown', () => {
      this._abilityScores = { ...CLASS_DISPLAY[this._selectedClass].defaultScores };
      this._refreshClassScreen();
    });
  }

  _showStashScreen() {
    const stash = getStash();
    const x = LP.x + 20;
    let y = LP.y + 52;

    this._l(this.add.text(x, y, 'STASH', {
      fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
    }));
    this._l(this.add.text(LP.x + LP.w - 20, y, 'click row → pack  ·  [ Sell ] → vault', {
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
        row.on('pointerdown',  () => {
          stashToRaider(id).then(ok => { if (ok) this._onPackChanged(); });
        });

        const price = sellPrice(id);
        if (price > 0) {
          const sellBtn = this._l(this.add.text(LP.x + LP.w - 20, y, `[ Sell ${price} gp ]`, {
            fontSize: '11px', color: '#88ccff', fontFamily: 'monospace',
          }).setOrigin(1, 0).setInteractive());
          sellBtn.on('pointerover', () => sellBtn.setColor('#ffffff'));
          sellBtn.on('pointerout',  () => sellBtn.setColor('#88ccff'));
          sellBtn.on('pointerdown', () => {
            sellItem(id).then(ok => { if (ok) this._onSold(); });
          });
        }

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

  _showShopScreen() {
    const x = LP.x + 20;
    let   y = LP.y + 52;

    this._l(this.add.text(x, y, 'SHOP', {
      fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
    }));
    this._l(this.add.text(LP.x + LP.w - 20, y, 'click [ Buy ] to add to stash  ›', {
      fontSize: '10px', color: '#445566', fontFamily: 'monospace',
    }).setOrigin(1, 0));
    y += 22;

    const vendors = [{ id: 'potions', label: 'Potion Vendor' }, { id: 'armor', label: 'Armor Vendor' }];
    let vx = x;
    for (const { id, label } of vendors) {
      const active = this._shopVendor === id;
      const btn = this._l(this.add.text(vx, y, `[ ${label} ]`, {
        fontSize: '13px',
        color: active ? '#ffcc44' : '#8888aa',
        fontFamily: 'monospace',
      }).setInteractive());
      btn.on('pointerover', () => { if (this._shopVendor !== id) btn.setColor('#aabbdd'); });
      btn.on('pointerout',  () => { if (this._shopVendor !== id) btn.setColor('#8888aa'); });
      btn.on('pointerdown', () => {
        if (this._shopVendor === id) return;
        this._shopVendor = id;
        this._refreshShopScreen();
      });
      vx += btn.width + 16;
    }
    y += 28;

    this._l(this.add.graphics()
      .lineStyle(1, 0x223355)
      .lineBetween(x, y, LP.x + LP.w - 20, y));
    y += 12;

    const gold  = getHubGold();
    const items = VENDOR_CATALOG[this._shopVendor] ?? [];

    for (const { id, price } of items) {
      const meta       = ITEM_META[id] ?? { label: id, detail: '' };
      const affordable = gold >= price;
      const itemColor  = affordable ? '#ffdd88' : '#445566';

      this._l(this.add.text(x + 8, y,
        `${meta.label.padEnd(18)} ${meta.detail.padEnd(20)} ${String(price).padStart(5)} gp`,
        { fontSize: '12px', color: itemColor, fontFamily: 'monospace' },
      ));

      const buyX = LP.x + LP.w - 24;
      const buyBtn = this._l(this.add.text(buyX, y, '[ Buy ]', {
        fontSize: '12px',
        color: affordable ? '#88ccff' : '#334455',
        fontFamily: 'monospace',
      }).setOrigin(1, 0));

      if (affordable) {
        buyBtn.setInteractive();
        buyBtn.on('pointerover', () => buyBtn.setColor('#ffffff'));
        buyBtn.on('pointerout',  () => buyBtn.setColor('#88ccff'));
        buyBtn.on('pointerdown', () => {
          buyItem(id).then(ok => { if (ok) this._onPurchase(); });
        });
      }

      y += 18;
    }
  }

  _refreshVault() {
    if (this._vaultGoldText) this._vaultGoldText.setText(`${getHubGold()} gp`);
  }

  _refreshShopScreen() {
    for (const obj of this._leftObjs) obj.destroy();
    this._leftObjs = [];
    this._showShopScreen();
  }

  _onPurchase() {
    this._refreshVault();
    this._refreshShopScreen();
  }

  // ── Crafting screen ──────────────────────────────────────────────────────────

  _showCraftScreen() {
    const x = LP.x + 20;
    let   y = LP.y + 52;

    this._l(this.add.text(x, y, 'CRAFTING', {
      fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
    }));
    this._l(this.add.text(LP.x + LP.w - 20, y, 'click [ Craft ] to consume mats  ›', {
      fontSize: '10px', color: '#445566', fontFamily: 'monospace',
    }).setOrigin(1, 0));
    y += 22;

    let bx = x;
    for (const bench of Object.values(BENCH_REGISTRY)) {
      const active = this._craftBench === bench.id;
      const btn = this._l(this.add.text(bx, y, `[ ${bench.label} ]`, {
        fontSize: '12px',
        color: active ? '#ffcc44' : (bench.status === 'open' ? '#8888aa' : '#556677'),
        fontFamily: 'monospace',
      }).setInteractive());
      btn.on('pointerover', () => { if (this._craftBench !== bench.id) btn.setColor('#aabbdd'); });
      btn.on('pointerout',  () => {
        if (this._craftBench !== bench.id) {
          btn.setColor(bench.status === 'open' ? '#8888aa' : '#556677');
        }
      });
      btn.on('pointerdown', () => {
        if (this._craftBench === bench.id) return;
        this._craftBench = bench.id;
        this._refreshCraftScreen();
      });
      bx += btn.width + 10;
    }
    y += 26;

    this._l(this.add.graphics()
      .lineStyle(1, 0x223355)
      .lineBetween(x, y, LP.x + LP.w - 20, y));
    y += 12;

    const bench = BENCH_REGISTRY[this._craftBench];
    this._l(this.add.text(x, y, bench.label.toUpperCase(), {
      fontSize: '14px', color: '#ccddff', fontFamily: 'monospace', fontStyle: 'bold',
    })); y += 18;
    this._l(this.add.text(x, y, bench.blurb, {
      fontSize: '11px', color: '#778899', fontFamily: 'monospace',
    })); y += 22;

    if (bench.status !== 'open') {
      this._l(this.add.text(x + 8, y, '(coming soon)', {
        fontSize: '12px', color: '#445566', fontFamily: 'monospace',
      }));
      return;
    }

    const stash   = getStash();
    const stashOf = (id) => (stash.find(e => e.id === id)?.qty ?? 0);
    const recipes = recipesForBench(bench.id);

    if (recipes.length === 0) {
      this._l(this.add.text(x + 8, y, '(no recipes available)', {
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
      this._l(this.add.text(x + 8, y, recipe.label.padEnd(14), {
        fontSize: '12px', color: rowColor, fontFamily: 'monospace',
      }));
      this._l(this.add.text(x + 8 + 110, y, `${inputsStr}  →  ${outStr}`, {
        fontSize: '12px', color: rowColor, fontFamily: 'monospace',
      }));

      const buyX = LP.x + LP.w - 24;
      const craftBtn = this._l(this.add.text(buyX, y, '[ Craft ]', {
        fontSize: '12px',
        color: affordable ? '#88ccff' : '#334455',
        fontFamily: 'monospace',
      }).setOrigin(1, 0));

      if (affordable) {
        craftBtn.setInteractive();
        craftBtn.on('pointerover', () => craftBtn.setColor('#ffffff'));
        craftBtn.on('pointerout',  () => craftBtn.setColor('#88ccff'));
        craftBtn.on('pointerdown', () => {
          craftRecipe(recipe.id).then(ok => { if (ok) this._onCraft(); });
        });
      }
      y += 20;
    }
  }

  _refreshCraftScreen() {
    for (const obj of this._leftObjs) obj.destroy();
    this._leftObjs = [];
    this._showCraftScreen();
  }

  _onCraft() {
    this._refreshCraftScreen();
  }

  _selectClass(classId) {
    this._selectedClass = classId;
    this._abilityScores = { ...CLASS_DISPLAY[classId].defaultScores };
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

    this._r(this.add.graphics()
      .lineStyle(1, 0x223355)
      .lineBetween(RP.x + 8, y, RP.x + RP.w - 8, y));
    y += 12;

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
        row.on('pointerdown',  () => {
          raiderToStash(id).then(ok => { if (ok) this._onPackChanged(); });
        });
        y += 16;
      }

      y += 4;
      const dumpBtn = this._r(this.add.text(x + 8, y, '[ Dump All to Stash ]', {
        fontSize: '11px', color: '#aabbdd', fontFamily: 'monospace',
      }).setInteractive());
      dumpBtn.on('pointerover', () => dumpBtn.setColor('#ffffff'));
      dumpBtn.on('pointerout',  () => dumpBtn.setColor('#aabbdd'));
      dumpBtn.on('pointerdown', () => {
        dumpRaiderPackToStash().then(ok => { if (ok) this._onPackChanged(); });
      });
    }

    const active = !!this._selectedClass;
    const btnY   = RP.y + RP.h - 36;
    const enterBtn = this._r(this.add.text(RP.x + RP.w / 2, btnY, '[ Enter Dungeon ]', {
      fontSize: '18px', color: active ? '#ffcc44' : '#334455', fontFamily: 'monospace',
    }).setOrigin(0.5).setInteractive());
    enterBtn.on('pointerover',  () => { if (active) enterBtn.setColor('#ffffff'); });
    enterBtn.on('pointerout',   () => { enterBtn.setColor(active ? '#ffcc44' : '#334455'); });
    enterBtn.on('pointerdown',  () => {
      if (active) this.scene.start('DungeonScene', {
        class: this._selectedClass,
        abilityScores: this._abilityScores ?? { ...CLASS_DISPLAY[this._selectedClass].defaultScores },
      });
    });
  }

  _onPackChanged() {
    if (this._leftView === 'stash') {
      for (const obj of this._leftObjs) obj.destroy();
      this._leftObjs = [];
      this._showStashScreen();
    }
    this._buildRaiderPanel();
  }

  _onSold() {
    this._refreshVault();
    if (this._leftView === 'stash') {
      for (const obj of this._leftObjs) obj.destroy();
      this._leftObjs = [];
      this._showStashScreen();
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────

  _l(obj) { this._leftObjs.push(obj);  return obj; }
  _r(obj) { this._rightObjs.push(obj); return obj; }
}
