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

import {
  getRoom, sendEquip, sendUnequip, sendAssignHotbar,
  sendOpenContainer, sendCloseContainer,
  sendTakeItem, sendTakeGold, sendDropItem,
} from '../network/ColyseusClient.js';
import { CLASS_REGISTRY } from '../../../shared/data/classes/index.js';
import { getProficiencyBonus } from '../../../shared/logic/combat.js';
import { getItem } from '../../../shared/data/items/index.js';
import { ARMOR_REGISTRY } from '../../../shared/data/armor/armor.js';
import { getItemDisplay, getArmorSlotDescription } from '../../../shared/logic/item-display.js';

// Panel geometry (expanded height to fit saving throws + class features + hotbar).
const PANEL_X   = 190;
const PANEL_Y   = 80;
const PANEL_W   = 900;
const PANEL_H   = 560;
const DIVIDER_X = PANEL_X + 430;

function mod(score)    { return Math.floor((score - 10) / 2); }
function modStr(score) { const m = mod(score); return (m >= 0 ? '+' : '') + m; }

// Build a save-throw display line from live player state.
// saveProfs and profBonus come from the player's actual class and level.
function saveBonus(stat, player, saveProfs, profBonus) {
  const score = player[stat] ?? 10;
  const m = mod(score);
  const p = saveProfs.has(stat) ? profBonus : 0;
  const t = m + p;
  return `${stat.toUpperCase().padEnd(4)} ${(t >= 0 ? '+' : '') + t}${saveProfs.has(stat) ? ' ●' : ''}`;
}

// Item display strings (label / detail / note / equipped-armor description)
// are derived from ITEM_REGISTRY via shared/logic/item-display.js — no per-id
// tables live in this file. To change how an item renders, edit its def in
// shared/data/items/* or shared/data/weapons/*.

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

const BAG_ITEM_H = 28;  // row height for bag items (px)

export class InventoryScene extends Phaser.Scene {
  constructor() {
    super({ key: 'InventoryScene' });
  }

  /**
   * Optional loot mode. Pass `{ lootSource: { kind, id } }` to open the scene
   * with a loot panel replacing the character sheet on the left side. The
   * scene owns the open/close handshake — it sends open_container on create
   * and close_container on shutdown.
   */
  init(data) {
    this._lootSource = data?.lootSource ?? null;
  }

