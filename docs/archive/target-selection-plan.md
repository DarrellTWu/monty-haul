---
status: archived
updated: 2026-05-16
purpose: Sprint plan for click/Tab target selection. SPACE still attacks; click and Tab now designate which enemy gets hit. Shipped — archived for reference.
---

# Target Selection Sprint Plan

## Goal

Give the player explicit control over which enemy SPACE attacks. Today `playerAttack` always picks the nearest living enemy in melee range. After this sprint:

- Clicking an enemy designates it as the current target.
- Tab cycles through nearby living enemies.
- SPACE attacks the designated target if one is set, otherwise falls back to the existing nearest-enemy behaviour.
- If the designated target is out of range when SPACE fires, the attack is rejected and the player sees "Target out of range" in the combat log. No cooldown is consumed.

Selection is client-side UI state. The server stays authoritative for what gets hit — it validates `targetId` on every attack.

## Design decisions (confirmed with user)

- **Out-of-range with explicit target → fail with feedback.** Forward-compatible with ranged weapons that have variable range. No fallback to nearest when the player has expressed intent.
- **Selection range = melee-aware now, weapon-aware later.** Melee weapons use a "nearby-ish" radius (`MELEE_SELECT_RANGE_PX`, ~2.5× hit range) for Tab cycling. Click works on any rendered enemy regardless of range — the out-of-range gate at attack time is sufficient. When ranged weapons land, the same constant pattern extends to `weapon.selectRangePx`.
- **On-death → auto-clear.** When the selected enemy dies, selection clears. Next SPACE falls back to nearest. No auto-advance.
- **Manual deselect = click empty space.** No Esc binding (keeps the door open for future menu use). Clicking another enemy replaces selection; clicking nothing clears it.

## Out of scope

- No `PlayerState.targetId` sync field. Other players don't see your reticle.
- No Esc-to-clear keybinding.
- No auto-advance to next target on death.
- No ranged-weapon code paths — only the constant name (`MELEE_SELECT_RANGE_PX`) hints at the future extension.

## Implementation

### 1. Protocol

Edit `docs/agent-context/protocol.md` after the code lands.

**Client → Server**

| Message | Payload | Notes |
|---|---|---|
| `attack` | `{ targetId? }` | Optional. If set, server attacks that specific enemy (validated). If omitted/null, server falls back to nearest-living-enemy. |

**Server → Client**

| Message | Payload | Notes |
|---|---|---|
| `attack_denied` | `{ reason }` | `reason`: `'out_of_range' \| 'invalid_target'`. Sent to the attacker only (`client.send`, not broadcast). No attack cooldown is consumed on denial. |

### 2. Shared

`shared/data/constants.js`: add

```js
// Tab/click target-selection radius for melee weapons. Wider than MELEE_HIT_RANGE_PX
// so the player can pre-select an enemy before stepping into hit range. When
// ranged weapons land, this becomes per-weapon (weapon.selectRangePx).
export const MELEE_SELECT_RANGE_PX = 240; // ~2.5x MELEE_HIT_RANGE_PX
```

(Tune in playtest; the constant is the contract, the number is a starting point.)

### 3. Server

`server/systems/CombatSystem.js`:

- Extend `playerAttack(state, sessionId, enemyDefs, targetId = null)`.
- If `targetId` is a non-empty string:
  - Look up the enemy. Missing or `!alive` → return `{ denied: 'invalid_target', logs: [] }`. No cooldown consumed.
  - In range check (`dist2d <= MELEE_HIT_RANGE_PX`). Out of range → return `{ denied: 'out_of_range', logs: [] }`. No cooldown consumed.
  - In range → use this enemy as the target (skip `nearestLivingEnemy`).
- If `targetId` is null/empty: existing nearest-enemy path. Unchanged.

`server/rooms/DungeonRoom.js`:

- `onMessage('attack', (client, payload) => …)` — accept `{ targetId }`.
- Pass `targetId` through to `playerAttack`.
- If `result.denied`, `client.send('attack_denied', { reason: result.denied })`. Don't broadcast.
- Existing `combat_log` broadcast path is unchanged for normal hits/misses.

### 4. Client

`client/src/network/ColyseusClient.js`:

- `sendAttack(targetId = null)` — include `{ targetId }` in payload.

`client/src/input/InputHandler.js`:

- Add Tab key binding (`Phaser.Input.Keyboard.KeyCodes.TAB`). On keydown when `enabled`, fire `this.onTabCycle?.()` callback.
- Also: SPACE no longer calls `sendAttack()` directly — instead fires `this.onAttack?.()`. The scene owns target context and decides what `targetId` to pass.
- Tab default-behaviour suppression: `event.preventDefault()` so the browser doesn't tab focus away.

