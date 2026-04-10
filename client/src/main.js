import Phaser from 'phaser';

class EmptyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'EmptyScene' });
  }

  create() {}
}

const config = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: '#1a1a2e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [EmptyScene],
};

new Phaser.Game(config);
