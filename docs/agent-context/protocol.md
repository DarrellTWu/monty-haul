---
status: shipped
updated: 2026-05-18
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
| `attack` | `{ targetId? }` | Attempt an attack with the equipped weapon. Dispatch + gates run server-side via `pickAttackMode(weapon, distance)`. **Melee** weapons: `targetId` optional — omit for nearest-living-enemy fallback. **Ranged** weapons (`kind: 'ranged'`): `targetId` required; server runs range gate (`weapon.range.long`) and LoS gate (walls + locked-door rects). Any denial replies with `attack_denied` to the attacker only and **does not consume the cooldown**. |
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
| `choose_level_up` | `{ classId }` | Resolve a pending descend-triggered level-up. Only honored while `player.pendingLevelUp`; `classId` must be in `getEligibleClassChoicesForLevelUp(player)`. Silently dropped otherwise. See `agent-context/combat.md` (Level-Up + Multiclass). |

### Server → Client

| Message | Payload | Notes |
|---|---|---|
| `combat_log` | `{ message }` | Text line pushed to the HUD combat log |
| `container_lock_denied` | `{ sourceKind, sourceId, holder }` | Sent when `open_container` is rejected; `InventoryScene` shows a HUD log line and closes |
| `attack_denied` | `{ reason }` | Sent to the attacker only when an `attack` fails validation. `reason`: `'out_of_range' \| 'invalid_target' \| 'no_target' \| 'no_line_of_sight'`. `'no_target'` and `'no_line_of_sight'` are ranged-only. Client shows a HUD log line; cooldown is preserved. |
| `projectile_fired` | `{ attackerId, fromX, fromY, toX, toY, hit, style }` | Broadcast for any instant-resolution flying thing. `style: 'arrow'` for bows in v1; future values include `'bolt'`, `'thrown'`, `'firebolt'`, `'magic_missile'`. Server resolves the to-hit instantly at fire time; the message drives a cosmetic client tween. `hit` lets the client distinguish impact from miss-flyby. Area-effect spells will use a different message (not projectiles). |

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
- `client/src/network/ColyseusClient.js` — `joinDungeon(opts)` forwards `{ class, playerId, abilityScores }`; container protocol senders; `sendDescend`; `sendChooseLevelUp(classId)`.
