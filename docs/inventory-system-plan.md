# Inventory System — Build Plan

## What We're Building

A persistent item economy that spans the hub and dungeon:

1. **Equip your raider** in the hub — move items from the stash into the raider's pack before a run
2. **Enter the dungeon** with those items in your bag — equip and use them mid-run as before
3. **Run ends** (all enemies dead) — surviving items stay with the raider, consumed items are gone
4. **Return to hub** — the raider's pack reflects what they came back with; adjust and go again

The stash and raider pack are two persistent containers. Items belong to one or the other at all times. There is no "return items" step — whatever the raider has when they leave the dungeon is what they come back with.

---

## Data Model

Two containers, both backed by `localStorage` so state survives page refresh:

| Container | Description |
|---|---|
| **Stash** | Items in storage at the hub. Not brought on runs. |
| **Raider's Pack** | Items currently with the raider. Persists between runs. |

Both are `[{ id: string, qty: number }]` arrays. Moving an item between containers decrements one and increments the other — total item count in the world is always conserved.

**Initial state** (seeded once into localStorage if empty): 1× each weapon/armor/shield, 2× each potion — the same list already displayed in HubScene.

**On dungeon entry**: the raider pack is flattened to a plain `string[]` and passed to the server as `options.items`. Entry behavior branches on whether the pack is empty:

- **Empty pack** — raider enters with class default weapon and armor pre-equipped, bag empty. This is the "free starter loadout" path.
- **Non-empty pack** — class defaults are not provided. All pack items go to the bag, then the server does an auto-equip pass (first weapon → weapon slot, first armor → armor slot, first shield → offhand if no two-handed weapon equipped). Consumables are auto-assigned to the first available hotbar slots. The raider is fully responsible for their own loadout.

**On run completion**: the server's `player.inventory + equipped items` are read by the client and used to overwrite the raider pack in the store. Class default gear extracted this way is treated like any other item — it enters the raider pack and counts as a custom loadout on the next run.

---

## Architecture

### New file

**`client/src/store/stash.js`**

Plain JS module (no framework). Reads/writes `localStorage`. Exposes:

```js
getStash()              // → [{id, qty}, ...]
getRaiderPack()         // → [{id, qty}, ...]
stashToRaider(id)       // move 1× item: stash → raider pack
raiderToStash(id)       // move 1× item: raider pack → stash
getRaiderPackFlat()     // → ['healing_potion', 'longsword', ...] — for server join
setRaiderPack(ids)      // overwrite raider pack from flat id array — called post-run
```

This module is the only thing that will change when Supabase is added later (see Migration section).

---

### Modified files

**`client/src/scenes/HubScene.js`**

