import Phaser from 'phaser';
import { DungeonScene } from './scenes/DungeonScene.js';

const config = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: '#0d0d0d',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [DungeonScene],
};

new Phaser.Game(config);
