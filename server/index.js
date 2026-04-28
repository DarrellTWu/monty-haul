import { createRequire } from 'module';
const { Server }             = createRequire(import.meta.url)('colyseus');
const { WebSocketTransport } = createRequire(import.meta.url)('@colyseus/ws-transport');
const express                = createRequire(import.meta.url)('express');
import { createServer } from 'http';

import { DungeonRoom } from './rooms/DungeonRoom.js';
import { hubRouter }   from './routes/hub.js';

const PORT = 2567;

const app = express();
app.use(express.json());
app.use('/hub', hubRouter);

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});
gameServer.define('dungeon', DungeonRoom);

gameServer.listen(PORT).then(() => {
  console.log(`Colyseus server listening on ws://localhost:${PORT}`);
});
