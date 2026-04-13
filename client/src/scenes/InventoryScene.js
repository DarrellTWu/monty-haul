// client/src/scenes/InventoryScene.js
// Character sheet + inventory overlay. Launched/stopped by DungeonScene on Tab.
// Runs on top of HUDScene with a fixed camera.
//
// Displays:
//   Left panel  — character stats (name, level, HP, AC, ability scores)
//   Right panel — equipment slot (weapon) + bag (unequipped items)
//
// Clicking an equipped item unequips it; clicking a bag item equips it.
//
// PROTOTYPE NOTES:
// - Fighter ability scores are hardcoded here (no schema field yet).
//   TODO: derive from player.abilityScores once schema carries it.
// - Starting inventory is hardcoded as ['longsword'].
//   TODO: replace with server-authoritative inventory list when items system lands.

import { getRoom, sendEquip, sendUnequip } from '../network/ColyseusClient.js';

// Panel geometry (screen space, 1280 × 720).
const PANEL_X      = 190;
const PANEL_Y      = 110;
const PANEL_W      = 900;
const PANEL_H      = 480;
const DIVIDER_X    = PANEL_X + 430;  // left/right column split

// Prototype: fighter stats (replace with server data when schema supports it).
const FIGHTER_SCORES = { STR: 16, DEX: 14, CON: 16, INT: 10, WIS: 10, CHA: 10 };
function mod(score) { return Math.floor((score - 10) / 2); }
function modStr(score) { const m = mod(score); return (m >= 0 ? '+' : '') + m; }

// Prototype: the fighter's starting bag contents.
// When multiple players or different classes exist this must come from server state.
const STARTING_BAG = ['longsword'];

const WEAPON_DISPLAY = {
  longsword: { label: 'Longsword',   detail: '1d8  slashing' },
  shortsword:{ label: 'Shortsword',  detail: '1d6  piercing' },
  unarmed:   { label: 'Unarmed',     detail: '1d4  bludgeoning' },
};

const STYLE_HEADER   = { fontSize: '18px', color: '#ffffff',  fontFamily: 'monospace', fontStyle: 'bold' };
const STYLE_SUBHEAD  = { fontSize: '13px', color: '#aaaacc',  fontFamily: 'monospace' };
const STYLE_BODY     = { fontSize: '13px', color: '#cccccc',  fontFamily: 'monospace' };
const STYLE_ITEM     = { fontSize: '13px', color: '#ffdd88',  fontFamily: 'monospace' };
const STYLE_MUTED    = { fontSize: '12px', color: '#666688',  fontFamily: 'monospace' };
const STYLE_HINT     = { fontSize: '11px', color: '#556677',  fontFamily: 'monospace' };

export class InventoryScene extends Phaser.Scene {
  constructor() {
    super({ key: 'InventoryScene' });
  }

  create() {
    this.cameras.main.setScroll(0, 0);

    // ── Background overlay ────────────────────────────────────────────────────
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.72);
    overlay.fillRect(0, 0, 1280, 720);