  create() {
    this.cameras.main.setScroll(0, 0);

    // Selection state: which bag item is currently selected (single-click).
    this._selectedItemId = null;
    this._lootMode = !!this._lootSource;
    // Set of game objects that belong to the left-column loot panel; rebuilt
    // when source contents change so we can destroy the previous batch cleanly.
    this._lootRowGfx = [];
    this._lastLootSnapshot = '';
    // Track the drop-button gfx attached to each bag row so _rebuildBag can
    // tear them down before rebuilding.
    this._dropBtns = [];

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
    // In normal mode the left column is the character sheet. In loot mode it
    // becomes the loot panel — _refresh guards every char-sheet field for null.
    const lx = PANEL_X + 20;

    if (this._lootMode) {
      this._nameText = null; this._classDescText = null;
      this._hpText = null; this._acText = null; this._goldText = null;
      this._abilityKey = null; this._abilityText = null;
      this._buildLootPanel(lx, PANEL_Y + 18);
    } else {
      let ly = PANEL_Y + 18;

      this.add.text(lx, ly, 'CHARACTER', STYLE_SUBHEAD); ly += 20;
      this._nameText = this.add.text(lx, ly, 'Fighter', STYLE_HEADER); ly += 24;
      this._classDescText = this.add.text(lx, ly, 'Level 1  Human Fighter', STYLE_BODY); ly += 18;
      this._hpText   = this.add.text(lx, ly, 'HP  —',   STYLE_BODY); ly += 16;
      this._acText   = this.add.text(lx, ly, 'AC  —',   STYLE_BODY); ly += 16;

      // Read live player state once for ability scores, saves, and class features.
      const _ir = getRoom();
      const _ip = _ir?.state.players.get(_ir?.sessionId);
      const playerClass = _ip?.class ?? 'fighter';
      const _classDef   = CLASS_REGISTRY[playerClass] ?? CLASS_REGISTRY.fighter;
      const _saveProfs  = new Set(_classDef.saveProficiencies ?? []);
      const _profBonus  = getProficiencyBonus(_ip?.level ?? 1);

      // Ability scores — read from live player state.
      this.add.text(lx, ly, 'ABILITY SCORES', STYLE_SUBHEAD); ly += 16;
      for (const stat of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
        const score = _ip?.[stat] ?? 10;
        this.add.text(lx, ly,
          `${stat.toUpperCase().padEnd(4)}  ${String(score).padStart(2)}   (${modStr(score)})`,
          STYLE_BODY,
        );
        ly += 15;
      }
      ly += 4;

      // Saving throws — proficiency from class definition, bonus from level.
      this.add.text(lx, ly, 'SAVING THROWS  (● proficient)', STYLE_SUBHEAD); ly += 15;
      for (const stat of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
        this.add.text(lx, ly, saveBonus(stat, _ip ?? {}, _saveProfs, _profBonus), STYLE_BODY);
        ly += 14;
      }
      ly += 6;

      // Class features. Iterate taken classes in the order they were leveled,
      // dedup'd. Multiclass build shows each class's level-1 features stacked.
      this.add.text(lx, ly, 'CLASS FEATURES', STYLE_SUBHEAD); ly += 15;

      // Collect taken classes from levelUpHistory; fall back to primary class
      // if history isn't populated yet (defensive — onJoin always seeds it).
      const takenClasses = [];
      const seen = new Set();
      for (const cid of (_ip?.levelUpHistory ?? [])) {
        if (!seen.has(cid)) { seen.add(cid); takenClasses.push(cid); }
      }
      if (takenClasses.length === 0) takenClasses.push(playerClass);

      // Track every draggable ability widget so _refresh can update their
      // [READY] / [N uses] / [RAGING] status strings.
      this._abilityWidgets = [];

      for (const cid of takenClasses) {
        ly = this._renderClassFeaturesBlock(cid, lx, ly);
      }
      // Back-compat: keep first widget pointers around in case anything else
      // still references the singular `_abilityKey` / `_abilityText`.
      this._abilityKey  = this._abilityWidgets[0]?.key  ?? null;
      this._abilityText = this._abilityWidgets[0]?.text ?? null;

      // Feat.
      this.add.text(lx, ly, 'FEAT: Alert  (variant human)', STYLE_FEAT); ly += 13;
      this.add.text(lx, ly, '+5 initiative, cannot be surprised', STYLE_NOTE);
    }

    // ── Right column ──────────────────────────────────────────────────────────
    const rx = DIVIDER_X + 20;
    let ry = PANEL_Y + 18;

    this._goldText = this.add.text(PANEL_X + PANEL_W - 10, ry, 'GOLD —', {
      ...STYLE_ITEM, color: '#ffdd44',
    }).setOrigin(1, 0);

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

    // Bag scroll setup — defines the clipping viewport, shared mask, overflow hint,
    // and mouse-wheel listener.  All downstream bag methods read these instance fields.
    this._bagScrollOffset   = 0;
    this._bagViewportBottom = hotbarY - 28;
    this._bagViewportH      = this._bagViewportBottom - this._bagStartY;
    const bagRx = DIVIDER_X + 20;
    const bagW  = PANEL_X + PANEL_W - bagRx - 4;
    this._bagMaskGfx = this.make.graphics();
    this._bagMaskGfx.fillRect(bagRx, this._bagStartY, bagW, this._bagViewportH);
    this._bagMask = this._bagMaskGfx.createGeometryMask();
    this._bagOverflowText = this.add.text(
      bagRx, this._bagViewportBottom + 2, '', { ...STYLE_HINT, color: '#445566' },
    );
    this.input.on('wheel', (pointer, _gameObjects, _dx, deltaY) => {
      const inBag = pointer.x >= bagRx && pointer.x <= bagRx + bagW
                 && pointer.y >= this._bagStartY && pointer.y <= this._bagViewportBottom;
      if (inBag) this._scrollBag(Math.sign(deltaY) * BAG_ITEM_H);
    });

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
      this._lootMode ? 'Esc / I  close (releases lock)' : 'I  close', STYLE_HINT,
    ).setOrigin(1, 1);

