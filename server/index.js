import { createRequire } from 'module';
const { Server }             = createRequire(import.meta.url)('colyseus');
const { WebSocketTransport } = createRequire(import.meta.url)('@colyseus/ws-transport');
const express                = createRequire(import.meta.url)('express');
import { createServer } from 'http';

import { DungeonRoom }                          from './rooms/DungeonRoom.js';
import { hubRouter }                            from './routes/hub.js';
import { deadLetterCount, DEAD_LETTER_PATH }    from './persistence/deadLetter.js';
import { validateFloorData }                    from '../shared/logic/validate-floors.js';
import { FLOOR_REGISTRY }                       from '../shared/data/floors/index.js';
import { ENEMY_REGISTRY }                       from '../shared/data/enemies/tier1.js';
import { isKnownItem }                          from '../shared/data/items/index.js';

// Boot-time floor validation: a broken floor file must fail here with a named
// error, never as a mid-tick crash with players connected.
const floorErrors = validateFloorData(FLOOR_REGISTRY, {
  enemyTypes: Object.keys(ENEMY_REGISTRY),
  isKnownItem,
});
if (floorErrors.length > 0) {
  console.error(`[startup] FLOOR DATA INVALID — refusing to boot:\n  - ${floorErrors.join('\n  - ')}`);
  process.exit(1);
}

// Hosted platforms (Railway, Render, Fly) inject PORT; default keeps local dev on 2567.
const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(express.json());
// Liveness probe for hosting platforms + humans. Deliberately does not touch Supabase.
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/hub', hubRouter);

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});
gameServer.define('dungeon', DungeonRoom);

gameServer.listen(PORT).then(async () => {
  console.log(`Colyseus server listening on ws://localhost:${PORT}`);
  try {
    const n = await deadLetterCount();
    if (n > 0) {
      console.warn(`[startup] ⚠ Dead letter queue has ${n} pending entries — see ${DEAD_LETTER_PATH}`);
    }
  } catch (err) {
    console.error('[startup] dead-letter count check failed:', err);
  }
});
