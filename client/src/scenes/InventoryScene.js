// client/src/scenes/InventoryScene.js
// Character sheet + inventory overlay. Open/close with I key.
//
// Left panel  — character stats, saving throws, class features (draggable to hotbar), feat
// Right panel — equipment slots (weapon, offhand), armor, bag (draggable items), hotbar
//
// INTERACTION MODEL:
//   Double-click bag item  → auto-equip to default slot
//   Single-click bag item  → select it (highlighted); click a slot to equip there
//   Drag bag item to slot  → equip to that specific slot
//   Drag ability to hotbar → bind to that key (1-0)
//   Click equipped slot    → if item selected: equip there; else: unequip
//
// SRD constraints are enforced server-side; the UI grays blocked items.
//
// PROTOTYPE NOTES:
//   Fighter ability scores are hardcoded (no schema field yet).

import { getRoom, sendEquip, sendUnequip, sendAssignHotbar } from '../network/ColyseusClient.js';

// Panel geometry (expanded height to fit saving throws + class features + hotbar).
const PANEL_X   = 190;
const PANEL_Y   = 80;
const PANEL_W   = 900;
const PANEL_H   = 560;
const DIVIDER_X = PANEL_X + 430;

// Prototype fighter stats.
const FIGHTER_SCORES   = { STR: 16, DEX: 14, CON: 16, INT: 10, WIS: 10, CHA: 10 };
const SAVE_PROFS       = new Set(['str', 'con']); // fighter level 1
const PROF_BONUS       = 2;
function mod(score)    { return Math.floor((score - 10) / 2); }
function modStr(score) { const m = mod(score); return (m >= 0 ? '+' : '') + m; }
function saveBonus(stat) {
  const m = mod(FIGHTER_SCORES[stat.toUpperCase()]);
  const p = SAVE_PROFS.has(stat) ? PROF_BONUS : 0;
  const t = m + p;
  return `${stat.toUpperCase().padEnd(4)} ${(t >= 0 ? '+' : '') + t}${SAVE_PROFS.has(stat) ? ' ●' : ''}`;
}

// Item display metadata.
const WEAPON_DISPLAY = {
  longsword:  { label: 'Longsword',  detail: '1d8  slashing',    note: 'versatile (1d10)' },
  shortsword: { label: 'Shortsword', detail: '1d6  piercing',    note: 'finesse, light' },
  dagger:     { label: 'Dagger',     detail: '1d4  piercing',    note: 'finesse · drag to offhand' },
  greataxe:   { label: 'Greataxe',   detail: '1d12 slashing',    note: 'two-handed' },
  handaxe:    { label: 'Handaxe',    detail: '1d6  slashing',    note: 'light, thrown' },
  mace:       { label: 'Mace',       detail: '1d6  bludgeoning', note: 'effective vs. skeletons' },
  unarmed:    { label: 'Unarmed',    detail: '1d4  bludgeoning', note: '' },
};

const SHIELD_DISPLAY = {
  shield: { label: 'Shield', detail: '+2 AC' },
};

const CONSUMABLE_DISPLAY = {
  healing_potion:    { label: 'Healing Potion',    detail: '2d4+2 HP',     short: 'Heal Pot' },
  bless_potion:      { label: 'Bless Potion',      detail: '+1d4 atk 60s', short: 'Bless'    },
  longstrider_potion: { label: 'Longstrider Pot',  detail: '+10ft spd 2m', short: 'Stride'   },
  false_life_potion:  { label: 'False Life Pot',   detail: '1d4+4 tmp HP 2m', short: 'F.Life' },
};

// Armor display: bag label and equipped-slot label are different sizes.
const ARMOR_BAG_DISPLAY = {
  chain_mail: { label: 'Chain Mail',  detail: 'AC 16  heavy' },
  half_plate: { label: 'Half Plate',  detail: 'AC 15+DEX med' },
};

// Full description shown in the equipped armor slot.
const ARMOR_SLOT_DISPLAY = {
  chain_mail: 'Chain Mail — AC 16  (heavy, STR 13)',
  half_plate: 'Half Plate — AC 17  (medium, DEX capped +2)',
};

