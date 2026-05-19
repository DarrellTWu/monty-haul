// client/src/scenes/HubScene.js
// Hub orchestrator. The panel modules under client/src/ui/hub/ own their own
// build/refresh; this scene wires them together, holds cross-panel state
// (`_selectedClass`, `_abilityScores`, `_shopVendor`, `_craftBench`, `_leftView`),
// and exposes the shared callbacks panels invoke after server mutations:
//   _onPackChanged — pack/stash changed (rebuild raider + stash if visible)
//   _onPurchase    — buy completed (refresh vault + shop)
//   _onSold        — sell completed (refresh vault + stash)
//   _onCraft       — craft completed (refresh craft list)
//   _refreshRaider — class change triggers raider rebuild
//   _refreshVault  — gold-only updates (cheap)
//   _refreshTopBar — username change after rename
//
// Panels track gfx via `_l` (left panel) / `_r` (right panel) for cleanup on
// tab switch / full rebuild.

import { getHubGold, getPlayerId, getUsername, initFromServer } from '../store/stash.js';
import { HubAPI } from '../network/HubAPI.js';

import { LP, RP } from '../ui/hub/hub-data.js';
import { showLoginPanel } from '../ui/hub/LoginPanel.js';
import { openSettingsPanel } from '../ui/hub/SettingsPanel.js';
import { renderClassPanel } from '../ui/hub/ClassPanel.js';
import { renderStashPanel } from '../ui/hub/StashPanel.js';
import { renderShopPanel, refreshShopPanel } from '../ui/hub/ShopPanel.js';
import { renderCraftPanel, refreshCraftPanel } from '../ui/hub/CraftPanel.js';
import { renderRaiderPanel } from '../ui/hub/RaiderPanel.js';

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
    // Per-panel ScrollViewports. Panels assign these on render and the hub's
    // wheel listener routes scroll input by pointer hit-test. Cleared along
    // with _leftObjs / _rightObjs on tab switch or full rebuild.
    this._leftVp         = null;
    this._rightVp        = null;
    this._topObjs        = [];
    this._loginObjs      = [];
    this._settingsObjs     = [];
    this._settingsBodyObjs = [];
    this._settingsOpen     = false;
    this._settingsKeyHandler = null;
    this._keyHandler     = null;

    const playerId = getPlayerId();
    if (!playerId) {
      showLoginPanel(this, { onSuccess: () => this._buildHub() });
      return;
    }

    this._loadingText = this.add.text(640, 360, 'Loading...', {
      fontSize: '18px', color: '#556677', fontFamily: 'monospace',
    }).setOrigin(0.5);

    this._loadHubFromServer(playerId);
  }

  async _loadHubFromServer(playerId) {
    try {
      const data = await HubAPI.getState(playerId);
      this._loadingText?.destroy();
      this._loadingText = null;
      if (!data.ok) {
        // Player not in server store (server restarted) — fall back to login.
        localStorage.removeItem('mh_player_id');
        showLoginPanel(this, { onSuccess: () => this._buildHub() });
        return;
      }
      initFromServer(playerId, data);
      this._buildHub();
    } catch {
      this._loadingText?.destroy();
      this._loadingText = null;
      showLoginPanel(this, { onSuccess: () => this._buildHub() });
    }
  }

  // ── Hub build ────────────────────────────────────────────────────────────────

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

    this._buildTopBar();
    this._drawShells();
    this._buildSubNav();
    this._showLeftContent();
    renderRaiderPanel(this);

    // Single wheel listener routes to whichever panel viewport the pointer
    // is over. Panels are responsible for assigning _leftVp / _rightVp on
    // render and nulling them via the scene's teardown helpers.
    this.input.on('wheel', (pointer, _go, _dx, deltaY) => {
      if (this._leftVp  && this._leftVp.contains(pointer))  this._leftVp.handleWheel(deltaY);
      if (this._rightVp && this._rightVp.contains(pointer)) this._rightVp.handleWheel(deltaY);
    });

    // Drop references to gfx Phaser destroys on shutdown. The scene instance
    // is a singleton — a stale array of destroyed Text objects would crash
    // `_refresh`-style code on the next launch. See CLAUDE.md "Code Style".
    this.events.once('shutdown', () => {
      if (this._leftVp)  { this._leftVp.destroy();  this._leftVp  = null; }
      if (this._rightVp) { this._rightVp.destroy(); this._rightVp = null; }
      this._leftObjs         = [];
      this._rightObjs        = [];
      this._topObjs          = [];
      this._loginObjs        = [];
      this._settingsObjs     = [];
      this._settingsBodyObjs = [];
    });
  }

  // ── Top bar: username + settings icon (persistent across tab switches) ────────

  _buildTopBar() {
    for (const obj of this._topObjs) obj.destroy();
    this._topObjs = [];

    const username = getUsername() ?? '';
    const nameText = this.add.text(30, 38, `▸ ${username}`, {
      fontSize: '14px', color: '#88ccff', fontFamily: 'monospace',
    }).setOrigin(0, 0.5).setInteractive();
    nameText.on('pointerover', () => nameText.setColor('#ffffff'));
    nameText.on('pointerout',  () => nameText.setColor('#88ccff'));
    nameText.on('pointerdown', () => this._openSettings());
    this._topObjs.push(nameText);

    const gearIcon = this.add.text(30 + nameText.width + 10, 38, '⚙', {
      fontSize: '18px', color: '#88ccff', fontFamily: 'monospace',
    }).setOrigin(0, 0.5).setInteractive();
    gearIcon.on('pointerover', () => gearIcon.setColor('#ffffff'));
    gearIcon.on('pointerout',  () => gearIcon.setColor('#88ccff'));
    gearIcon.on('pointerdown', () => this._openSettings());
    this._topObjs.push(gearIcon);
  }

  _openSettings() {
    openSettingsPanel(this, {
      onRefreshTopBar: () => this._buildTopBar(),
      // Pass {} explicitly so any prior init({ view: 'stash' }) from DungeonScene
      // doesn't leak through scene.restart.
      onLogout:        () => this.scene.restart({}),
    });
  }

  // ── Permanent shell ──────────────────────────────────────────────────────────

  _drawShells() {
    const g = this.add.graphics();
    g.fillStyle(0x12121e, 0.97);
    g.fillRect(LP.x, LP.y, LP.w, LP.h);
    g.fillRect(RP.x, RP.y, RP.w, RP.h);
    g.lineStyle(1, 0x334466);
    g.strokeRect(LP.x, LP.y, LP.w, LP.h);
    g.strokeRect(RP.x, RP.y, RP.w, RP.h);
  }

  // ── Sub-nav (left panel tabs — permanent) ────────────────────────────────────

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
    // Class panel preserves _abilityScores across leaves; on first ever Class
    // visit, seed scores from the selected class' defaults so the point-buy
    // UI has data to render.
    this._leftView = view;
    this._updateSubNav();
    this._tearDownLeft();
    this._showLeftContent();
  }

  _tearDownLeft() {
    for (const obj of this._leftObjs) obj.destroy();
    this._leftObjs = [];
    this._leftVp   = null;
  }

  _tearDownRight() {
    for (const obj of this._rightObjs) obj.destroy();
    this._rightObjs = [];
    this._rightVp   = null;
  }

  _showLeftContent() {
    if      (this._leftView === 'class') renderClassPanel(this);
    else if (this._leftView === 'shop')  renderShopPanel(this);
    else if (this._leftView === 'craft') renderCraftPanel(this);
    else                                 renderStashPanel(this);
  }

  // ── Refresh hooks invoked by panels after server mutations ───────────────────

  _refreshVault() {
    if (this._vaultGoldText) this._vaultGoldText.setText(`${getHubGold()} gp`);
  }

  _refreshRaider() {
    renderRaiderPanel(this);
  }

  _onPurchase() {
    this._refreshVault();
    refreshShopPanel(this);
  }

  _onCraft() {
    refreshCraftPanel(this);
  }

  _onPackChanged() {
    if (this._leftView === 'stash') {
      this._tearDownLeft();
      renderStashPanel(this);
    }
    renderRaiderPanel(this);
  }

  _onSold() {
    this._refreshVault();
    if (this._leftView === 'stash') {
      this._tearDownLeft();
      renderStashPanel(this);
    }
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  _l(obj) { this._leftObjs.push(obj);  return obj; }
  _r(obj) { this._rightObjs.push(obj); return obj; }
}
