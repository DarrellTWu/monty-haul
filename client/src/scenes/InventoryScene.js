// client/src/scenes/InventoryScene.js
// Character sheet + inventory overlay. Launched/stopped by DungeonScene on Tab.
// Runs on top of HUDScene with a fixed camera.
//
// Displays:
//   Left panel  — character stats (name, level, HP, AC, ability scores)
//   Right panel — equipment slots (weapon, shield, armor) + bag (server inventory)
//
// Clicking an equipped item unequips it; clicking a bag item equips it.
// SRD constraints are enforced server-side; the UI grays out blocked items.
//
// PROTOTYPE NOTES:
// - Fighter ability scores are hardcoded here (no schema field yet).
//   TODO: derive from player.abilityScores once schema carries it.

import { getRoom, sendEquip, sendUnequip } from '../network/ColyseusClient.js';

// Panel geometry (screen space, 1280 × 720).
const PANEL_X   = 190;
const PANEL_Y   = 110;
const PANEL_W   = 900;
const PANEL_H   = 480;
const DIVIDER_X = PANEL_X + 430; // left/right column split

// Prototype: fighter stats (replace with server data when schema supports it).
const FIGHTER_SCORES = { STR: 16, DEX: 14, CON: 16, INT: 10, WIS: 10, CHA: 10 };
function mod(score) { return Math.floor((score - 10) / 2); }
function modStr(score) { const m = mod(score); return (m >= 0 ? '+' : '') + m; }

// Display metadata for weapons. Finesse/two-handed tags used for SRD hint display.
const WEAPON_DISPLAY = {
  longsword:  { label: 'Longsword',  detail: '1d8  slashing',    note: 'versatile (1d10)' },
  shortsword: { label: 'Shortsword', detail: '1d6  piercing',    note: 'finesse, light' },
  dagger:     { label: 'Dagger',     detail: '1d4  piercing',    note: 'finesse, light, thrown' },
  greataxe:   { label: 'Greataxe',   detail: '1d12 slashing',    note: 'two-handed' },
  handaxe:    { label: 'Handaxe',    detail: '1d6  slashing',    note: 'light, thrown' },
  unarmed:    { label: 'Unarmed',    detail: '1d4  bludgeoning', note: '' },
};

const SHIELD_DISPLAY = {
  shield: { label: 'Shield', detail: '+2 AC' },
};

const ARMOR_DISPLAY = {
  chain_mail: 'Chain Mail — AC 16  (heavy, STR 13)',
};

// Weapons that occupy both hands — cannot be used with a shield (SRD rule).
const TWO_HANDED_WEAPONS = new Set(['greataxe']);