    this.input.keyboard.on('keydown-I', () => { this.scene.stop(); });

    // ── Loot-mode lifecycle ──────────────────────────────────────────────────
    // Scene owns the open/close handshake. Caller just sends `lootSource` on
    // launch; scene handles the rest. Lock is released on any close path
    // (Esc, I, scene.stop from another path, range/death auto-close).
    if (this._lootMode) {
      sendOpenContainer(this._lootSource.kind, this._lootSource.id);
      this._lootHandshakeSeen = false;

      this.input.keyboard.on('keydown-ESC', () => { this.scene.stop(); });

      const room = getRoom();
      if (room) {
        room.onMessage('container_lock_denied', ({ sourceKind, sourceId }) => {
          if (sourceKind === this._lootSource?.kind && sourceId === this._lootSource?.id) {
            const hud = this.scene.get('HUDScene');
            if (hud?.addLog) hud.addLog('Container is being looted by another raider.');
            this.scene.stop();
          }
        });
      }

      this.events.once('shutdown', () => {
        if (this._lootSource) {
          sendCloseContainer(this._lootSource.kind, this._lootSource.id);
        }
      });
    }

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

    // Loot-mode auto-close: if the source vanishes (descend) or the lock is
    // released by the server (range/death/disconnect), close the scene. We
    // gate on _lootHandshakeSeen so the brief window before open_container
    // round-trips doesn't slam the scene shut.
    if (this._lootMode) {
      const src = this._readLootSource();
      if (!src) {
        if (this._lootHandshakeSeen) this.scene.stop();
        return;
      }
      if (src.lockedBy === room.sessionId) {
        this._lootHandshakeSeen = true;
      } else if (this._lootHandshakeSeen) {
        this.scene.stop();
        return;
      }
      this._refreshLootPanel(src);
    }

    if (this._hpText)   this._hpText.setText(`HP   ${player.hp} / ${player.maxHp}`);
    if (this._acText)   this._acText.setText(`AC   ${player.ac}`);
    if (this._goldText) this._goldText.setText(`GOLD ${player.gold ?? 0} gp`);

    // Weapon slot.
    // Attack ability: finesse weapons use higher of STR/DEX; monks use higher of STR/DEX
    // on all monk weapons (Martial Arts). Authoritative list: CombatSystem.MONK_WEAPON_IDS
    // and weapon properties in shared/data/weapons/{melee,ranged}.js.
    const FINESSE_IDS    = new Set(['shortsword', 'dagger']);
    const MONK_WPNS      = new Set(['shortsword', 'dagger', 'handaxe', 'mace', 'unarmed', '']);
    const weapon = player.equippedWeaponId;
    if (weapon) {
      const display    = getItemDisplay(weapon);
      const strMod     = mod(player.str ?? 10);
      const dexMod     = mod(player.dex ?? 10);
      const isMonk     = player.class === 'monk';
      const usesDex    = (FINESSE_IDS.has(weapon) || (isMonk && MONK_WPNS.has(weapon)))
                         && dexMod > strMod;
      const atkMod     = usesDex ? dexMod : strMod;
      const atkStat    = usesDex ? 'DEX' : 'STR';
      const modLabel   = (atkMod >= 0 ? '+' : '') + atkMod + ' ' + atkStat;
      const dieLabel   = (weapon === 'longsword' && !player.offhandId) ? '1d10 slashing' : (display?.detail ?? weapon);
      this._equippedBtn.setText(`${(display?.label ?? weapon).padEnd(11)}  ${dieLabel}   ${modLabel}`)
        .setStyle({ ...STYLE_ITEM, backgroundColor: '#1a1a2e' });
      this._equippedNote.setText(display?.note ?? '');
      this._equippedHint.setText('click to unequip');
    } else {
      this._equippedBtn.setText('—  (empty)').setStyle({ ...STYLE_MUTED, backgroundColor: '#111118' });
      this._equippedNote.setText('');
      this._equippedHint.setText('');
    }

