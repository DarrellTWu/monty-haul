// client/src/input/InputHandler.js
// Translates keyboard state into server messages.
//
// WASD / arrow keys → move (held)
// Space             → attack (keydown only)
// I                 → inventory toggle (onInventoryDown callback)
// F                 → world interaction / chest loot (onInteract callback)
// 1-9, 0           → use hotbar slot 0-9 (onHotbar(slot) callback)
//
// Set handler.enabled = false to suppress movement, attack, interact, and
// hotbar input. I still fires when disabled so the player can close inventory.

import { sendMove, sendStop, sendAttack } from '../network/ColyseusClient.js';

const HOTBAR_CODES = [
  Phaser.Input.Keyboard.KeyCodes.ONE,
  Phaser.Input.Keyboard.KeyCodes.TWO,
  Phaser.Input.Keyboard.KeyCodes.THREE,
  Phaser.Input.Keyboard.KeyCodes.FOUR,
  Phaser.Input.Keyboard.KeyCodes.FIVE,
  Phaser.Input.Keyboard.KeyCodes.SIX,
  Phaser.Input.Keyboard.KeyCodes.SEVEN,
  Phaser.Input.Keyboard.KeyCodes.EIGHT,
  Phaser.Input.Keyboard.KeyCodes.NINE,
  Phaser.Input.Keyboard.KeyCodes.ZERO,
];

export class InputHandler {
  /** @param {Phaser.Scene} scene */
  constructor(scene) {
    this.enabled = true;

    /** Called when I is pressed (regardless of enabled state). */
    this.onInventoryDown = null;

    /** Called when F is pressed while enabled. */
    this.onInteract = null;

    /** Called with slot index 0-9 when a hotbar key is pressed while enabled. */
    this.onHotbar = null;

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
      inventory: Phaser.Input.Keyboard.KeyCodes.I,
      interact:  Phaser.Input.Keyboard.KeyCodes.F,
    });

    // Hotbar keys registered separately so we can iterate them.
    this._hotbarKeys = HOTBAR_CODES.map((code, i) => {
      const key = scene.input.keyboard.addKey(code);
      key.on('down', () => { if (this.enabled) this.onHotbar?.(i); });
      return key;
    });

    this._wasMoving = false;

    this._keys.attack.on('down', () => {
      if (this.enabled) sendAttack();
    });

    // I fires regardless of enabled so player can close inventory from inside scene.
    this._keys.inventory.on('down', () => {
      this.onInventoryDown?.();
    });

    this._keys.interact.on('down', () => {
      if (this.enabled) this.onInteract?.();
    });
  }

  /** Call every frame from DungeonScene.update(). */
  update() {
    if (!this.enabled) {
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
    this._keys.inventory.removeAllListeners();
    this._keys.interact.removeAllListeners();
    for (const key of this._hotbarKeys) key.removeAllListeners();
  }
}
