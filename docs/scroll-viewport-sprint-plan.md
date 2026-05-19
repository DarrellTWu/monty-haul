---
status: in-progress
updated: 2026-05-18
purpose: Sprint plan — extract a shared ScrollViewport helper so character sheet, bag, stash, and raider loadout (and future panels) all scroll consistently instead of each reinventing the mask/offset/wheel triplet.
---

# ScrollViewport Helper

## 1. Why now

Two scroll implementations already live in `client/src/scenes/InventoryScene.js`:

- **Bag scroll** — `_bagBtns` with relative `logicalY`, separate `_dropBtns` list, mask, overflow hint, no drag interop.
- **Character left-column scroll** — `_leftCol` with absolute `baseY`, mask, drag interop (mask clear/restore in `_makeDraggable`), no overflow hint.

They do the same job with different vocabulary and slightly different bugs. Two upcoming surfaces — **Stash** (hub left panel; currently fits the viewport but will overflow as item sections grow) and **crawler inventory** (the in-run inventory surface; see §2 for the scope question) — will each want the same machinery. Rule-of-three is firmly met; the moment to extract is now, before two more bespoke implementations land.

Skipping the previously-considered "consistency prep" pass on the existing two scrolls — aligning them toward each other just to throw both shapes away when the helper lands is wasted motion.

## 2. Confirmed consumer list

"Crawler inventory" is ambiguous between two existing surfaces — and both are real consumers:

- **In-dungeon reading** → the bag inside `InventoryScene.js`. Already covered as phase 5.
- **Hub-loadout reading** → `client/src/ui/hub/RaiderPanel.js` (116 lines, no scroll today). Added as phase 4.

Final list — four existing surfaces, no new features to build, ordered cleanest-first:

| Phase | Surface | File | Why this slot |
|---|---|---|---|
| 2 | Character left-col | `InventoryScene.js` | Cleanest, homogeneous, validates drag interop |
| 3 | Stash | `ui/hub/StashPanel.js` | Validates `scene._l` ↔ `vp.track` coexistence |
| 4 | Raider loadout | `ui/hub/RaiderPanel.js` | Same hub pattern as Stash; cheap once Stash works |
| 5 | Bag | `InventoryScene.js` | Heterogeneous rows + rebuild cycle; pressure-tests API last |

## 3. What ships

A small standalone module `client/src/ui/ScrollViewport.js` (~120-150 lines) with this API:

```js
const vp = new ScrollViewport(scene, { x, y, w, h, step, bottomPad });
vp.track(gfx);                  // records baseY = gfx.y, applies the shared mask
vp.untrack(gfx);                // for rebuild cycles (bag rebuilds on inventory change)
vp.clear();                     // bulk untrack — preserves scrollOffset (rebuild path)
vp.setContentHeight(h);          // optional override; default = lazy max(baseY) + bottomPad
vp.handleWheel(deltaY);          // clamps to [0, contentH - viewportH], repositions
vp.contains(pointer);            // for the scene's single wheel listener to route
vp.setOverflowText(textGfx);     // optional indicator gfx the helper updates
vp.lockDrag(gfx) / unlockDrag(gfx); // drag-in-progress carve-out (see §6 risk)
vp.scrollOffset;                 // read-only getter; used by drag snap-back
vp.destroy();                    // teardown mask + gfx; called on scene shutdown
```

Constructor builds the mask from `(x, y, w, h)`. `step` is the per-wheel-tick scroll delta (left-col uses 16; bag uses `BAG_ITEM_H = 28`). `bottomPad` (default ~8px) is added to the lazy-computed content height so the last row doesn't sit flush against the mask edge.

