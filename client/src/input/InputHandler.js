// client/src/input/InputHandler.js
// Translates keyboard state into server messages.
// WASD / arrow keys → move messages sent every frame while held.
// Space → attack message sent on keydown (not held).
//
// Designed to be instantiated once inside DungeonScene.create() and updated
// inside DungeonScene.update(). When real sprites and animations exist,
// the attack input may need buffering — keep that concern here, not in the scene.

import { sendMove, sendStop, sendAttack } from '../network/ColyseusClient.js';

export class InputHandler {
  /**
   * @param {Phaser.Scene} scene - the scene this handler belongs to
   */
  constructor(scene) {
    this._keys = scene.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      upArrow: Phaser.Input.Keyboard.KeyCodes.UP,
      downArrow: Phaser.Input.Keyboard.KeyCodes.DOWN,
      leftArrow: Phaser.Input.Keyboard.KeyCodes.LEFT,
      rightArrow: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      attack: Phaser.Input.Keyboard.KeyCodes.SPACE,
    });

    this._wasMoving = false;

    // Attack fires once per keydown, not on hold.
    this._keys.attack.on('down', () => sendAttack());
  }

  /**
   * Call every frame from DungeonScene.update().
   */
  update() {
    const k = this._keys;
    let dx = 0;
    let dy = 0;

    if (k.left.isDown || k.leftArrow.isDown)  dx -= 1;
    if (k.right.isDown || k.rightArrow.isDown) dx += 1;
    if (k.up.isDown || k.upArrow.isDown)       dy -= 1;
    if (k.down.isDown || k.downArrow.isDown)   dy += 1;

    const isMoving = dx !== 0 || dy !== 0;

    if (isMoving) {
      // Normalize diagonal movement so it isn't faster than cardinal.
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
  }
}
