# Client Package
Phaser 3 browser client. Rendering and input only.
NEVER write game logic here. NEVER use Phaser.Physics.
All game state comes from Colyseus state sync via network/ColyseusClient.js.
Import from shared/ for type definitions only.