The Stash view becomes interactive:
- Left panel (Stash): items listed with qty. Click an item → moves 1 to raider pack. Stash qty decrements; item disappears if qty reaches 0.
- Right panel (Raider's Pack): items the raider currently holds. Click an item → moves 1 back to stash.
- No drag required for this pass — click-to-move is sufficient.
- On `create(data)`: if `data.view === 'stash'` (passed by DungeonScene on return), open the stash tab automatically.

**`client/src/network/ColyseusClient.js`**

`joinDungeon(opts)` already forwards opts to the server. No change needed — caller just adds `items` to opts:

```js
joinDungeon({ class: selectedClass, items: getRaiderPackFlat() })
```

**`server/rooms/DungeonRoom.js`**

`onJoin` already sets `equippedWeaponId` and `equippedArmorId` from the class def. New: if `options.items` is a non-empty array, push each id into `player.inventory`.

```js
for (const id of (options.items ?? [])) player.inventory.push(id);
```

No server-side validation of item ownership yet (client is trusted for now). That changes when Supabase is added.

**`client/src/scenes/DungeonScene.js`**

Two exit conditions, both detected in `update()`:

**Successful extraction** — today this means all enemies are dead (`state.phase === 'complete'`). This trigger is a placeholder; future runs will have explicit extraction zones, timers, and PvP exit mechanics. The phase flag stays the hook point — what sets it will expand over time.

```js
if (!this._runEnded && room.state.phase === 'complete') {
  this._runEnded = true;
  this._onRunComplete(room);
}
```

`_onRunComplete(room)`:
1. Collect surviving items: `player.inventory` + equipped slots (weapon, offhand, armor)
2. Call `setRaiderPack(survivingIds)` to update the store
3. Show run summary overlay (see Run Summary below)

**Raider death** — when `player.alive === false`, the raider exits the dungeon with nothing. The raider pack is cleared (`setRaiderPack([])`), all items carried into the run are lost.

```js
if (!this._runEnded && player && !player.alive) {
  this._runEnded = true;
  this._onRunFailed();
}
```

`_onRunFailed()`:
1. Call `setRaiderPack([])` — raider pack wiped
2. Show run summary overlay (see Run Summary below)

---

### Run Summary Overlay

Displayed inside DungeonScene before returning to the hub. Rendered as a semi-transparent panel over the dungeon. Player must click or press any key to advance — no auto-transition.

**On death:**
```
── RUN FAILED ──────────────────────────
  Your raider was slain by [enemy type].
  All carried items were lost.

  [ Press any key to return to hub ]
```

**On extraction:**
```
── RUN COMPLETE ────────────────────────
  All enemies defeated.

  Extracting with:
  · Longsword
  · Healing Potion ×2
  · Chain Mail
  (... or "nothing" if bag is empty)

  [ Press any key to return to hub ]
```

Once the player advances, leave the Colyseus room and call `scene.start('HubScene', { view: 'stash' })`.

The `killedBy` field (enemy type string) is recorded when `player.alive` flips to false — read from the last combat log entry or tracked explicitly on the player state if needed.

---

## What the Player Experiences

```
HubScene (Stash tab)
├── Stash (left)          ← starting pool of items
│   └── click item        → moves to Raider's Pack
└── Raider's Pack (right) ← what raider will bring
    └── click item        → moves back to Stash

HubScene (Class Select tab)
└── select class + [ Enter Dungeon ]
    └── joinDungeon({ class, items: raiderPackFlat })

DungeonScene
├── raider enters with class starter gear equipped + pack items in bag
├── player equips/uses items mid-run via InventoryScene (unchanged)
└── all enemies dead → phase = 'complete'
    └── collect surviving items → setRaiderPack()
    └── scene.start('HubScene', { view: 'stash' })

HubScene (Stash tab, auto-opened)
└── raider's pack shows what survived
└── player adjusts before next run
```

---

## Build Order

| Step | File | What |
|---|---|---|
| 1 | `client/src/store/stash.js` | Create store with localStorage, seed initial items |
| 2 | `client/src/scenes/HubScene.js` | Wire stash/raider pack UI to store; click-to-move |
| 3 | `client/src/scenes/DungeonScene.js` | Phase-change detection; `_onRunComplete`; pass items on join |
| 4 | `server/rooms/DungeonRoom.js` | Populate `player.inventory` from `options.items` on join |

Steps 1 and 2 can be tested independently (hub only, no dungeon needed). Steps 3 and 4 require a full run to test.

---

## Out of Scope (This Pass)

- Hub equip slots (pre-equipping weapon/armor from hub UI) — raider pack is bag-only for now
- Item validation server-side — server trusts client item list
- Supabase persistence — localStorage only
- Raider death item recovery — death wipes the raider pack by design (items lost on death is intentional, no recovery mechanic planned)

> Note: "no mid-run pickup yet" was an out-of-scope item in the original pass.
> Mid-run pickup landed via the loot system (corpse looting, gold tracking,
> crafting materials). See `docs/loot-system-plan.md`.

---

## Future: Server-Side Migration

The `stash.js` module is designed to be a drop-in swap. When Supabase is ready:

1. Add a `stash` table: `(user_id, item_id, qty)` and a `raider_pack` table with the same shape
2. Replace `localStorage` reads/writes in `stash.js` with `async` Supabase calls
3. On dungeon join, server queries `raider_pack` for the user and validates items exist before populating inventory (prevents clients from injecting items they don't own)
4. On run end, server writes surviving items back to `raider_pack` authoritatively — client store just reflects the DB

The "in transit" gap (items consumed from stash, not yet returned if client crashes) is acceptable with localStorage. Server-side, items live in `raider_pack` throughout the run and are only modified on clean exit/death resolution.
