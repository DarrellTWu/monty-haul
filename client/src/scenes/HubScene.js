// client/src/scenes/HubScene.js
// Entry point scene. Stub: immediately starts DungeonScene as Fighter.
// Will grow into class selection, crafting, and social features.

export class HubScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HubScene' });
  }

  create() {
    this.add.text(640, 360, 'Entering dungeon…', {
      fontSize: '20px', color: '#aaaacc', fontFamily: 'monospace',
    }).setOrigin(0.5);

    // Stub: start as Fighter until class selection UI is implemented.
    this.scene.start('DungeonScene', { class: 'fighter' });
  }
}
