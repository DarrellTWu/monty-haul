// client/src/input/InputHandler.js
// Translates keyboard state into server messages.
// WASD / arrow keys → move messages sent every frame while held.
// Space → attack message sent on keydown (not held).
// Tab → calls this.onTabDown() callback (DungeonScene wires this to toggle inventory).
//
// Set handler.enabled = false to suppress all movement and attack input
// (used while inventory is open). Tab still works when disabled so the
// player can close the inventory from within the scene.

import { sendMove, sendStop, sendAttack } from '../network/ColyseusClient.js';

export class InputHandler {
  /** @param {Phaser.Scene} scene */
  constructor(scene) {
    this.enabled = true;

    /** Called when Tab is pressed. Wire this up in DungeonScene. */
    this.onTabDown = null;

    this._keys = scene.input.keyboard.addKeys({
      up:        Phaser.Input.Keyboard.KeyCodes.W,
      down:      Phaser.Input.Keyboard.KeyCodes.S,
      left:      Phaser.Input.Keyboard.KeyCodes.A,
      right:     Phaser.Input.Keyboard.KeyCodes.D,
      upArrow:   Phaser.Input.Keyboard.KeyCodes.UP,
      downArrow: Phaser.Input.Keyboard.KeyCodes.DOWN,
      leftArrow: Phaser.Input.Keyboard.KeyCodes.LEFT,
      rightArrow:Phaser.Input.Keyboard.KeyCodes.RIGHT,
      attack:    Phaser.Input.Keyboard.KeyCodes.SPACE,
      tab:       Phaser.Input.Keyboard.KeyCodes.TAB,
    });

    this._wasMoving = false;

    this._keys.attack.on('down', () => {
      if (this.enabled) sendAttack();
    });

    this._keys.tab.on('down', () => {
      this.onTabDown?.();
    });
  }

  /** Call every frame from DungeonScene.update(). */
  update() {
    if (!this.enabled) {
      // Ensure the server knows we stopped if we were mid-move.
      if (this._wasMoving) {
        sendStop();
        this._wasMoving = false;
      }
      return;
    }

    const k = this._keys;
    let dx = 0;
    let dy = 0;

    if (k.left.isDown  || k.leftArrow.isDown)  dx -= 1;
    if (k.right.isDown || k.rightArrow.isDown)  dx += 1;
    if (k.up.isDown    || k.upArrow.isDown)     dy -= 1;
    if (k.down.isDown  || k.downArrow.isDown)   dy += 1;

    const isMoving = dx !== 0 || dy !== 0;

    if (isMoving) {
      const len = Math.sqrt(dx * dx + dy * dy);
      sendMove(dx / len, dy / len);
      this._wasMoving = true;
    } else if (this._wasMoving) {
      sendStop();
      this._wasMoving = false;
    }
  }

  destroy() {
    this._keys.attack.removeAllListeners();
    this._keys.tab.removeAllListeners();
  }
}