// Two-handed weapons cannot be used with any offhand item.
const TWO_HANDED_WEAPONS = new Set(['greataxe']);

// Text styles.
const STYLE_HEADER   = { fontSize: '18px', color: '#ffffff',  fontFamily: 'monospace', fontStyle: 'bold' };
const STYLE_SUBHEAD  = { fontSize: '12px', color: '#aaaacc',  fontFamily: 'monospace' };
const STYLE_BODY     = { fontSize: '12px', color: '#cccccc',  fontFamily: 'monospace' };
const STYLE_ITEM     = { fontSize: '12px', color: '#ffdd88',  fontFamily: 'monospace' };
const STYLE_SELECTED = { fontSize: '12px', color: '#88ddff',  fontFamily: 'monospace' };
const STYLE_BLOCKED  = { fontSize: '12px', color: '#554433',  fontFamily: 'monospace' };
const STYLE_MUTED    = { fontSize: '11px', color: '#666688',  fontFamily: 'monospace' };
const STYLE_HINT     = { fontSize: '10px', color: '#445566',  fontFamily: 'monospace' };
const STYLE_NOTE     = { fontSize: '10px', color: '#556677',  fontFamily: 'monospace' };
const STYLE_FEAT     = { fontSize: '11px', color: '#88aacc',  fontFamily: 'monospace' };

// Double-click threshold in ms.
const DBLCLICK_MS = 300;

export class InventoryScene extends Phaser.Scene {
  constructor() {
    super({ key: 'InventoryScene' });
  }