    // Panel background.
    overlay.fillStyle(0x12121e, 0.97);
    overlay.fillRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H);
    overlay.lineStyle(1, 0x334466);
    overlay.strokeRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H);

    // Divider line between columns.
    overlay.lineStyle(1, 0x223355);
    overlay.lineBetween(DIVIDER_X, PANEL_Y + 16, DIVIDER_X, PANEL_Y + PANEL_H - 16);

    // ── Left column — character stats ─────────────────────────────────────────
    const lx = PANEL_X + 24;
    let ly = PANEL_Y + 22;

    this.add.text(lx, ly, 'CHARACTER', STYLE_SUBHEAD);
    ly += 26;
    this._nameText = this.add.text(lx, ly, 'Fighter', STYLE_HEADER);
    ly += 28;
    this._levelText = this.add.text(lx, ly, 'Level 1', STYLE_BODY);
    ly += 22;
    this._hpText = this.add.text(lx, ly, 'HP  —', STYLE_BODY);
    ly += 20;
    this._acText = this.add.text(lx, ly, 'AC  —', STYLE_BODY);
    ly += 30;

    // Ability scores.
    this.add.text(lx, ly, 'ABILITY SCORES', STYLE_SUBHEAD);
    ly += 20;

    this._abilityTexts = {};
    for (const [stat, score] of Object.entries(FIGHTER_SCORES)) {
      const line = `${stat.padEnd(4)}  ${String(score).padStart(2)}   (${modStr(score)})`;
      this._abilityTexts[stat] = this.add.text(lx, ly, line, STYLE_BODY);
      ly += 19;
    }

    // ── Right column — equipment + inventory ──────────────────────────────────
    const rx = DIVIDER_X + 24;
    let ry = PANEL_Y + 22;

    this.add.text(rx, ry, 'EQUIPMENT', STYLE_SUBHEAD);
    ry += 20;

    // Weapon slot row.
    this.add.text(rx, ry, 'Weapon', { ...STYLE_MUTED });
    ry += 18;

    this._equippedBtn = this._makeItemButton(rx, ry, '—  (empty)');
    this._equippedBtn.on('pointerdown', () => this._onEquippedClick());
    ry += 36;

    // Armor slot row (display only — no equip/unequip UI yet).
    this.add.text(rx, ry, 'Armor', { ...STYLE_MUTED });
    ry += 18;
    this._armorText = this.add.text(rx, ry, '—  (none)', STYLE_BODY);
    ry += 28;

    // Bag section.
    this.add.text(rx, ry, 'BAG', STYLE_SUBHEAD);
    ry += 20;

    this._bagBtns = [];
    for (const id of STARTING_BAG) {
      const btn = this._makeItemButton(rx, ry, this._weaponLabel(id));
      btn.setData('itemId', id);
      btn.on('pointerdown', () => this._onBagClick(id));
      this._bagBtns.push({ id, btn, baseY: ry });
      ry += 36;
    }

    // ── Footer hint ───────────────────────────────────────────────────────────
    this.add.text(
      PANEL_X + PANEL_W - 12,
      PANEL_Y + PANEL_H - 10,
      'TAB  close',
      STYLE_HINT,
    ).setOrigin(1, 1);

    // Tab closes the inventory.
    this.input.keyboard.on('keydown-TAB', () => {
      this.scene.stop();
    });

    // Initial render.
    this._refresh();
  }

  // Called each frame — keeps HP / equipped weapon in sync with server state.
  update() {
    this._refresh();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _refresh() {
    const room = getRoom();
    if (!room) return;
    const player = room.state.players.get(room.sessionId);
    if (!player) return;

    this._hpText.setText(`HP   ${player.hp} / ${player.maxHp}`);
    this._acText.setText(`AC   ${player.ac}`);

    const equipped = player.equippedWeaponId;
    const bagContainsLongsword = !equipped || equipped === '';

    // Equipped slot button — weapon label + ability modifier shown separately.
    if (equipped) {
      const strMod = mod(FIGHTER_SCORES.STR);
      const modLabel = (strMod >= 0 ? '+' : '') + strMod + ' STR';
      this._equippedBtn
        .setText(`⚔  ${this._weaponLabel(equipped)}   ${modLabel}`)
        .setStyle({ ...STYLE_ITEM, backgroundColor: '#1a1a2e' });
    } else {
      this._equippedBtn
        .setText('—  (empty)')
        .setStyle({ ...STYLE_MUTED, backgroundColor: '#111118' });
    }

    // Armor slot — read from server state.
    const armorId = player.equippedArmorId;
    if (armorId) {
      const ARMOR_LABEL = { chain_mail: 'Chain Mail — AC 16  (heavy, STR 13)' };
      this._armorText.setText(ARMOR_LABEL[armorId] || armorId);
    } else {
      this._armorText.setText('—  (none)');
    }

    // Bag buttons — hide items that are currently equipped.
    for (const { id, btn } of this._bagBtns) {
      const inBag = !equipped || equipped !== id;
      btn.setVisible(inBag);
    }
  }

  _onEquippedClick() {
    const room = getRoom();
    if (!room) return;
    const player = room.state.players.get(room.sessionId);
    if (!player || !player.equippedWeaponId) return;
    sendUnequip('weapon');
  }

  _onBagClick(itemId) {
    sendEquip(itemId);
  }

  _weaponLabel(id) {
    const def = WEAPON_DISPLAY[id];
    if (!def) return id;
    return `${def.label.padEnd(12)}  ${def.detail}`;
  }

  /**
   * Creates a clickable text button for an inventory item.
   * @returns {Phaser.GameObjects.Text}
   */
  _makeItemButton(x, y, label) {
    const btn = this.add.text(x, y, label, {
      ...STYLE_ITEM,
      backgroundColor: '#1a1a2e',
      padding: { x: 10, y: 6 },
    })
      .setInteractive({ useHandCursor: true })
      .on('pointerover',  function() { this.setStyle({ backgroundColor: '#2a2a4e' }); })
      .on('pointerout',   function() { this.setStyle({ backgroundColor: '#1a1a2e' }); });
    return btn;
  }
}
