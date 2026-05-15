---
status: shipped
updated: 2026-05-14
purpose: Client↔server WebSocket message protocol + Hub HTTP routes. Read when the task adds, removes, or modifies a message/route.
---

# Client-Server Protocol

## WebSocket (Colyseus)
All messages handled in `DungeonRoom.js` `onCreate`.

### Client → Server

| Message | Payload | Notes |
|---|---|---|
| `move` | `{ dx, dy }` | Normalized direction (-1..1 each axis) |
| `stop` | — | Zero player velocity |
| `attack` | — | Attempt melee attack |
| `equip` | `{ itemId, slot? }` | `slot`: `'weapon' \| 'offhand' \| 'armor'` or omit for auto-detect |
| `unequip` | `{ slot }` | `slot`: `'weapon' \| 'offhand' \| 'armor'` |
| `open_container` | `{ sourceKind, sourceId }` | `sourceKind`: `'chest' \| 'corpse'`. Server replies `container_lock_denied` if already locked by another player |
| `close_container` | `{ sourceKind, sourceId }` | Release lock. No-op if caller doesn't hold it |
| `take_item` | `{ sourceKind, sourceId, itemIndex }` | Move item at index from container → player inventory. Validates lock, range, index bounds |
| `take_gold` | `{ sourceId }` | Transfer all gold from a corpse to the player. Validates lock and range |
| `drop_item` | `{ sourceKind, sourceId, inventoryIndex }` | Move item at inventory index → container. Validates lock and range; clears hotbar binding if last copy of that item |
| `descend` | `{ stairId }` | Validates exists, !locked, in range. Swaps floor for everyone in the room |
| `assign_hotbar` | `{ itemId, slot }` | Bind ability/consumable id to hotbar index 0–9 |
| `use_hotbar` | `{ slot }` | Activate hotbar slot 0–9. Consumable types: `healing`, `bless`, `longstrider`, `false_life`, `extract` (run terminator) |

### Server → Client

| Message | Payload | Notes |
|---|---|---|
| `combat_log` | `{ message }` | Text line pushed to the HUD combat log |
| `container_lock_denied` | `{ sourceKind, sourceId, holder }` | Sent when `open_container` is rejected; `InventoryScene` shows a HUD log line and closes |

### Validation Discipline
Server validates all inputs. If invalid (item not in bag, two-handed + offhand conflict, locked stair, etc.), the message is processed silently (no error feedback sent to client). Client relies on state sync to detect successful changes; UI reflects server state, **never** client prediction.

Open gap: server-side ability score validation only checks keys exist, not budget/range. See architecture review §3.2.

## HTTP (Express `/hub`)
Router at `server/routes/hub.js`. CORS-enabled for Vite dev.

| Route | Body | Returns |
|---|---|---|
| `POST /login` | `{ username }` | `{ playerId, username, stash, gold, raiderPack }` |
| `GET /:playerId` | — | `{ playerId, username, stash, gold, raiderPack }` |
| `POST /:playerId/raider/add` | `{ itemId }` | Updated state |
| `POST /:playerId/raider/remove` | `{ itemId }` | Updated state |
| `POST /:playerId/raider/dump` | — | Dumps entire raider pack to stash |
| `POST /:playerId/buy` | `{ itemId }` | Price resolved server-side from `BUYABLE_PRICES` |
| `POST /:playerId/sell` | `{ itemId }` | Price resolved server-side from `sellPrice()` |
| `POST /:playerId/craft` | `{ recipeId }` | Recipe resolved server-side from `RECIPE_REGISTRY` |
| `POST /:playerId/rename` | `{ username }` | `{ ok, username }` on success; `{ ok: false, error }` with HTTP 400 on `'username_taken'` / `'invalid_username'` / unknown player |

Each route is wrapped in an `asyncRoute` helper that catches throws (e.g. Supabase outage) and returns 500.

## Client API Wrappers
- `client/src/network/HubAPI.js` — thin async fetch wrapper for `/hub`. Used exclusively by `store/stash.js`.
- `client/src/network/ColyseusClient.js` — `joinDungeon(opts)` forwards `{ class, playerId, abilityScores }`; container protocol senders; `sendDescend`.
