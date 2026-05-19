---
status: in-progress
updated: 2026-05-18
purpose: Sprint plan — extract a shared ScrollViewport helper so character sheet, bag, stash, and crawler inventory (and future panels) all scroll consistently instead of each reinventing the mask/offset/wheel triplet.
---

# ScrollViewport Helper

## 1. Why now

Two scroll implementations already live in `client/src/scenes/InventoryScene.js`:

- **Bag scroll** — `_bagBtns` with relative `logicalY`, separate `_dropBtns` list, mask, overflow hint, no drag interop.
- **Character left-column scroll** — `_leftCol` with absolute `baseY`, mask, drag interop (mask clear/restore in `_makeDraggable`), no overflow hint.

They do the same job with different vocabulary and slightly different bugs. Two upcoming surfaces — **Stash** (hub left panel; currently fits the viewport but will overflow as item sections grow) and **crawler inventory** (the in-run inventory surface; see §2 for the scope question) — will each want the same machinery. Rule-of-three is firmly met; the moment to extract is now, before two more bespoke implementations land.

Skipping the previously-considered "consistency prep" pass on the existing two scrolls — aligning them toward each other just to throw both shapes away when the helper lands is wasted motion.

## 2. Scope clarification needed

"Crawler inventory" was named alongside Stash as a fourth scroll consumer. The current build has exactly one inventory surface (`InventoryScene.js`, opened with I). Before phase 3 starts, confirm one of:

- **A** — "crawler inventory" === existing `InventoryScene` bag, already covered.
- **B** — "crawler inventory" is a new in-dungeon quick-access inventory panel (separate from the I-key sheet) that does not exist yet.

If B, the helper must be sized against four consumers (bag, left-col, stash, quick-inv); design unchanged but porting plan grows. If A, the four consumers collapse to three (bag, left-col, stash).

## 3. What ships

A small standalone module `client/src/ui/ScrollViewport.js` (~60-80 lines) with this API:

```js
const vp = new ScrollViewport(scene, { x, y, w, h, step });
vp.track(gfx);                  // records baseY = gfx.y, applies the shared mask
vp.untrack(gfx);                // for rebuild cycles (bag rebuilds on inventory change)
vp.clear();                     // bulk untrack — for rebuilds
vp.setContentHeight(h);          // explicit, OR compute from max(baseY + ~rowH) on demand
vp.handleWheel(deltaY);          // clamps to [0, contentH - viewportH], repositions
vp.contains(pointer);            // for the scene's single wheel listener to route
vp.setOverflowText(textGfx);     // optional indicator gfx the helper updates
vp.lockDrag(gfx) / unlockDrag(gfx); // drag-in-progress carve-out (see §6 risk)
vp.destroy();                    // teardown mask + gfx; called on scene shutdown
```

Constructor builds the mask from `(x, y, w, h)`. `step` is the per-wheel-tick scroll delta (left-col uses 16; bag uses `BAG_ITEM_H = 28`).

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

`client/src/ui/hub/StashPanel.js` (81 lines today, no scroll). Two design questions for the consumer:

- Stash sections (`STASH_SECTIONS` iterate) — does each section scroll independently or does the whole left panel scroll as one column? Default: one column, simpler.
- Coexistence with `scene._l(obj)` tracking in `HubScene` (used for tab teardown). Stash rows need *both*: `scene._l(...)` so the tab switcher can destroy them, *and* `vp.track(...)` so they scroll. Either chain them (`vp.track(scene._l(...))`) or extend `scene._l` to also call `vp.track` when a viewport is active.

1. Add `ScrollViewport` to the hub left-panel viewport rect.
2. Wrap each `scene.add.text(...)` row in both trackers.
3. Wire wheel handler in `HubScene` (or extend the existing one if any).
4. **Verify**: stash with enough items to overflow scrolls; tab switch to Shop/Craft/Raider tears down rows cleanly (no orphaned masked gfx).