`client/src/scenes/DungeonScene.js`:

- New field: `this._selectedEnemyId = null`.
- New gfx field on each enemy entry: `selectionRing` (Graphics, hidden by default).
- **Pointer-down handler** (`this.input.on('pointerdown', pointer => …)`):
  - Convert to world coords via `pointer.worldX/worldY`.
  - Hit-test enemy circles (any living rendered enemy on the current floor). Distance ≤ enemy render radius → select.
  - No hit → clear selection.
  - Skip when `InventoryScene` is active.
- **Tab callback**: build list of living enemies with `dist(player, enemy) <= MELEE_SELECT_RANGE_PX`, sorted by distance. Advance to the next entry after the current selection (wrap). If list is empty, no-op. If list has entries but current selection isn't in the list, pick the first.
- **Attack callback**: `sendAttack(this._selectedEnemyId)`.
- **Per-frame** in `update()`:
  - Auto-clear if `this._selectedEnemyId` references an enemy that's gone (`onRemove` covers floor change) or `!alive` (covers kill).
  - For each enemy gfx, draw/clear the selection ring based on whether `id === this._selectedEnemyId`.
- **`attack_denied` listener**: forward to HUD combat log:
  - `'out_of_range'` → "Target out of range."
  - `'invalid_target'` → "Invalid target." (defensive; shouldn't normally fire if client clears on death.)

Selection-ring visual: a thin yellow ring just outside the enemy circle (e.g. `radius + 4`, `lineStyle(2, 0xffff44)`), same depth as the enemy.

## Testing

### Pure unit tests (`shared/tests/`)

`shared/logic/combat.js` doesn't change — the targeting logic lives in `CombatSystem.js` (server). No new shared tests needed.

### Server-side tests

Add `server/tests/target-selection.test.js`. Build minimal `state` + `player` + two `enemy` fixtures, exercise `playerAttack`:

1. `targetId` omitted, two enemies in range → nearest is attacked (regression check on existing path).
2. `targetId` = far enemy, both in range → far enemy is the one whose HP drops, even when a closer one exists.
3. `targetId` = enemy out of range → returns `{ denied: 'out_of_range' }`, no HP change on target, **`player.attackCooldownMs` unchanged**.
4. `targetId` = dead enemy → returns `{ denied: 'invalid_target' }`, no cooldown consumed.
5. `targetId` = nonexistent id → returns `{ denied: 'invalid_target' }`.
6. `targetId` present and in range but `player.attackCooldownMs > 0` → no-op (existing gate still works).

Run via `node server/tests/target-selection.test.js`.

### Manual playtest checklist

Run `npm start`, join with any class, walk into a populated room.

- [ ] **No-selection baseline.** SPACE with no click/Tab → nearest enemy hit. (Regression.)
- [ ] **Click selects.** Click goblin A; ring appears. SPACE → goblin A is hit even when goblin B is closer.
- [ ] **Click reselects.** Click goblin B → ring moves to B. SPACE → B is hit.
- [ ] **Click empty → clears.** Click on bare floor → ring disappears. SPACE → back to nearest-enemy fallback.
- [ ] **Tab cycles.** With ≥2 enemies in select range, repeated Tab presses cycle through them in distance order, wrapping.
- [ ] **Tab outside range.** Tab with no enemies within `MELEE_SELECT_RANGE_PX` → no-op (no error, no flicker).
- [ ] **Out-of-range attack.** Click a distant enemy; SPACE → combat log shows "Target out of range." Attack cooldown not consumed (verifiable by immediate re-press succeeding once in range).
- [ ] **Death clears.** Selected enemy dies → ring disappears on death frame. Next SPACE goes to nearest.
- [ ] **Floor change clears.** Descend stairs with a selection set → on new floor, no ring (and no console errors from a dangling id).
- [ ] **Inventory suppresses.** Open inventory (I), click/Tab don't change selection. Close, selection state intact.
- [ ] **Multiplayer sanity.** Two clients in the same room: each sees only their own ring (since selection isn't synced). One player's selection doesn't leak to the other.

## Doc updates required after merge

Flag to user; don't update unprompted.

- `docs/agent-context/protocol.md` — new `attack` payload, new `attack_denied` message.
- `docs/agent-context/combat.md` — short note on target selection (SPACE attacks selected target if set, else nearest; out-of-range denial; client-only state).
- `docs/PROJECT_STRUCTURE.md` — if `target-selection.test.js` lands, add it to the tests table.
- Move this file to `docs/archive/` once shipped.
