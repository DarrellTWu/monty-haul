import Phaser from 'phaser';
import { HubScene }       from './scenes/HubScene.js';
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
  // Scene order = render order. HubScene is the entry point (auto-starts).
  // DungeonScene renders the world, HUDScene overlays the HUD,
  // InventoryScene is a modal overlay on top.
  scene: [HubScene, DungeonScene, HUDScene, InventoryScene],
};

new Phaser.Game(config);
