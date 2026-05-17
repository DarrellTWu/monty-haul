// client/src/ui/hub/SettingsPanel.js
// Settings modal. Two modes ('menu' / 'rename') share chrome (backdrop, frame,
// title, "Logged in as", Close); only the body re-renders on mode swap. Owns
// a window-level keydown listener — Esc is mode-aware (rename→menu, menu→close),
// edit/submit keys only apply in rename mode.

import { getUsername, renameUser, logout } from '../../store/stash.js';

/**
 * Open the settings modal. Caller provides:
 *   - onRefreshTopBar(): called after a successful rename so the top bar can
 *     re-render with the new username.
 *   - onLogout(): called after a logout (callee must restart the scene).
 *
 * If already open, does nothing.
 */
export function openSettingsPanel(scene, { onRefreshTopBar, onLogout }) {
  if (scene._settingsOpen) return;
  scene._settingsOpen     = true;
  scene._settingsMode     = 'menu';
  scene._renameInput      = '';
  scene._renameSubmitting = false;
  scene._settingsCallbacks = { onRefreshTopBar, onLogout };

  // Full-screen backdrop swallows clicks under the panel and closes on click.
  const backdrop = scene.add.rectangle(0, 0, 1280, 720, 0x000000, 0.45)
    .setOrigin(0)
    .setInteractive();
  backdrop.on('pointerdown', () => closeSettingsPanel(scene));
  scene._settingsObjs.push(backdrop);

  // Centered panel: 360 × 240 at (640, 360).
  const PW = 360, PH = 240;
  const px = 640 - PW / 2, py = 360 - PH / 2;
  scene._settingsGeom = { px, py, PW, PH };

  const panel = scene.add.graphics();
  panel.fillStyle(0x12121e, 0.98);
  panel.fillRect(px, py, PW, PH);
  panel.lineStyle(1, 0x334466);
  panel.strokeRect(px, py, PW, PH);
  scene._settingsObjs.push(panel);

  // Clicks on the panel body should NOT propagate to the backdrop.
  const panelHit = scene.add.rectangle(px, py, PW, PH, 0x000000, 0).setOrigin(0).setInteractive();
  scene._settingsObjs.push(panelHit);

  scene._settingsTitleText = scene.add.text(px + PW / 2, py + 22, 'SETTINGS', {
    fontSize: '14px', color: '#aaaacc', fontFamily: 'monospace',
  }).setOrigin(0.5);
  scene._settingsObjs.push(scene._settingsTitleText);

  scene._settingsObjs.push(scene.add.graphics()
    .lineStyle(1, 0x223355)
    .lineBetween(px + 20, py + 42, px + PW - 20, py + 42));

  // "Logged in as" lives in chrome but its text object is tracked so it can
  // be refreshed when the rename succeeds and we swap back to menu mode.
  scene._loggedInAsText = scene.add.text(px + 20, py + 60,
    `Logged in as: ${getUsername() ?? '(unknown)'}`, {
    fontSize: '12px', color: '#8899bb', fontFamily: 'monospace',
  });
  scene._settingsObjs.push(scene._loggedInAsText);

  const closeBtn = scene.add.text(px + PW - 20, py + PH - 24, '[ × Close ]', {
    fontSize: '12px', color: '#8888aa', fontFamily: 'monospace',
  }).setOrigin(1, 0.5).setInteractive();
  closeBtn.on('pointerover', () => closeBtn.setColor('#ffffff'));
  closeBtn.on('pointerout',  () => closeBtn.setColor('#8888aa'));
  closeBtn.on('pointerdown', () => closeSettingsPanel(scene));
  scene._settingsObjs.push(closeBtn);

  renderSettingsBody(scene);

  scene._settingsKeyHandler = (e) => {
    if (e.key === 'Escape') {
      if (scene._settingsMode === 'rename') switchToMenuMode(scene);
      else                                  closeSettingsPanel(scene);
      return;
    }
    if (scene._settingsMode !== 'rename' || scene._renameSubmitting) return;
    if (e.key === 'Enter')     { submitRename(scene); return; }
    if (e.key === 'Backspace') {
      scene._renameInput = scene._renameInput.slice(0, -1);
      setRenameStatus(scene, '', '#778899');
      refreshRenameInputDisplay(scene);
      return;
    }
    if (e.key.length === 1 && scene._renameInput.length < 20) {
      scene._renameInput += e.key;
      setRenameStatus(scene, '', '#778899');
      refreshRenameInputDisplay(scene);
    }
  };
  window.addEventListener('keydown', scene._settingsKeyHandler);
}