    // Offhand slot.
    const offhand = player.offhandId;
    if (offhand) {
      const display = getItemDisplay(offhand);
      this._offhandBtn.setText(`${(display?.label ?? offhand).padEnd(11)}  ${display?.detail ?? ''}`)
        .setStyle({ ...STYLE_ITEM, backgroundColor: '#1a1a2e' });
      this._offhandHint.setText('click to unequip');
    } else {
      this._offhandBtn.setText('—  (empty)').setStyle({ ...STYLE_MUTED, backgroundColor: '#111118' });
      this._offhandHint.setText('');
    }

    // Armor slot.
    const armorId = player.equippedArmorId;
    if (armorId) {
      const armorDef = ARMOR_REGISTRY[armorId];
      this._armorBtn.setText(armorDef ? getArmorSlotDescription(armorDef) : armorId)
        .setStyle({ ...STYLE_ITEM, backgroundColor: '#1a1a2e' });
      this._armorHint.setText('click to unequip');
    } else {
      this._armorBtn.setText('—  (none)').setStyle({ ...STYLE_MUTED, backgroundColor: '#111118' });
      this._armorHint.setText('');
    }

    // Class ability availability — refresh every draggable widget every frame.
    for (const { key, text } of (this._abilityWidgets ?? [])) {
      const sel = this._selectedItemId === key;
      if (key === 'second_wind') {
        const avail = player.secondWindAvailable;
        text.setText(`⚡ Second Wind  [${avail ? 'READY' : 'USED'}]`)
          .setColor(sel ? '#88ddff' : (avail ? '#ffdd88' : '#665533'));
      } else if (key === 'rage') {
        const raging = player.rageRemainingMs > 0;
        const uses   = player.rageUsesRemaining ?? 0;
        const status = raging ? 'RAGING' : uses > 0 ? `${uses} uses` : 'SPENT';
        text.setText(`💢 Rage  [${status}]`)
          .setColor(sel ? '#88ddff' : (raging || uses > 0) ? '#ff8844' : '#665533');
      }
    }
    if (this._nameText) {
      const cn = player.class ? player.class[0].toUpperCase() + player.class.slice(1) : 'Fighter';
      this._nameText.setText(cn);
      if (this._classDescText) {
        // Build summary from levelUpHistory: "Fighter 1 / Barbarian 1".
        // Falls back to "Level N <Primary>" if history isn't populated yet.
        const counts = new Map();
        for (const cid of (player.levelUpHistory ?? [])) {
          counts.set(cid, (counts.get(cid) ?? 0) + 1);
        }
        let buildSummary;
        if (counts.size > 0) {
          const parts = [];
          for (const [cid, n] of counts) {
            const label = CLASS_REGISTRY[cid]?.name ?? cid;
            parts.push(`${label} ${n}`);
          }
          buildSummary = parts.join(' / ');
        } else {
          buildSummary = `Level ${player.level} ${cn}`;
        }
        this._classDescText.setText(`Human  ·  ${buildSummary}`);
      }
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
      } else if (binding === 'rage') {
        slot.itemLabel.setText('Rage').setColor('#ff8844');
      } else if (binding && getItem(binding)?.category === 'consumable') {
        const def = getItem(binding);
        slot.itemLabel.setText(def.hotbarShort ?? def.label).setColor('#ffdd88');
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
    for (const dropBtn of this._dropBtns) dropBtn.destroy();
    this._bagBtns  = [];
    this._dropBtns = [];

    // Group inventory by id (preserving first-seen order) so duplicate items
    // collapse into a single row showing "× N". Server inventory stays flat —
    // this is purely a display transform.
    const grouped = [];
    const seenAt  = new Map(); // id → grouped[] index
    for (const id of player.inventory) {
      const idx = seenAt.get(id);
      if (idx === undefined) {
        seenAt.set(id, grouped.length);
        grouped.push({ id, qty: 1 });
      } else {
        grouped[idx].qty++;
      }
    }

    const maxScroll = Math.max(0, grouped.length * BAG_ITEM_H - this._bagViewportH);
    this._bagScrollOffset = Math.min(Math.max(this._bagScrollOffset, 0), maxScroll);

    if (this._selectedItemId && !seenAt.has(this._selectedItemId)) {
      this._selectedItemId = null;
    }

    const rx = DIVIDER_X + 20;

    for (let i = 0; i < grouped.length; i++) {
      const { id: itemId, qty } = grouped[i];
      const logicalY = i * BAG_ITEM_H;
      const actualY  = this._bagStartY + logicalY - this._bagScrollOffset;
      const baseLabel = this._itemLabel(itemId);
      const label    = qty > 1 ? `${baseLabel}  × ${qty}` : baseLabel;
      const blocked  = this._isBlocked(itemId, player);

      const btn = this._makeItemButton(rx, actualY, label, itemId, logicalY);
      btn.setVisible(!blocked).setMask(this._bagMask);

      const blockedText = this.add.text(rx, actualY, `${label}  ✗`, {
        ...STYLE_BLOCKED,
        backgroundColor: '#0d0d14',
        padding: { x: 8, y: 4 },
      }).setVisible(blocked).setMask(this._bagMask);

      this._bagBtns.push({ id: itemId, btn, blockedText, logicalY });

      // Loot mode: per-row [→] button drops one copy of this item into the
      // open container. Sends the first flat-inventory index that holds the id.
      if (this._lootMode) {
        const dropX  = PANEL_X + PANEL_W - 36;
        const dropBtn = this.add.text(dropX, actualY, '[ → Drop ]', {
          ...STYLE_HINT,
          color: '#88ddff',
          backgroundColor: '#0d0d14',
          padding: { x: 6, y: 4 },
        })
          .setOrigin(1, 0)
          .setInteractive({ useHandCursor: true })
          .setMask(this._bagMask);
        dropBtn.setData({ logicalY });
        dropBtn.on('pointerdown', () => this._onDropClick(itemId));
        this._dropBtns.push(dropBtn);
      }
    }

    this._updateSelection();
    this._updateOverflow(grouped.length);
  }

