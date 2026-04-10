import { Server } from 'colyseus';
import { DungeonRoom } from './rooms/DungeonRoom.js';

const PORT = 2567;

const gameServer = new Server();

gameServer.define('dungeon', DungeonRoom);

gameServer.listen(PORT).then(() => {
  console.log(`Colyseus server listening on ws://localhost:${PORT}`);
});
