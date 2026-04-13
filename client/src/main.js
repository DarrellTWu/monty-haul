import Phaser from 'phaser';
import { DungeonScene }   from './scenes/DungeonScene.js';
import { HUDScene }       from './scenes/HUDScene.js';
import { InventoryScene } from './scenes/InventoryScene.js';

const config = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: '#0d0d0d',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // Scene order = render order. DungeonScene renders first (world),
  // HUDScene on top (always-on HUD), InventoryScene topmost (modal overlay).
  scene: [DungeonScene, HUDScene, InventoryScene],
};

new Phaser.Game(config);