  /** Loot-mode click handler — drop one copy of `itemId` into the open container. */
  _onDropClick(itemId) {
    if (!this._lootMode || !this._lootSource) return;
    const room = getRoom();
    const player = room?.state.players.get(room?.sessionId);
    if (!player) return;
    const idx = [...player.inventory].indexOf(itemId);
    if (idx === -1) return;
    sendDropItem(this._lootSource.kind, this._lootSource.id, idx);
  }

  // ── Loot panel ────────────────────────────────────────────────────────────

  /** Read the loot source schema from current room state, or null if missing. */
  _readLootSource() {
    if (!this._lootSource) return null;
    const room = getRoom();
    if (!room) return null;
    const { kind, id } = this._lootSource;
    if (kind === 'chest')  return room.state.chests.get(id)  ?? null;
    if (kind === 'corpse') return room.state.enemies.get(id) ?? null;
    return null;
  }

  /**
   * Build the loot-panel skeleton on the left side. Static text only —
   * the dynamic rows (gold + items) are built by _refreshLootPanel.
   */
  _buildLootPanel(lx, ly) {
    const src = this._readLootSource();
    const titleText = this._lootSource.kind === 'corpse'
      ? `${(src?.type ?? 'corpse').toUpperCase()}  CORPSE`
      : 'CHEST';
    this.add.text(lx, ly, 'LOOT', STYLE_SUBHEAD); ly += 20;
    this.add.text(lx, ly, titleText, STYLE_HEADER); ly += 28;
    this.add.text(lx, ly, 'click [ Take ] to move into your bag', STYLE_NOTE); ly += 14;
    this.add.text(lx, ly, '[ → Drop ] on bag rows to put items here', STYLE_NOTE); ly += 22;

    // Anchor for dynamic rows.
    this._lootRowsX = lx;
    this._lootRowsY = ly;
    this._lootEmptyText = this.add.text(lx, ly, '(empty)', { ...STYLE_NOTE, color: '#445566' }).setVisible(false);

    // Scroll infrastructure — mirrors the bag viewport on the right column.
    this._lootScrollOffset  = 0;
    this._lootViewportBottom = PANEL_Y + PANEL_H - 10;
    this._lootViewportH      = this._lootViewportBottom - ly;
    const lootPanelW = DIVIDER_X - lx - 10;
    this._lootMaskGfx = this.make.graphics();
    this._lootMaskGfx.fillRect(lx, ly, lootPanelW, this._lootViewportH);
    this._lootMask = this._lootMaskGfx.createGeometryMask();
    this._lootOverflowText = this.add.text(
      lx, this._lootViewportBottom + 2, '', { ...STYLE_HINT, color: '#445566' },
    );
    this.input.on('wheel', (pointer, _gameObjects, _dx, deltaY) => {
      const inLoot = this._lootMode
                  && pointer.x >= lx && pointer.x <= DIVIDER_X
                  && pointer.y >= this._lootRowsY && pointer.y <= this._lootViewportBottom;
      if (inLoot) this._scrollLootPanel(Math.sign(deltaY) * 22);
    });
  }

