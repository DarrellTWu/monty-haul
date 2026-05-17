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
export function showLoginPanel(scene, { onSuccess }) {
  const cx = 640, cy = 340;

  scene._loginObjs.push(scene.add.text(cx, cy - 120, "MONTY HAUL'S DUNGEON CRAWL", {
    fontSize: '26px', color: '#ffdd88', fontFamily: 'monospace',
  }).setOrigin(0.5));

  const panel = scene.add.graphics();
  panel.fillStyle(0x12121e, 0.97);
  panel.fillRect(cx - 240, cy - 70, 480, 180);
  panel.lineStyle(1, 0x334466);
  panel.strokeRect(cx - 240, cy - 70, 480, 180);
  scene._loginObjs.push(panel);

  scene._loginObjs.push(scene.add.text(cx, cy - 44, 'RAIDER NAME', {
    fontSize: '12px', color: '#556677', fontFamily: 'monospace',
  }).setOrigin(0.5));

  scene._loginInputDisplay = scene.add.text(cx, cy - 8, '█', {
    fontSize: '22px', color: '#ffcc44', fontFamily: 'monospace',
  }).setOrigin(0.5);
  scene._loginObjs.push(scene._loginInputDisplay);

  scene._loginObjs.push(scene.add.graphics()
    .lineStyle(1, 0x334466)
    .lineBetween(cx - 200, cy + 22, cx + 200, cy + 22));

  scene._loginStatusText = scene.add.text(cx, cy + 44, 'type your name and press Enter', {
    fontSize: '11px', color: '#445566', fontFamily: 'monospace',
  }).setOrigin(0.5);
  scene._loginObjs.push(scene._loginStatusText);

  const enterBtn = scene.add.text(cx, cy + 80, '[ Enter the Dungeon ]', {
    fontSize: '15px', color: '#334455', fontFamily: 'monospace',
  }).setOrigin(0.5);
  scene._loginObjs.push(enterBtn);
  scene._loginEnterBtn = enterBtn;

  scene._loginUsername = '';

  const submit = () => submitLogin(scene, onSuccess);

  scene._keyHandler = (e) => {
    if (e.key === 'Backspace') {
      scene._loginUsername = scene._loginUsername.slice(0, -1);
    } else if (e.key === 'Enter') {
      if (scene._loginUsername.trim()) submit();
    } else if (e.key.length === 1 && scene._loginUsername.length < 20) {
      scene._loginUsername += e.key;
    }
    const display = scene._loginUsername || '';
    scene._loginInputDisplay?.setText(display + '█');
    const ready = !!scene._loginUsername.trim();
    scene._loginEnterBtn?.setColor(ready ? '#ffcc44' : '#334455');
    if (ready) {
      scene._loginEnterBtn?.setInteractive();
      scene._loginEnterBtn?.removeAllListeners();
      scene._loginEnterBtn?.on('pointerdown', () => submit());
      scene._loginEnterBtn?.on('pointerover', () => scene._loginEnterBtn.setColor('#ffffff'));
      scene._loginEnterBtn?.on('pointerout',  () => scene._loginEnterBtn.setColor('#ffcc44'));
    }
  };
  window.addEventListener('keydown', scene._keyHandler);
}

async function submitLogin(scene, onSuccess) {
  const username = scene._loginUsername.trim();
  if (!username) return;
  scene._loginStatusText?.setText('Connecting...');
  scene._loginEnterBtn?.setColor('#556677');

  try {
    const data = await HubAPI.login(username);
    if (!data.ok) {
      scene._loginStatusText?.setText('Could not connect — is the server running?');
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
  scene._loginStatusText   = null;
  scene._loginEnterBtn     = null;
}