function renderSettingsBody(scene) {
  for (const obj of scene._settingsBodyObjs) obj.destroy();
  scene._settingsBodyObjs = [];
  scene._renameInputText  = null;
  scene._renameStatusText = null;
  scene._renameBtn        = null;
  scene._renameCancelBtn  = null;

  if (scene._settingsMode === 'rename') renderRenameBody(scene);
  else                                   renderMenuBody(scene);
}

function renderMenuBody(scene) {
  const { px, py } = scene._settingsGeom;

  // Debug Mode toggle. Locked to ON for now — the only dungeon we ship today
  // is the debug/testing build. When OFF becomes live, entering the dungeon
  // should route through the production gameplay path (matchmaking, etc.).
  scene._settingsBodyObjs.push(scene.add.text(px + 20, py + 82, 'DEBUG MODE', {
    fontSize: '12px', color: '#8899bb', fontFamily: 'monospace',
  }));
  scene._settingsBodyObjs.push(scene.add.text(px + 130, py + 80, '[ ON ]', {
    fontSize: '14px', color: '#ffcc44', fontFamily: 'monospace',
  }));
  scene._settingsBodyObjs.push(scene.add.text(px + 190, py + 80, '[ OFF ]', {
    fontSize: '14px', color: '#445566', fontFamily: 'monospace',
  }));
  scene._settingsBodyObjs.push(scene.add.text(px + 20, py + 102,
    'locked — dungeon is tuned for testing', {
    fontSize: '10px', color: '#556677', fontFamily: 'monospace',
  }));

  const renameBtn = scene.add.text(px + 20, py + 128, '[ Rename ]', {
    fontSize: '14px', color: '#ffcc44', fontFamily: 'monospace',
  }).setInteractive();
  renameBtn.on('pointerover', () => renameBtn.setColor('#ffffff'));
  renameBtn.on('pointerout',  () => renameBtn.setColor('#ffcc44'));
  renameBtn.on('pointerdown', () => switchToRenameMode(scene));
  scene._settingsBodyObjs.push(renameBtn);

  const logoutBtn = scene.add.text(px + 20, py + 158, '[ Log Out ]', {
    fontSize: '14px', color: '#ffcc44', fontFamily: 'monospace',
  }).setInteractive();
  logoutBtn.on('pointerover', () => logoutBtn.setColor('#ffffff'));
  logoutBtn.on('pointerout',  () => logoutBtn.setColor('#ffcc44'));
  logoutBtn.on('pointerdown', () => doLogout(scene));
  scene._settingsBodyObjs.push(logoutBtn);
}

function renderRenameBody(scene) {
  const { px, py, PW } = scene._settingsGeom;

  scene._settingsBodyObjs.push(scene.add.text(px + 20, py + 92, 'NEW NAME', {
    fontSize: '11px', color: '#556677', fontFamily: 'monospace',
  }));

  const inputBox = scene.add.graphics();
  inputBox.lineStyle(1, 0x334466);
  inputBox.strokeRect(px + 20, py + 106, PW - 40, 24);
  scene._settingsBodyObjs.push(inputBox);

  scene._renameInputText = scene.add.text(px + 26, py + 110, '', {
    fontSize: '13px', color: '#ffcc44', fontFamily: 'monospace',
  });
  scene._settingsBodyObjs.push(scene._renameInputText);
  refreshRenameInputDisplay(scene);

  scene._renameBtn = scene.add.text(px + 20, py + 142, '[ Save ]', {
    fontSize: '13px', color: '#88ccff', fontFamily: 'monospace',
  }).setInteractive();
  scene._renameBtn.on('pointerover', () => { if (!scene._renameSubmitting) scene._renameBtn.setColor('#ffffff'); });
  scene._renameBtn.on('pointerout',  () => { if (!scene._renameSubmitting) scene._renameBtn.setColor('#88ccff'); });
  scene._renameBtn.on('pointerdown', () => submitRename(scene));
  scene._settingsBodyObjs.push(scene._renameBtn);

  scene._renameCancelBtn = scene.add.text(px + 90, py + 142, '[ Cancel ]', {
    fontSize: '13px', color: '#8888aa', fontFamily: 'monospace',
  }).setInteractive();
  scene._renameCancelBtn.on('pointerover', () => scene._renameCancelBtn.setColor('#ffffff'));
  scene._renameCancelBtn.on('pointerout',  () => scene._renameCancelBtn.setColor('#8888aa'));
  scene._renameCancelBtn.on('pointerdown', () => switchToMenuMode(scene));
  scene._settingsBodyObjs.push(scene._renameCancelBtn);

  scene._renameStatusText = scene.add.text(px + 180, py + 144, '', {
    fontSize: '11px', color: '#778899', fontFamily: 'monospace',
  });
  scene._settingsBodyObjs.push(scene._renameStatusText);
}