  /**
   * Rebuild the gold + item rows from the source's current contents. Called
   * from _refresh whenever the source's snapshot string changes. Recreating
   * rows on every change is fine — there are at most a few items per source.
   */
  _refreshLootPanel(src) {
    const itemsArr = this._lootSource.kind === 'corpse' ? src.lootItems : src.items;
    const gold     = this._lootSource.kind === 'corpse' ? (src.lootGold ?? 0) : 0;
    const snapshot = `${gold}|${[...itemsArr].join(',')}`;
    if (snapshot === this._lastLootSnapshot) return;
    this._lastLootSnapshot = snapshot;

    for (const obj of this._lootRowGfx) obj.destroy();
    this._lootRowGfx = [];

    const rowH = 22;
    let logicalRow = 0;

    // Gold (corpses only, when > 0).
    if (this._lootSource.kind === 'corpse' && gold > 0) {
      const ry = this._lootRowsY + logicalRow * rowH - this._lootScrollOffset;
      const goldLabel = this.add.text(this._lootRowsX, ry, `💰  ${gold} gp`, {
        ...STYLE_ITEM, color: '#ffdd44',
      }).setMask(this._lootMask);
      const takeBtn = this.add.text(this._lootRowsX + 220, ry, '[ Take ]', {
        ...STYLE_HINT, color: '#88ddff', backgroundColor: '#0d0d14',
        padding: { x: 6, y: 3 },
      }).setInteractive({ useHandCursor: true }).setMask(this._lootMask);
      takeBtn.on('pointerdown', () => sendTakeGold(this._lootSource.id));
      this._lootRowGfx.push(goldLabel, takeBtn);
      logicalRow++;
    }

    // Per-item rows. Index in the source array is what take_item expects.
    for (let i = 0; i < itemsArr.length; i++) {
      const ry = this._lootRowsY + logicalRow * rowH - this._lootScrollOffset;
      const itemId    = itemsArr[i];
      const itemLabel = this.add.text(this._lootRowsX, ry, this._itemLabel(itemId), STYLE_ITEM)
        .setMask(this._lootMask);
      const takeBtn   = this.add.text(this._lootRowsX + 220, ry, '[ Take ]', {
        ...STYLE_HINT, color: '#88ddff', backgroundColor: '#0d0d14',
        padding: { x: 6, y: 3 },
      }).setInteractive({ useHandCursor: true }).setMask(this._lootMask);
      // Capture i — the index can shift as earlier items are removed, but we
      // bind to the index at click time by re-reading source state.
      const itemIndex = i;
      takeBtn.on('pointerdown', () => {
        sendTakeItem(this._lootSource.kind, this._lootSource.id, itemIndex);
      });
      this._lootRowGfx.push(itemLabel, takeBtn);
      logicalRow++;
    }

    const isEmpty = itemsArr.length === 0 && gold === 0;
    this._lootEmptyText.setVisible(isEmpty).setY(this._lootRowsY);

    const totalRows = logicalRow;
    const maxScroll = Math.max(0, totalRows * rowH - this._lootViewportH);
    this._lootScrollOffset = Math.min(this._lootScrollOffset, maxScroll);
    this._lootTotalRows = totalRows;
    this._updateLootOverflow(totalRows);
  }