### Phase 4 — Build crawler inventory on it (if scope B; skip if scope A)

Pending §2 clarification. If a new surface ships in this sprint, build it directly on the helper. If it's a future feature, drop a `// TODO(deferred): scroll-viewport ready — see docs/scroll-viewport-sprint-plan.md` note where the surface will land.

### Phase 5 — Port the bag scroll last

Why last: heterogeneous tracked rows (`{btn, blockedText}` linkage, separate `_dropBtns` list, `logicalY` relative to `_bagStartY`), rebuilds on every inventory change. Hits the most edge cases. By now the helper has shipped to ~3 consumers — if its API doesn't survive the bag, a small revision here is cheap.

1. Rebuild path: `_rebuildBag` calls `this._bagVp.clear()` then `this._bagVp.track(...)` per row gfx (btn + blockedText + drop button each tracked separately).
2. Replace `_bagScrollOffset`, `_scrollBag`, `_bagMask*`, `_bagViewport*`, `_bagOverflowText` with `this._bagVp = new ScrollViewport(...)` + `vp.setOverflowText(...)`.
3. **Verify**: bag with many items scrolls; equipping/unequipping triggers rebuild without leaking masked gfx; drop buttons scroll in lockstep with rows; overflow hint text updates.

### Phase 6 — Cleanup

1. Remove any dead helpers left behind in `InventoryScene.js` / `HubScene.js`.
2. Update `docs/PROJECT_STRUCTURE.md` to list `client/src/ui/ScrollViewport.js`.
3. Flip this doc's `status` to `shipped`, move to `docs/archive/`.

## 6. Risks

- **Scroll-during-drag** (existing bug in left col): `_scrollLeftCol` blindly repositions every tracked gfx, including the one being dragged. `lockDrag`/`unlockDrag` carve-out fixes this in the helper. Don't ship the helper without this — porting forward a known bug is worse than the current state.
- **Mask GFX lifecycle**: `this.make.graphics()` is not on the display list and won't auto-clean on scene shutdown. Helper's `destroy()` must explicitly call `maskGfx.destroy()`. Scene shutdown must call `vp.destroy()`. Existing bag/left-col code leaks this today — fixing it as part of the helper is a small win.
- **Heterogeneous bag rows**: each row holds `btn` + `blockedText` + optional `dropBtn`. Helper API treats every tracked gfx independently, so this maps cleanly — but rebuild logic (currently in `_rebuildBag`) still owns the row-grouping bookkeeping. Don't try to push row-grouping into the helper.
- **`scene._l(obj)` in HubScene** is teardown tracking, not scroll tracking. Don't conflate. Stash rows need both.
- **Content height calculation**: helpers that compute `max(baseY) + rowH` will be wrong if the caller hasn't finished `track()`-ing when scroll first fires. Either require explicit `setContentHeight()` at end of layout, or recompute on each `handleWheel`. Pick one and document.

## 7. Tests

Pure-logic shared tests don't cover Phaser scenes. Manual test matrix per phase is the verification path. After phase 5, run the full manual matrix once end-to-end:

- Single-class fighter / barbarian / monk inventory — no scroll on left col.
- 2-3 class multiclass inventory — left col scrolls.
- Drag Rage/Second Wind with column scrolled; wheel mid-drag.
- Bag overflowing — scroll, equip/unequip during scroll.
- Stash overflow — scroll, click row to move to pack with column scrolled.
- Tab switch with stash scrolled — no orphaned gfx, scroll resets correctly.
- Loot-mode inventory (left col replaced by loot panel) — wheel on left does nothing.

## 8. Out-of-band followups (not blocking)

- Scrollbar thumb / track UI — defer; revisit when surfaces grow further.
- Keyboard scroll — defer; user feedback will say if it's needed.
- Overflow indicator UX polish (currently bag-only blank-when-empty pattern) — fold into the `setOverflowText` API when it ships.