  create() {
    this.cameras.main.setScroll(0, 0);

    // Selection state: which bag item is currently selected (single-click).
    this._selectedItemId = null;

    // ── Background ────────────────────────────────────────────────────────────
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.72);
    overlay.fillRect(0, 0, 1280, 720);
    overlay.fillStyle(0x12121e, 0.97);
    overlay.fillRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H);
    overlay.lineStyle(1, 0x334466);
    overlay.strokeRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H);
    overlay.lineStyle(1, 0x223355);
    overlay.lineBetween(DIVIDER_X, PANEL_Y + 12, DIVIDER_X, PANEL_Y + PANEL_H - 12);

    // ── Left column ───────────────────────────────────────────────────────────
    const lx = PANEL_X + 20;
    let ly = PANEL_Y + 18;

    this.add.text(lx, ly, 'CHARACTER', STYLE_SUBHEAD); ly += 20;
    this._nameText = this.add.text(lx, ly, 'Fighter', STYLE_HEADER); ly += 24;
    this.add.text(lx, ly, 'Level 1  Human Fighter', STYLE_BODY); ly += 18;
    this._hpText = this.add.text(lx, ly, 'HP  —', STYLE_BODY); ly += 16;
    this._acText = this.add.text(lx, ly, 'AC  —', STYLE_BODY); ly += 20;

    // Ability scores.
    this.add.text(lx, ly, 'ABILITY SCORES', STYLE_SUBHEAD); ly += 16;
    for (const [stat, score] of Object.entries(FIGHTER_SCORES)) {
      this.add.text(lx, ly, `${stat.padEnd(4)}  ${String(score).padStart(2)}   (${modStr(score)})`, STYLE_BODY);
      ly += 15;
    }
    ly += 4;

    // Saving throws.
    this.add.text(lx, ly, 'SAVING THROWS  (● proficient)', STYLE_SUBHEAD); ly += 15;
    for (const stat of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      this.add.text(lx, ly, saveBonus(stat), STYLE_BODY);
      ly += 14;
    }
    ly += 6;

    // Class features.
    this.add.text(lx, ly, 'CLASS FEATURES', STYLE_SUBHEAD); ly += 15;
    this.add.text(lx, ly, 'Fighting Style: Dueling', STYLE_BODY); ly += 13;
    this.add.text(lx, ly, '+2 dmg (one-hand, no weapon offhand)', STYLE_NOTE); ly += 17;

    // Second Wind — draggable to hotbar.
    this._swText = this.add.text(lx, ly, '⚡ Second Wind  [READY]', STYLE_ITEM);
    this._swTextY = ly;
    this._makeDraggable(this._swText, 'second_wind', lx, ly);
    ly += 13;
    this.add.text(lx, ly, 'Heal 1d10+1 HP (1/short rest)  drag→hotbar', STYLE_NOTE); ly += 17;

    // Feat.
    this.add.text(lx, ly, 'FEAT: Alert  (variant human)', STYLE_FEAT); ly += 13;
    this.add.text(lx, ly, '+5 initiative, cannot be surprised', STYLE_NOTE);

    // ── Right column ──────────────────────────────────────────────────────────
    const rx = DIVIDER_X + 20;
    let ry = PANEL_Y + 18;

    this.add.text(rx, ry, 'EQUIPMENT', STYLE_SUBHEAD); ry += 16;

    // Weapon slot.
    this.add.text(rx, ry, 'Weapon', STYLE_MUTED); ry += 14;
    this._equippedBtn  = this._makeSlotButton(rx, ry, '—  (empty)');
    this._equippedBtn.setData({ originX: rx, originY: ry });
    this._equippedNote = this.add.text(rx, ry + 22, '', STYLE_NOTE);
    this._equippedHint = this.add.text(rx + 258, ry + 22, '', { ...STYLE_HINT, color: '#334455' }).setOrigin(1, 0);
    this._weaponDropGfx = this.add.graphics();
    this._weaponZone = this.add.zone(rx + 130, ry + 13, 260, 26)
      .setRectangleDropZone(260, 26)
      .setData({ zoneType: 'equip', slot: 'weapon' });
    this.input.setDraggable(this._weaponZone);
    { let p = false; let dragging = false;
      this._weaponZone.on('pointerdown', () => { p = true; });
      this._weaponZone.on('pointerup',   () => { if (p && !dragging) this._onEquipSlotClick('weapon'); p = false; dragging = false; });
      this._weaponZone.on('drag', (ptr, dragX, dragY) => {
        dragging = true; p = false;
        this._equippedBtn.setPosition(dragX, dragY).setDepth(10);
      });
      this._weaponZone.on('dragend', () => {
        const btn = this._equippedBtn;
        btn.setPosition(btn.getData('originX'), btn.getData('originY')).setDepth(0);
        if (dragging) {
          dragging = false;
          const room = getRoom();
          const player = room?.state.players.get(room?.sessionId);
          if (player?.equippedWeaponId) sendUnequip('weapon');
        }
      });
    }
    this._weaponZone.on('dragenter', () => {
      this._weaponDropGfx.clear().lineStyle(2, 0x4488ff, 0.8).strokeRect(rx, ry, 260, 26);
    });
    this._weaponZone.on('dragleave', () => this._weaponDropGfx.clear());
    ry += 38;

    // Offhand slot (weapons or shields).
    this.add.text(rx, ry, 'Offhand', STYLE_MUTED); ry += 14;
    this._offhandBtn  = this._makeSlotButton(rx, ry, '—  (empty)');
    this._offhandBtn.setData({ originX: rx, originY: ry });
    this._offhandHint = this.add.text(rx + 258, ry + 14, '', { ...STYLE_HINT, color: '#334455' }).setOrigin(1, 0);
    this._offhandDropGfx = this.add.graphics();
    this._offhandZone = this.add.zone(rx + 130, ry + 13, 260, 26)
      .setRectangleDropZone(260, 26)
      .setData({ zoneType: 'equip', slot: 'offhand' });
    this.input.setDraggable(this._offhandZone);
    { let p = false; let dragging = false;
      this._offhandZone.on('pointerdown', () => { p = true; });
      this._offhandZone.on('pointerup',   () => { if (p && !dragging) this._onEquipSlotClick('offhand'); p = false; dragging = false; });
      this._offhandZone.on('drag', (ptr, dragX, dragY) => {
        dragging = true; p = false;
        this._offhandBtn.setPosition(dragX, dragY).setDepth(10);
      });
      this._offhandZone.on('dragend', () => {
        const btn = this._offhandBtn;
        btn.setPosition(btn.getData('originX'), btn.getData('originY')).setDepth(0);
        if (dragging) {
          dragging = false;
          const room = getRoom();
          const player = room?.state.players.get(room?.sessionId);
          if (player?.offhandId) sendUnequip('offhand');
        }
      });
    }
    this._offhandZone.on('dragenter', () => {
      this._offhandDropGfx.clear().lineStyle(2, 0x44aaff, 0.8).strokeRect(rx, ry, 260, 26);
    });
    this._offhandZone.on('dragleave', () => this._offhandDropGfx.clear());
    ry += 34;

    // Armor slot (equippable/unequippable like weapon and offhand).
    this.add.text(rx, ry, 'Armor', STYLE_MUTED); ry += 14;
    this._armorBtn  = this._makeSlotButton(rx, ry, '—  (none)');
    this._armorBtn.setData({ originX: rx, originY: ry });
    this._armorHint = this.add.text(rx + 258, ry + 14, '', { ...STYLE_HINT, color: '#334455' }).setOrigin(1, 0);
    this._armorDropGfx = this.add.graphics();
    this._armorZone = this.add.zone(rx + 130, ry + 13, 260, 26)
      .setRectangleDropZone(260, 26)
      .setData({ zoneType: 'equip', slot: 'armor' });
    this.input.setDraggable(this._armorZone);
    { let p = false; let dragging = false;
      this._armorZone.on('pointerdown', () => { p = true; });
      this._armorZone.on('pointerup',   () => { if (p && !dragging) this._onEquipSlotClick('armor'); p = false; dragging = false; });
      this._armorZone.on('drag', (ptr, dragX, dragY) => {
        dragging = true; p = false;
        this._armorBtn.setPosition(dragX, dragY).setDepth(10);
      });
      this._armorZone.on('dragend', () => {
        const btn = this._armorBtn;
        btn.setPosition(btn.getData('originX'), btn.getData('originY')).setDepth(0);
        if (dragging) {
          dragging = false;
          const room = getRoom();
          const player = room?.state.players.get(room?.sessionId);
          if (player?.equippedArmorId) sendUnequip('armor');
        }
      });
    }
    this._armorZone.on('dragenter', () => {
      this._armorDropGfx.clear().lineStyle(2, 0x66aa44, 0.8).strokeRect(rx, ry, 260, 26);
    });
    this._armorZone.on('dragleave', () => this._armorDropGfx.clear());
    ry += 34;

    // Bag.
    this.add.text(rx, ry, 'BAG', STYLE_SUBHEAD); ry += 14;
    // Selection hint — updated by _updateSelection().
    this._selectionHint = this.add.text(rx, ry,
      'dbl-click auto-equip  ·  drag to slot  ·  click to select then click slot',
      { ...STYLE_HINT, color: '#334455' },
    ); ry += 14;
    this._bagStartY = ry;
    this._bagBtns   = [];
    this._lastInventorySnapshot = '';

    // Hotbar.
    const hotbarY = PANEL_Y + PANEL_H - 78;
    this.add.text(rx, hotbarY - 16, 'HOTBAR  (drag abilities or items here, press 1-0)', STYLE_SUBHEAD);
    this._hotbarSlots = this._buildHotbar(rx, hotbarY);

    // Global drop handler (weapon/offhand slots + hotbar).
    this.input.on('drop', (pointer, gameObject, dropZone) => {
      const itemId   = gameObject.getData('itemId');
      const zoneType = dropZone.getData('zoneType');
      if (zoneType === 'equip') {
        // Dropped onto an equipment slot — clear selection, equip to that slot.
        this._selectedItemId = null;
        sendEquip(itemId, dropZone.getData('slot'));
      } else if (zoneType === 'hotbar') {
        sendAssignHotbar(itemId, dropZone.getData('slot'));
      }
      // Clear all drop-zone highlights.
      this._weaponDropGfx.clear();
      this._offhandDropGfx.clear();
      this._armorDropGfx.clear();
      for (const s of this._hotbarSlots) s.highlight.clear();
    });

    // ── Footer ────────────────────────────────────────────────────────────────
    this.add.text(
      PANEL_X + PANEL_W - 10, PANEL_Y + PANEL_H - 8,
      'I  close', STYLE_HINT,
    ).setOrigin(1, 1);

    this.input.keyboard.on('keydown-I', () => { this.scene.stop(); });

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

    // Weapon slot.
    const weapon = player.equippedWeaponId;
    if (weapon) {
      const wDef     = WEAPON_DISPLAY[weapon];
      const strMod   = mod(FIGHTER_SCORES.STR);
      const modLabel = (strMod >= 0 ? '+' : '') + strMod + ' STR';
      const dieLabel = (weapon === 'longsword' && !player.offhandId) ? '1d10 slashing' : (wDef?.detail ?? weapon);
      this._equippedBtn.setText(`${(wDef?.label ?? weapon).padEnd(11)}  ${dieLabel}   ${modLabel}`)
        .setStyle({ ...STYLE_ITEM, backgroundColor: '#1a1a2e' });
      this._equippedNote.setText(wDef?.note ?? '');
      this._equippedHint.setText('click to unequip');
    } else {
      this._equippedBtn.setText('—  (empty)').setStyle({ ...STYLE_MUTED, backgroundColor: '#111118' });
      this._equippedNote.setText('');
      this._equippedHint.setText('');
    }

    // Offhand slot.
    const offhand = player.offhandId;
    if (offhand) {
      const sDef = SHIELD_DISPLAY[offhand];
      const wDef = WEAPON_DISPLAY[offhand];
      const def  = sDef ?? wDef;
      this._offhandBtn.setText(`${(def?.label ?? offhand).padEnd(11)}  ${def?.detail ?? ''}`)
        .setStyle({ ...STYLE_ITEM, backgroundColor: '#1a1a2e' });
      this._offhandHint.setText('click to unequip');
    } else {
      this._offhandBtn.setText('—  (empty)').setStyle({ ...STYLE_MUTED, backgroundColor: '#111118' });
      this._offhandHint.setText('');
    }

    // Armor slot.
    const armorId = player.equippedArmorId;
    if (armorId) {
      this._armorBtn.setText(ARMOR_SLOT_DISPLAY[armorId] ?? armorId)
        .setStyle({ ...STYLE_ITEM, backgroundColor: '#1a1a2e' });
      this._armorHint.setText('click to unequip');
    } else {
      this._armorBtn.setText('—  (none)').setStyle({ ...STYLE_MUTED, backgroundColor: '#111118' });
      this._armorHint.setText('');
    }

    // Second Wind availability.
    if (this._swText) {
      const avail = player.secondWindAvailable;
      this._swText.setText(`⚡ Second Wind  [${avail ? 'READY' : 'USED'}]`)
        .setColor(avail ? '#ffdd88' : '#665533');
    }

    // Bag — rebuild only when inventory changes.
    const snapshot = [...player.inventory].join(',');
    if (snapshot !== this._lastInventorySnapshot) {
      this._rebuildBag(player);
      this._lastInventorySnapshot = snapshot;
    } else {
      // Refresh blocked state in case equipment slots changed.
      for (const { id, btn, blockedText } of this._bagBtns) {
        const blocked = this._isBlocked(id, player);
        btn.setVisible(!blocked);
        blockedText.setVisible(blocked);
      }
      this._updateSelection();
    }

    // Hotbar labels.
    for (let i = 0; i < 10; i++) {
      const binding = player.hotbar?.[i] ?? '';
      const slot    = this._hotbarSlots[i];
      if (!slot) continue;
      if (binding === 'second_wind') {
        slot.itemLabel.setText('2nd Wind').setColor('#ffdd88');
      } else if (binding && CONSUMABLE_DISPLAY[binding]) {
        slot.itemLabel.setText(CONSUMABLE_DISPLAY[binding].short).setColor('#ffdd88');
      } else {
        slot.itemLabel.setText('—').setColor('#334455');
      }
    }
  }

  _rebuildBag(player) {
    for (const { btn, blockedText } of this._bagBtns) {
      btn.destroy();
      blockedText.destroy();
    }
    this._bagBtns = [];

    // If the previously-selected item is no longer in the bag, deselect.
    if (this._selectedItemId && ![...player.inventory].includes(this._selectedItemId)) {
      this._selectedItemId = null;
    }

    let ry = this._bagStartY;
    const rx = DIVIDER_X + 20;

    for (const itemId of player.inventory) {
      const label   = this._itemLabel(itemId);
      const blocked = this._isBlocked(itemId, player);

      const btn = this._makeItemButton(rx, ry, label, itemId);
      btn.setVisible(!blocked);

      // Grayed-out overlay shown when SRD constraint blocks equip.
      const blockedText = this.add.text(rx, ry, `${label}  ✗`, {
        ...STYLE_BLOCKED,
        backgroundColor: '#0d0d14',
        padding: { x: 8, y: 4 },
      }).setVisible(blocked);

      this._bagBtns.push({ id: itemId, btn, blockedText });
      ry += 28;
    }

    this._updateSelection();
  }

  /**
   * Handle a click on an equipment slot (weapon or offhand).
   * If an item is selected in the bag, equip it to this slot.
   * Otherwise fall through to unequip behavior.
   */
  _onEquipSlotClick(slot) {
    if (this._selectedItemId) {
      sendEquip(this._selectedItemId, slot);
      this._selectedItemId = null;
      this._updateSelection();
    } else {
      this._onUnequipClick(slot);
    }
  }

  /**
   * Refresh selection highlight on all bag buttons and the hint text.
   */
  _updateSelection() {
    const sel = this._selectedItemId;
    for (const { id, btn } of this._bagBtns) {
      if (id === sel) {
        btn.setStyle({ ...STYLE_SELECTED, backgroundColor: '#0e2a42', padding: { x: 8, y: 4 } });
      } else {
        btn.setStyle({ ...STYLE_ITEM, backgroundColor: '#1a1a2e', padding: { x: 8, y: 4 } });
      }
    }
    if (this._selectionHint) {
      if (sel) {
        const display = WEAPON_DISPLAY[sel] ?? SHIELD_DISPLAY[sel] ?? CONSUMABLE_DISPLAY[sel];
        const name = display?.label ?? sel;
        this._selectionHint
          .setText(`▶ ${name} selected — click slot to assign  ·  dbl-click to auto-equip  ·  Esc clears`)
          .setColor('#6699bb');
      } else {
        this._selectionHint
          .setText('dbl-click auto-equip  ·  drag to slot  ·  click to select then click slot')
          .setColor('#334455');
      }
    }
  }

  /** Returns true if equipping this item is currently blocked by an SRD rule. */
  _isBlocked(itemId, player) {
    if (itemId === 'shield') return TWO_HANDED_WEAPONS.has(player.equippedWeaponId);
    if (TWO_HANDED_WEAPONS.has(itemId)) return !!player.offhandId;
    return false;
  }

  _buildHotbar(rx, ry) {
    const slots   = [];
    const KEYS    = ['1','2','3','4','5','6','7','8','9','0'];
    const SLOT_W  = 83;
    const SLOT_H  = 22;

    for (let i = 0; i < 10; i++) {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const hx  = rx + col * (SLOT_W + 3);
      const hy  = ry + row * (SLOT_H + 4);

      // Slot background.
      this.add.graphics().fillStyle(0x0d0d1a).fillRect(hx, hy, SLOT_W, SLOT_H);
      // Key label.
      this.add.text(hx + 3, hy + 5, `[${KEYS[i]}]`, STYLE_HINT);
      // Bound item label (updated in _refresh).
      const itemLabel = this.add.text(hx + 22, hy + 5, '—', { ...STYLE_MUTED, fontSize: '11px' });
      // Highlight gfx for drag-over.
      const highlight = this.add.graphics();
      // Drop zone.
      const zone = this.add.zone(hx + SLOT_W / 2, hy + SLOT_H / 2, SLOT_W, SLOT_H)
        .setRectangleDropZone(SLOT_W, SLOT_H)
        .setData({ zoneType: 'hotbar', slot: i });

      zone.on('dragenter', () => {
        highlight.clear().lineStyle(2, 0xaaaaff, 0.7).strokeRect(hx, hy, SLOT_W, SLOT_H);
      });
      zone.on('dragleave', () => highlight.clear());

      slots.push({ itemLabel, zone, highlight });
    }
    return slots;
  }

  _onUnequipClick(slot) {
    const room = getRoom();
    if (!room) return;
    const player = room.state.players.get(room.sessionId);
    if (!player) return;
    if (slot === 'weapon'  && !player.equippedWeaponId) return;
    if (slot === 'offhand' && !player.offhandId) return;
    if (slot === 'armor'   && !player.equippedArmorId) return;
    sendUnequip(slot);
  }

  /** Display label for any equippable item id. */
  _itemLabel(id) {
    const w = WEAPON_DISPLAY[id];
    if (w) return `${w.label.padEnd(11)}  ${w.detail}`;
    const s = SHIELD_DISPLAY[id];
    if (s) return `${s.label.padEnd(11)}  ${s.detail}`;
    const a = ARMOR_BAG_DISPLAY[id];
    if (a) return `${a.label.padEnd(11)}  ${a.detail}`;
    const c = CONSUMABLE_DISPLAY[id];
    if (c) return `${c.label.padEnd(14)}  ${c.detail}`;
    return id;
  }

  /**
   * Draggable bag item button.
   *
   * Interaction model:
   *   - Drag          → move to drop zone (equip slot or hotbar); snap back on dragend
   *   - Double-click  → auto-equip to default slot (sendEquip with no slot)
   *   - Single-click  → toggle selection; _selectedItemId drives highlight + hint text
   *
   * The key fix vs. the old code: equip is NEVER sent on pointerdown, so the
   * button cannot be destroyed mid-drag by a server state update.
   */
  _makeItemButton(x, y, label, itemId) {
    const btn = this.add.text(x, y, label, {
      ...STYLE_ITEM,
      backgroundColor: '#1a1a2e',
      padding: { x: 8, y: 4 },
    }).setInteractive({ useHandCursor: true, draggable: true });

    btn.setData({ itemId, originX: x, originY: y });
    this.input.setDraggable(btn);

    let isDragging  = false;
    let lastClickMs = 0;

    btn.on('pointerdown', () => {
      isDragging = false;
    });

    btn.on('drag', (ptr, dragX, dragY) => {
      isDragging = true;
      btn.setPosition(dragX, dragY).setDepth(10);
    });

    btn.on('dragend', () => {
      btn.setPosition(x, y).setDepth(0);
      // dragend fires before drop; isDragging stays true so pointerup skips click logic.
    });

    btn.on('pointerup', () => {
      if (isDragging) {
        isDragging = false;
        return; // was a drag — drop event already handled equip
      }

      const now = Date.now();
      const delta = now - lastClickMs;
      lastClickMs = now;

      if (delta < DBLCLICK_MS) {
        // Double-click: auto-equip to server-chosen default slot.
        sendEquip(itemId);
        this._selectedItemId = null;
      } else {
        // Single-click: toggle selection.
        this._selectedItemId = (this._selectedItemId === itemId) ? null : itemId;
      }

      this._updateSelection();
    });

    // Esc key clears selection (attached once per button but guard by scene-level state).
    this.input.keyboard.on('keydown-ESC', () => {
      if (this._selectedItemId) {
        this._selectedItemId = null;
        this._updateSelection();
      }
    });

    return btn;
  }

  /** Make any existing game object draggable (used for Second Wind ability text). */
  _makeDraggable(obj, itemId, originX, originY) {
    obj.setData({ itemId, originX, originY });
    obj.setInteractive({ useHandCursor: true, draggable: true });
    this.input.setDraggable(obj);
    obj.on('drag', (ptr, dx, dy) => obj.setPosition(dx, dy).setDepth(10));
    obj.on('dragend', () => {
      obj.setPosition(originX, originY).setDepth(0);
    });
  }

  /** Non-draggable equipment slot button (click to equip-here or unequip). */
  _makeSlotButton(x, y, label) {
    return this.add.text(x, y, label, {
      ...STYLE_MUTED,
      backgroundColor: '#111118',
      padding: { x: 8, y: 4 },
    }).setInteractive({ useHandCursor: true })
      .on('pointerover',  function() { this.setStyle({ backgroundColor: '#1a1a2e' }); })
      .on('pointerout',   function() { this.setStyle({ backgroundColor: '#111118' }); });
  }
}