  _scrollLootPanel(delta) {
    const rowH      = 22;
    const maxScroll = Math.max(0, (this._lootTotalRows ?? 0) * rowH - this._lootViewportH);
    this._lootScrollOffset = Math.max(0, Math.min(this._lootScrollOffset + delta, maxScroll));
    // Reposition every gfx object; they were built in pairs (label, button) per row.
    let logicalRow = 0;
    for (let j = 0; j < this._lootRowGfx.length; j += 2) {
      const y = this._lootRowsY + logicalRow * rowH - this._lootScrollOffset;
      this._lootRowGfx[j].setY(y);
      this._lootRowGfx[j + 1].setY(y);
      logicalRow++;
    }
    this._updateLootOverflow(this._lootTotalRows ?? 0);
  }

  _updateLootOverflow(rowCount) {
    const rowH       = 22;
    const hiddenBelow = rowCount * rowH - this._lootViewportH - this._lootScrollOffset;
    if (hiddenBelow > 0) {
      const more = Math.ceil(hiddenBelow / rowH);
      this._lootOverflowText.setText(`↓ ${more} more  (scroll)`).setVisible(true);
    } else {
      this._lootOverflowText.setVisible(false);
    }
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
        const display = getItemDisplay(sel);
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
  _isBlocked(_itemId, _player) {
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

      { let p = false;
        zone.on('pointerdown', () => { p = true; });
        zone.on('pointerup', () => {
          if (p && this._selectedItemId) {
            sendAssignHotbar(this._selectedItemId, i);
            this._selectedItemId = null;
            this._updateSelection();
          }
          p = false;
        });
      }

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

  /** Display label for any bag item id. */
  _itemLabel(id) {
    const display = getItemDisplay(id);
    if (!display) return id;
    // Consumables and materials use a wider label column because their names
    // are longer ("Potion of Longstrider", "Skeleton Bone") than weapons/armor.
    const pad = (display.category === 'consumable' || display.category === 'material') ? 14 : 11;
    return `${display.label.padEnd(pad)}  ${display.detail}`;
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
  _makeItemButton(x, y, label, itemId, logicalY) {
    const btn = this.add.text(x, y, label, {
      ...STYLE_ITEM,
      backgroundColor: '#1a1a2e',
      padding: { x: 8, y: 4 },
    }).setInteractive({ useHandCursor: true, draggable: true });

    btn.setData({ itemId, logicalY, originX: x });
    this.input.setDraggable(btn);

    let isDragging  = false;
    let lastClickMs = 0;

    btn.on('pointerdown', () => {
      isDragging = false;
    });

    btn.on('drag', (ptr, dragX, dragY) => {
      isDragging = true;
      btn.clearMask();
      btn.setPosition(dragX, dragY).setDepth(10);
    });

    btn.on('dragend', () => {
      // Snap back to wherever the item currently sits after any scroll that happened
      // during the drag.
      btn.setMask(this._bagMask);
      btn.setPosition(x, this._bagStartY + logicalY - this._bagScrollOffset).setDepth(0);
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
        // Double-click: route to the right server message based on item type.
        // Consumables (incl. extraction_scroll) → bind to first free hotbar slot;
        // weapons/armor/shield → server's auto-equip; materials → no-op.
        const def = getItem(itemId);
        if (def?.category === 'consumable') {
          this._assignConsumableToHotbar(itemId);
        } else if (def?.category !== 'material') {
          sendEquip(itemId);
        }
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

  /**
   * Bind a consumable to the first empty hotbar slot. No-op if it's already
   * bound somewhere (avoids surprising "the potion jumped to a different key"
   * behavior) or if every slot is full.
   */
  _assignConsumableToHotbar(itemId) {
    const room = getRoom();
    const player = room?.state.players.get(room?.sessionId);
    if (!player) return;
    const hotbar = [...player.hotbar];
    if (hotbar.includes(itemId)) return;
    const firstFree = hotbar.findIndex(b => b === '');
    if (firstFree === -1) return;
    sendAssignHotbar(itemId, firstFree);
  }

  /**
   * Render one class's level-1 feature block at (lx, ly) and return the new y.
   * Draggable widgets (Second Wind, Rage) are appended to `_abilityWidgets`
   * so `_refresh` can update their availability text each frame.
   */
  _renderClassFeaturesBlock(classId, lx, ly) {
    const def       = CLASS_REGISTRY[classId];
    const className = def?.name ?? (classId[0].toUpperCase() + classId.slice(1));

    this.add.text(lx, ly, className, { ...STYLE_SUBHEAD, color: '#aaccdd' }); ly += 14;

    if (classId === 'barbarian') {
      const txt = this.add.text(lx, ly, '💢 Rage  [2 uses]', STYLE_ITEM);
      this._makeDraggable(txt, 'rage', lx, ly);
      { let d = false;
        txt.on('pointerdown', () => { d = false; });
        txt.on('drag',        () => { d = true;  });
        txt.on('pointerup',   () => {
          if (!d) { this._selectedItemId = (this._selectedItemId === 'rage') ? null : 'rage'; this._updateSelection(); }
          d = false;
        });
      }
      this._abilityWidgets.push({ key: 'rage', text: txt });
      ly += 13;
      this.add.text(lx, ly, '+2 dmg, resist phys dmg (30s)  drag→hotbar', STYLE_NOTE); ly += 17;
    } else if (classId === 'monk') {
      this.add.text(lx, ly, 'Unarmored Defense', STYLE_BODY); ly += 13;
      this.add.text(lx, ly, 'AC = 10 + DEX + WIS  (no armor or shield)', STYLE_NOTE); ly += 17;
      this.add.text(lx, ly, 'Martial Arts', STYLE_BODY); ly += 13;
      this.add.text(lx, ly, 'DEX attacks · d4 unarmed · bonus unarmed strike', STYLE_NOTE); ly += 17;
    } else if (classId === 'fighter') {
      this.add.text(lx, ly, 'Fighting Style: Dueling', STYLE_BODY); ly += 13;
      this.add.text(lx, ly, '+2 dmg (one-hand, no weapon offhand)', STYLE_NOTE); ly += 17;
      const txt = this.add.text(lx, ly, '⚡ Second Wind  [READY]', STYLE_ITEM);
      this._makeDraggable(txt, 'second_wind', lx, ly);
      { let d = false;
        txt.on('pointerdown', () => { d = false; });
        txt.on('drag',        () => { d = true;  });
        txt.on('pointerup',   () => {
          if (!d) { this._selectedItemId = (this._selectedItemId === 'second_wind') ? null : 'second_wind'; this._updateSelection(); }
          d = false;
        });
      }
      this._abilityWidgets.push({ key: 'second_wind', text: txt });
      ly += 13;
      this.add.text(lx, ly, 'Heal 1d10+1 HP (1/short rest)  drag→hotbar', STYLE_NOTE); ly += 17;
    }

    return ly;
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

  _scrollBag(delta) {
    const maxScroll = Math.max(0, this._bagBtns.length * BAG_ITEM_H - this._bagViewportH);
    this._bagScrollOffset = Math.max(0, Math.min(this._bagScrollOffset + delta, maxScroll));
    for (const { btn, blockedText, logicalY } of this._bagBtns) {
      const y = this._bagStartY + logicalY - this._bagScrollOffset;
      btn.setY(y);
      blockedText.setY(y);
    }
    for (const dropBtn of this._dropBtns) {
      dropBtn.setY(this._bagStartY + dropBtn.getData('logicalY') - this._bagScrollOffset);
    }
    this._updateOverflow(this._bagBtns.length);
  }

  _updateOverflow(itemCount) {
    const hiddenBelow = itemCount * BAG_ITEM_H - this._bagViewportH - this._bagScrollOffset;
    if (hiddenBelow > 0) {
      const moreCount = Math.ceil(hiddenBelow / BAG_ITEM_H);
      this._bagOverflowText.setText(`↓ ${moreCount} more  (scroll)`).setVisible(true);
    } else {
      this._bagOverflowText.setVisible(false);
    }
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
