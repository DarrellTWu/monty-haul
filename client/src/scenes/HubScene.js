// client/src/scenes/HubScene.js
// Entry point scene: class selection. Passes { class } to DungeonScene on confirm.

export class HubScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HubScene' });
  }

  create() {
    this._selected = null;
    this._cards = {};

    this.add.text(640, 70, "MONTY HAUL'S DUNGEON CRAWL", {
      fontSize: '26px', color: '#ffdd88', fontFamily: 'monospace',
    }).setOrigin(0.5);

    this.add.text(640, 115, 'Choose Your Class', {
      fontSize: '16px', color: '#8888aa', fontFamily: 'monospace',
    }).setOrigin(0.5);

    this._makeClassCard(330, 320, 'fighter',   'Fighter',   ['Longsword', 'Chain Mail', 'Second Wind']);
    this._makeClassCard(640, 320, 'monk',      'Monk',      ['Shortsword', 'Unarmored Defense', 'Martial Arts']);
    this._makeClassCard(950, 320, 'barbarian', 'Barbarian', ['Greatsword', 'Chain Mail', 'Rage (2 uses)']);

    this._enterBtn = this.add.text(640, 590, '[ Enter Dungeon ]', {
      fontSize: '20px', color: '#444455', fontFamily: 'monospace',
    }).setOrigin(0.5).setInteractive();

    this._enterBtn.on('pointerdown', () => {
      if (this._selected) this.scene.start('DungeonScene', { class: this._selected });
    });
  }

  _makeClassCard(x, y, classId, label, traits) {
    const card = this.add.rectangle(x, y, 280, 260, 0x111122)
      .setStrokeStyle(2, 0x334466)
      .setInteractive();

    this.add.text(x, y - 90, label, {
      fontSize: '20px', color: '#ccddff', fontFamily: 'monospace',
    }).setOrigin(0.5);

    this.add.graphics().lineStyle(1, 0x334466).lineBetween(x - 100, y - 65, x + 100, y - 65);

    traits.forEach((t, i) => {
      this.add.text(x, y - 38 + i * 30, `· ${t}`, {
        fontSize: '14px', color: '#8899bb', fontFamily: 'monospace',
      }).setOrigin(0.5);
    });

    card.on('pointerdown', () => this._select(classId));
    card.on('pointerover', () => {
      if (this._selected !== classId) card.setStrokeStyle(2, 0x5566aa);
    });
    card.on('pointerout', () => {
      if (this._selected !== classId) card.setStrokeStyle(2, 0x334466);
    });

    this._cards[classId] = card;
  }

  _select(classId) {
    this._selected = classId;
    for (const [id, card] of Object.entries(this._cards)) {
      card.setStrokeStyle(2, id === classId ? 0xffcc44 : 0x334466);
    }
    this._enterBtn.setColor('#ffcc44');
  }
}