function switchToRenameMode(scene) {
  scene._settingsMode     = 'rename';
  scene._renameInput      = getUsername() ?? '';
  scene._renameSubmitting = false;
  scene._settingsTitleText?.setText('SETTINGS  ›  RENAME');
  scene._settingsTitleText?.setColor('#ffcc44');
  renderSettingsBody(scene);
}

function switchToMenuMode(scene) {
  scene._settingsMode     = 'menu';
  scene._renameInput      = '';
  scene._renameSubmitting = false;
  scene._settingsTitleText?.setText('SETTINGS');
  scene._settingsTitleText?.setColor('#aaaacc');
  // Refresh "Logged in as" so a just-completed rename is reflected.
  scene._loggedInAsText?.setText(`Logged in as: ${getUsername() ?? '(unknown)'}`);
  renderSettingsBody(scene);
}

function refreshRenameInputDisplay(scene) {
  if (!scene._renameInputText) return;
  scene._renameInputText.setText(`${scene._renameInput}█`);
}

function setRenameStatus(scene, text, color) {
  if (!scene._renameStatusText) return;
  scene._renameStatusText.setText(text);
  scene._renameStatusText.setColor(color);
}

async function submitRename(scene) {
  if (scene._renameSubmitting) return;
  const trimmed = scene._renameInput.trim();
  if (!trimmed) {
    setRenameStatus(scene, 'Name cannot be empty', '#cc7766');
    return;
  }
  if (trimmed === getUsername()) {
    setRenameStatus(scene, 'Already named that', '#aaaa88');
    return;
  }

  scene._renameSubmitting = true;
  scene._renameBtn?.setColor('#556677');
  setRenameStatus(scene, 'Renaming…', '#aaaaaa');

  let result;
  try {
    result = await renameUser(trimmed);
  } catch {
    scene._renameSubmitting = false;
    scene._renameBtn?.setColor('#88ccff');
    setRenameStatus(scene, 'Could not connect', '#cc7766');
    return;
  }

  if (result.ok) {
    setRenameStatus(scene, 'Saved ✓', '#88cc88');
    scene._settingsCallbacks?.onRefreshTopBar?.();
    // Disable buttons so a stray click during the close delay can't fire.
    scene._renameBtn?.disableInteractive();
    scene._renameCancelBtn?.disableInteractive();
    scene.time.delayedCall(600, () => closeSettingsPanel(scene));
    return;
  }

  scene._renameSubmitting = false;
  scene._renameBtn?.setColor('#88ccff');
  if (result.error === 'username_taken')        setRenameStatus(scene, 'Name already taken', '#cc7766');
  else if (result.error === 'invalid_username') setRenameStatus(scene, 'Invalid name',       '#cc7766');
  else                                          setRenameStatus(scene, result.error ?? 'Failed', '#cc7766');
}

export function closeSettingsPanel(scene) {
  if (!scene._settingsOpen) return;
  if (scene._settingsKeyHandler) {
    window.removeEventListener('keydown', scene._settingsKeyHandler);
    scene._settingsKeyHandler = null;
  }
  for (const obj of scene._settingsBodyObjs) obj.destroy();
  for (const obj of scene._settingsObjs)     obj.destroy();
  scene._settingsBodyObjs   = [];
  scene._settingsObjs       = [];
  scene._settingsOpen       = false;
  scene._settingsTitleText  = null;
  scene._loggedInAsText     = null;
  scene._renameInputText    = null;
  scene._renameStatusText = null;
  scene._renameBtn        = null;
  scene._renameCancelBtn  = null;
  scene._renameSubmitting = false;
  scene._settingsCallbacks = null;
}

function doLogout(scene) {
  const onLogout = scene._settingsCallbacks?.onLogout;
  closeSettingsPanel(scene);
  logout();
  onLogout?.();
}