const STYLE_HEADER  = { fontSize: '18px', color: '#ffffff',  fontFamily: 'monospace', fontStyle: 'bold' };
const STYLE_SUBHEAD = { fontSize: '13px', color: '#aaaacc',  fontFamily: 'monospace' };
const STYLE_BODY    = { fontSize: '13px', color: '#cccccc',  fontFamily: 'monospace' };
const STYLE_ITEM    = { fontSize: '13px', color: '#ffdd88',  fontFamily: 'monospace' };
const STYLE_BLOCKED = { fontSize: '13px', color: '#665544',  fontFamily: 'monospace' };
const STYLE_MUTED   = { fontSize: '12px', color: '#666688',  fontFamily: 'monospace' };
const STYLE_HINT    = { fontSize: '11px', color: '#556677',  fontFamily: 'monospace' };
const STYLE_NOTE    = { fontSize: '11px', color: '#556677',  fontFamily: 'monospace' };

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

    overlay.fillStyle(0x12121e, 0.97);
    overlay.fillRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H);
    overlay.lineStyle(1, 0x334466);
    overlay.strokeRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H);

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

    this.add.text(lx, ly, 'ABILITY SCORES', STYLE_SUBHEAD);
    ly += 20;

    for (const [stat, score] of Object.entries(FIGHTER_SCORES)) {
      const line = `${stat.padEnd(4)}  ${String(score).padStart(2)}   (${modStr(score)})`;
      this.add.text(lx, ly, line, STYLE_BODY);
      ly += 19;
    }

    // ── Right column — equipment + inventory ──────────────────────────────────
    const rx = DIVIDER_X + 24;
    let ry = PANEL_Y + 22;

    this.add.text(rx, ry, 'EQUIPMENT', STYLE_SUBHEAD);
    ry += 20;

    // Weapon slot.
    this.add.text(rx, ry, 'Weapon', { ...STYLE_MUTED });
    ry += 18;
    this._equippedBtn = this._makeItemButton(rx, ry, '—  (empty)');
    this._equippedBtn.on('pointerdown', () => this._onEquippedClick());
    this._equippedNote = this.add.text(rx, ry + 24, '', STYLE_NOTE);
    ry += 44;

    // Shield slot.
    this.add.text(rx, ry, 'Shield', { ...STYLE_MUTED });
    ry += 18;
    this._shieldBtn = this._makeItemButton(rx, ry, '—  (empty)');
    this._shieldBtn.on('pointerdown', () => this._onShieldClick());
    ry += 36;

    // Armor slot (display only).
    this.add.text(rx, ry, 'Armor', { ...STYLE_MUTED });
    ry += 18;
    this._armorText = this.add.text(rx, ry, '—  (none)', STYLE_BODY);
    ry += 32;

    // Bag.
    this.add.text(rx, ry, 'BAG', STYLE_SUBHEAD);
    ry += 20;
    this._bagStartY = ry;
    this._bagRx = rx;
    this._bagBtns = [];
    this._lastInventorySnapshot = '';

    // ── Footer hint ───────────────────────────────────────────────────────────
    this.add.text(
      PANEL_X + PANEL_W - 12,
      PANEL_Y + PANEL_H - 10,
      'TAB  close',
      STYLE_HINT,
    ).setOrigin(1, 1);

    this.input.keyboard.on('keydown-TAB', () => { this.scene.stop(); });

    this._refresh();
  }

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

    // ── Weapon slot ───────────────────────────────────────────────────────────
    const weapon = player.equippedWeaponId;
    if (weapon) {
      const strMod = mod(FIGHTER_SCORES.STR);
      const modLabel = (strMod >= 0 ? '+' : '') + strMod + ' STR';
      const wDef = WEAPON_DISPLAY[weapon];
      // Longsword deals 1d10 when two-handing (no shield) — show the active die.
      const dieLabel = (weapon === 'longsword' && !player.equippedShieldId)
        ? '1d10 slashing' : (wDef?.detail ?? weapon);
      this._equippedBtn
        .setText(`⚔  ${(wDef?.label ?? weapon).padEnd(12)}  ${dieLabel}   ${modLabel}`)
        .setStyle({ ...STYLE_ITEM, backgroundColor: '#1a1a2e' });
      this._equippedNote.setText(wDef?.note ?? '');
    } else {
      this._equippedBtn.setText('—  (empty)').setStyle({ ...STYLE_MUTED, backgroundColor: '#111118' });
      this._equippedNote.setText('');
    }

    // ── Shield slot ───────────────────────────────────────────────────────────
    const shield = player.equippedShieldId;
    if (shield) {
      const sDef = SHIELD_DISPLAY[shield];
      this._shieldBtn
        .setText(`🛡  ${(sDef?.label ?? shield).padEnd(12)}  ${sDef?.detail ?? ''}`)
        .setStyle({ ...STYLE_ITEM, backgroundColor: '#1a1a2e' });
    } else {
      this._shieldBtn.setText('—  (empty)').setStyle({ ...STYLE_MUTED, backgroundColor: '#111118' });
    }

    // ── Armor slot ────────────────────────────────────────────────────────────
    const armorId = player.equippedArmorId;
    this._armorText.setText(armorId ? (ARMOR_DISPLAY[armorId] ?? armorId) : '—  (none)');

    // ── Bag — rebuild only when inventory changes ─────────────────────────────
    const snapshot = [...player.inventory].join(',');
    if (snapshot !== this._lastInventorySnapshot) {
      this._rebuildBag(player);
      this._lastInventorySnapshot = snapshot;
    } else {
      // Still need to refresh blocked state as equip slots may have changed.
      for (const { id, btn, blockedText } of this._bagBtns) {
        const blocked = this._isBlocked(id, player);
        btn.setVisible(!blocked);
        blockedText.setVisible(blocked);
      }
    }
  }

  _rebuildBag(player) {
    for (const { btn, blockedText } of this._bagBtns) {
      btn.destroy();
      blockedText.destroy();
    }
    this._bagBtns = [];

    let ry = this._bagStartY;
    for (const itemId of player.inventory) {
      const label = this._itemLabel(itemId);
      const blocked = this._isBlocked(itemId, player);

      const btn = this._makeItemButton(this._bagRx, ry, label);
      if (!blocked) btn.on('pointerdown', () => this._onBagClick(itemId));

      // Grayed-out version shown when SRD constraint blocks the item.
      const blockedText = this.add.text(this._bagRx, ry, `${label}  (blocked)`, {
        ...STYLE_BLOCKED,
        backgroundColor: '#0d0d14',
        padding: { x: 10, y: 6 },
      }).setVisible(blocked);

      btn.setVisible(!blocked);
      this._bagBtns.push({ id: itemId, btn, blockedText });
      ry += 36;
    }
  }

  /** Returns true if equipping this item would violate an SRD rule given current state. */
  _isBlocked(itemId, player) {
    if (itemId === 'shield') {
      return TWO_HANDED_WEAPONS.has(player.equippedWeaponId);
    }
    if (TWO_HANDED_WEAPONS.has(itemId)) {
      return !!player.equippedShieldId;
    }
    return false;
  }

  _onEquippedClick() {
    const room = getRoom();
    if (!room) return;
    const player = room.state.players.get(room.sessionId);
    if (!player || !player.equippedWeaponId) return;
    sendUnequip('weapon');
  }

  _onShieldClick() {
    const room = getRoom();
    if (!room) return;
    const player = room.state.players.get(room.sessionId);
    if (!player || !player.equippedShieldId) return;
    sendUnequip('shield');
  }

  _onBagClick(itemId) {
    sendEquip(itemId);
  }

  /** Returns the display label for any equippable item id. */
  _itemLabel(id) {
    const w = WEAPON_DISPLAY[id];
    if (w) return `${w.label.padEnd(12)}  ${w.detail}`;
    const s = SHIELD_DISPLAY[id];
    if (s) return `${s.label.padEnd(12)}  ${s.detail}`;
    return id;
  }

  /**
   * Creates a clickable text button for an inventory item.
   * @returns {Phaser.GameObjects.Text}
   */
  _makeItemButton(x, y, label) {
    return this.add.text(x, y, label, {
      ...STYLE_ITEM,
      backgroundColor: '#1a1a2e',
      padding: { x: 10, y: 6 },
    })
      .setInteractive({ useHandCursor: true })
      .on('pointerover',  function() { this.setStyle({ backgroundColor: '#2a2a4e' }); })
      .on('pointerout',   function() { this.setStyle({ backgroundColor: '#1a1a2e' }); });
  }
}
