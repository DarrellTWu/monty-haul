// client/src/ui/hub/LoginPanel.js
// Login screen. Owns its own window-level keydown handler — cleanup is
// triggered when the panel calls onSuccess (caller swaps to the hub).

import { HubAPI } from '../../network/HubAPI.js';
import { initFromServer } from '../../store/stash.js';

/**
 * Render the login panel. Internal state: typed-so-far username string.
 * On Enter (or button press) the panel submits, and on success calls
 * `onSuccess(data)` so the caller can swap to the hub view.
 *
 * The panel owns lifecycle of:
 *   - gfx objects added to `scene._loginObjs`
 *   - a `keydown` listener on `window` (kept on `scene._keyHandler` for cleanup)
 *
 * cleanupLoginPanel(scene) tears both down.
 */
const MIN_PASSWORD_LEN = 6; // mirrors the /hub/login server rule

export function showLoginPanel(scene, { onSuccess }) {
  const cx = 640, cy = 340;

  scene._loginObjs.push(scene.add.text(cx, cy - 120, "MONTY HAUL'S DUNGEON CRAWL", {
    fontSize: '26px', color: '#ffdd88', fontFamily: 'monospace',
  }).setOrigin(0.5));

  const panel = scene.add.graphics();
  panel.fillStyle(0x12121e, 0.97);
  panel.fillRect(cx - 240, cy - 70, 480, 240);
  panel.lineStyle(1, 0x334466);
  panel.strokeRect(cx - 240, cy - 70, 480, 240);
  scene._loginObjs.push(panel);

  // Two fields: name + password. Click a label/value or press Tab/Enter to
  // move focus; Enter on the password field submits. New usernames register
  // with the typed password; existing ones must match.
  scene._loginObjs.push(scene.add.text(cx, cy - 50, 'RAIDER NAME', {
    fontSize: '12px', color: '#556677', fontFamily: 'monospace',
  }).setOrigin(0.5));

  scene._loginInputDisplay = scene.add.text(cx, cy - 24, '█', {
    fontSize: '20px', color: '#ffcc44', fontFamily: 'monospace',
  }).setOrigin(0.5);
  scene._loginObjs.push(scene._loginInputDisplay);

  scene._loginObjs.push(scene.add.text(cx, cy + 8, 'PASSWORD  (new name = registers it)', {
    fontSize: '12px', color: '#556677', fontFamily: 'monospace',
  }).setOrigin(0.5));

  scene._loginPassDisplay = scene.add.text(cx, cy + 34, '', {
    fontSize: '20px', color: '#556677', fontFamily: 'monospace',
  }).setOrigin(0.5);
  scene._loginObjs.push(scene._loginPassDisplay);

  scene._loginStatusText = scene.add.text(cx, cy + 70, 'name ⏎ password ⏎ — 6+ character password', {
    fontSize: '11px', color: '#445566', fontFamily: 'monospace',
  }).setOrigin(0.5);
  scene._loginObjs.push(scene._loginStatusText);

  const enterBtn = scene.add.text(cx, cy + 110, '[ Enter the Dungeon ]', {
    fontSize: '15px', color: '#334455', fontFamily: 'monospace',
  }).setOrigin(0.5);
  scene._loginObjs.push(enterBtn);
  scene._loginEnterBtn = enterBtn;

  scene._loginUsername = '';
  scene._loginPassword = '';
  scene._loginField    = 'name'; // 'name' | 'pass'

  const submit = () => submitLogin(scene, onSuccess);
  const ready  = () => !!scene._loginUsername.trim() && scene._loginPassword.length >= MIN_PASSWORD_LEN;

  const redraw = () => {
    const nameActive = scene._loginField === 'name';
    scene._loginInputDisplay?.setText(scene._loginUsername + (nameActive ? '█' : ''))
      .setColor(nameActive ? '#ffcc44' : '#aabbcc');
    scene._loginPassDisplay?.setText('•'.repeat(scene._loginPassword.length) + (nameActive ? '' : '█'))
      .setColor(nameActive ? '#556677' : '#ffcc44');
    scene._loginEnterBtn?.setColor(ready() ? '#ffcc44' : '#334455');
    if (ready()) {
      scene._loginEnterBtn?.setInteractive();
      scene._loginEnterBtn?.removeAllListeners();
      scene._loginEnterBtn?.on('pointerdown', () => submit());
      scene._loginEnterBtn?.on('pointerover', () => scene._loginEnterBtn.setColor('#ffffff'));
      scene._loginEnterBtn?.on('pointerout',  () => scene._loginEnterBtn.setColor('#ffcc44'));
    }
  };

  scene._keyHandler = (e) => {
    const field = scene._loginField;
    if (e.key === 'Backspace') {
      if (field === 'name') scene._loginUsername = scene._loginUsername.slice(0, -1);
      else                  scene._loginPassword = scene._loginPassword.slice(0, -1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      scene._loginField = field === 'name' ? 'pass' : 'name';
    } else if (e.key === 'Enter') {
      if (field === 'name' && scene._loginUsername.trim()) scene._loginField = 'pass';
      else if (field === 'pass' && ready()) submit();
    } else if (e.key.length === 1) {
      if (field === 'name' && scene._loginUsername.length < 20) scene._loginUsername += e.key;
      if (field === 'pass' && scene._loginPassword.length < 64) scene._loginPassword += e.key;
    }
    redraw();
  };
  window.addEventListener('keydown', scene._keyHandler);
  redraw();
}

async function submitLogin(scene, onSuccess) {
  const username = scene._loginUsername.trim();
  const password = scene._loginPassword;
  if (!username || password.length < MIN_PASSWORD_LEN) return;
  scene._loginStatusText?.setText('Connecting...');
  scene._loginEnterBtn?.setColor('#556677');

  try {
    const data = await HubAPI.login(username, password);
    if (!data.ok) {
      scene._loginStatusText?.setText(
        data.error === 'invalid_credentials'
          ? 'Wrong password for that raider name.'
          : (data.error ?? 'Could not connect — is the server running?'),
      );
      return;
    }
    cleanupLoginPanel(scene);
    initFromServer(data.playerId, data);
    onSuccess(data);
  } catch {
    scene._loginStatusText?.setText('Could not connect — is the server running?');
  }
}

/** Tear down the login panel: removes the keydown listener and destroys gfx. */
export function cleanupLoginPanel(scene) {
  if (scene._keyHandler) {
    window.removeEventListener('keydown', scene._keyHandler);
    scene._keyHandler = null;
  }
  for (const obj of scene._loginObjs) obj.destroy();
  scene._loginObjs = [];
  scene._loginInputDisplay = null;
  scene._loginPassDisplay  = null;
  scene._loginStatusText   = null;
  scene._loginEnterBtn     = null;
}