**Content height (resolves §6 risk #5):** Default behavior is lazy — on each `handleWheel`, the helper walks tracked gfx and computes `max(baseY) + bottomPad`. Callers that know their content height cheaply (bag knows `grouped.length * BAG_ITEM_H`) may call `setContentHeight()` to override. Lazy default means new consumers "just work" without remembering to call it.

**Rebuild semantics:** `clear()` preserves `scrollOffset` — bag rebuilds in place on inventory change and the user expects to stay where they were. Tab-style reset (Stash/Raider on tab switch) falls out naturally because tab teardown calls `vp.destroy()` and the next render constructs a fresh viewport at offset 0. If a future consumer needs in-place reset without destroy, add `vp.reset()` then.

Then port four call sites onto it (or three — see §2).

## 4. What is explicitly **out of scope**

- Horizontal scroll. None of the four surfaces want it.
- Click-and-drag scrollbar thumb. Wheel-only stays for now.
- Keyboard scroll (PageUp/Down, arrows). Flagged separately as a UX gap; not part of this sprint.
- Nested scrollables.
- Smooth/animated scroll. Step-based snap is fine.
- Touch / pinch. Desktop-only build.

## 5. Phases

Each phase ends in a green build. Don't batch.

### Phase 1 — Build the helper

1. Create `client/src/ui/ScrollViewport.js` implementing the §3 API.
2. No call sites yet. Verify: project still builds (`npm run dev`), no behavior change.

### Phase 2 — Port the character left-column scroll first

Why first: cleanest of the existing two, written most recently, homogeneous tracked objects, has drag interop (validates `lockDrag` / `unlockDrag`).

1. Replace `_leftCol`, `_leftScrollOffset`, `_leftMask*`, `_leftViewport*`, `_trackLeft`, `_scrollLeftCol` with one `this._leftVp = new ScrollViewport(...)`.
2. Replace `_trackLeft(gfx)` call sites with `this._leftVp.track(gfx)`.
3. Wire the wheel handler in `create()` to `if (this._leftVp.contains(pointer)) this._leftVp.handleWheel(deltaY)`.
4. In `_makeDraggable`: `drag` → `this._leftVp.lockDrag(obj)`; `dragend` → snap to `originY - this._leftVp.scrollOffset`, then `this._leftVp.unlockDrag(obj)`.
5. **Verify**: manually test single-class build (no scroll triggered), 2-class build (scroll triggered), drag Rage/Second Wind to hotbar with column scrolled, wheel during drag (scroll-during-drag bug — must be fixed by `lockDrag`).

### Phase 3 — Build Stash on it

`client/src/ui/hub/StashPanel.js` (81 lines today, no scroll). Design decisions:

- **Layout: single column scroll.** Section headers scroll with their items. Current stash content size doesn't justify sticky headers or per-section viewports; revisit if a section regularly exceeds 2x viewport.
- **Teardown coexistence:** Stash rows need both `scene._l(...)` (tab teardown) and `vp.track(...)` (scroll). Chain them at call sites — `vp.track(scene._l(scene.add.text(...)))`. Don't extend `scene._l` to call `vp.track`; the two concerns stay separate (see §6 risk #4).

1. Add `ScrollViewport` to the hub left-panel viewport rect.
2. Wrap each `scene.add.text(...)` row in both trackers.
3. Wire wheel handler in `HubScene` (or extend the existing one if any).
4. **Verify**: stash with enough items to overflow scrolls; tab switch to Shop/Craft/Raider tears down rows cleanly (no orphaned masked gfx).

### Phase 4 — Raider loadout panel

`client/src/ui/hub/RaiderPanel.js` (116 lines today, no scroll). Right-side panel, uses `RP` geometry and `scene._r(...)` teardown (not `_l`). Shape mirrors phase 3, but the rect and teardown list are different — don't blindly copy Stash's coords.

1. Add `ScrollViewport` for `RP`'s viewport rect (carve out room above the Enter Dungeon button at `RP.y + RP.h - 36`).
2. Track each pack row with both `scene._r(...)` (tab teardown) and `vp.track(...)` (scroll).
3. **Verify**: load a build with enough items to overflow the panel; scroll works; tab switch to other hub tabs tears down rows cleanly; Enter Dungeon button stays pinned below the viewport.

### Phase 5 — Port the bag scroll last

Why last: heterogeneous tracked rows (`{btn, blockedText}` linkage, separate `_dropBtns` list, `logicalY` relative to `_bagStartY`), rebuilds on every inventory change. Hits the most edge cases. By now the helper has shipped to ~3 consumers — if its API doesn't survive the bag, a small revision here is cheap.

1. Rebuild path: `_rebuildBag` calls `this._bagVp.clear()` then `this._bagVp.track(...)` per row gfx (btn + blockedText + drop button each tracked separately).
2. Replace `_bagScrollOffset`, `_scrollBag`, `_bagMask*`, `_bagViewport*`, `_bagOverflowText` with `this._bagVp = new ScrollViewport(...)` + `vp.setOverflowText(...)`.
3. **Verify**: bag with many items scrolls; equipping/unequipping triggers rebuild without leaking masked gfx; drop buttons scroll in lockstep with rows; overflow hint text updates.

### Phase 6 — Cleanup

1. Remove dead helpers from `InventoryScene.js`: methods `_trackLeft`, `_scrollLeftCol`, `_scrollBag`, `_updateOverflow`, and fields `_leftCol`, `_leftScrollOffset`, `_leftMask*`, `_leftViewport*`, `_leftContentH`, `_bagScrollOffset`, `_bagMask*`, `_bagViewport*`, `_bagOverflowText`. Confirm no remaining references before deleting.
2. Remove any analogous dead state from `HubScene.js`.
3. Update `docs/PROJECT_STRUCTURE.md` to list `client/src/ui/ScrollViewport.js`.
4. Flip this doc's `status` to `shipped`, move to `docs/archive/`.

## 6. Risks

- **Scroll-during-drag** (existing bug in left col): `_scrollLeftCol` blindly repositions every tracked gfx, including the one being dragged. `lockDrag`/`unlockDrag` carve-out fixes this in the helper. Don't ship the helper without this — porting forward a known bug is worse than the current state.
- **Mask GFX lifecycle**: `this.make.graphics()` is not on the display list and won't auto-clean on scene shutdown. Helper's `destroy()` must explicitly call `maskGfx.destroy()`. Scene shutdown must call `vp.destroy()`. Existing bag/left-col code leaks this today — fixing it as part of the helper is a small win.
- **Heterogeneous bag rows**: each row holds `btn` + `blockedText` + optional `dropBtn`. Helper API treats every tracked gfx independently, so this maps cleanly — but rebuild logic (currently in `_rebuildBag`) still owns the row-grouping bookkeeping. Don't try to push row-grouping into the helper.
- **`scene._l(obj)` in HubScene** is teardown tracking, not scroll tracking. Don't conflate. Stash rows need both.
- **Content height calculation**: resolved — lazy recompute on each `handleWheel`, with optional `setContentHeight()` override. See §3 "Content height". The lazy path is safe even if `track()` continues after first wheel, since each tick re-walks tracked gfx.

## 7. Tests

Pure-logic shared tests don't cover Phaser scenes. Manual test matrix per phase is the verification path. After phase 5, run the full manual matrix once end-to-end:

- Single-class fighter / barbarian / monk inventory — no scroll on left col.
- 2-3 class multiclass inventory — left col scrolls.
- Drag Rage/Second Wind with column scrolled; wheel mid-drag.
- Bag overflowing — scroll, equip/unequip during scroll.
- Stash overflow — scroll, click row to move to pack with column scrolled.
- Raider loadout overflow — scroll, interact with rows with column scrolled.
- Tab switch with Stash or Raider scrolled — no orphaned gfx, scroll resets correctly on re-entry.
- Loot-mode inventory (left col replaced by loot panel) — wheel on left does nothing.

## 8. Out-of-band followups (not blocking)

- Scrollbar thumb / track UI — defer; revisit when surfaces grow further.
- Keyboard scroll — defer; user feedback will say if it's needed.
- Overflow indicator UX polish (currently bag-only blank-when-empty pattern) — fold into the `setOverflowText` API when it ships.
