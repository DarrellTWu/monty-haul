// client/src/ui/ScrollViewport.js
// Shared vertical scroll helper for Phaser scenes (character sheet, bag,
// stash, raider loadout, and future panels). Replaces the previously-
// duplicated mask/offset/wheel triplets that lived in InventoryScene.
//
// Usage:
//   const vp = new ScrollViewport(scene, { x, y, w, h, step, bottomPad });
//   vp.track(gfx);                  // record baseY, apply shared mask
//   vp.untrack(gfx) / vp.clear();   // rebuild paths (preserves scrollOffset)
//   vp.handleWheel(deltaY);         // call from scene wheel listener
//   vp.contains(pointer);           // hit-test for scene wheel routing
//   vp.lockDrag(gfx) / unlockDrag(gfx); // skip during in-progress drag
//   vp.setContentHeight(h);         // optional explicit override
//   vp.setOverflowText(textGfx);    // optional indicator the helper updates
//   vp.scrollOffset                 // read-only getter
//   vp.destroy();                   // tear down mask gfx
//
// Content height is computed lazily on each handleWheel from max(baseY of
// tracked gfx) + bottomPad. Callers may override via setContentHeight when
// they know the height cheaply (bag knows row count * BAG_ITEM_H).
//
// clear() preserves scrollOffset so in-place rebuilds (e.g. bag rebuild on
// inventory change) keep the user where they were. Tab-style reset falls out
// naturally because tab teardown calls vp.destroy() and the next render
// constructs a fresh viewport at offset 0.

export class ScrollViewport {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x:number, y:number, w:number, h:number, step:number, bottomPad?:number}} opts
   */
  constructor(scene, { x, y, w, h, step, bottomPad = 8 }) {
    this.scene       = scene;
    this.x           = x;
    this.y           = y;
    this.w           = w;
    this.h           = h;
    this.step        = step;
    this.bottomPad   = bottomPad;
    this.scrollOffset = 0;

    /** @type {{gfx:Phaser.GameObjects.GameObject, baseY:number}[]} */
    this._tracked    = [];
    /** Drag-locked gfx are skipped by reposition. */
    this._dragLocked = new Set();
    /** Optional explicit content height. null = lazy max(baseY) + bottomPad. */
    this._contentH   = null;
    /** Optional overflow indicator text gfx. */
    this._overflowText = null;

    this._maskGfx = scene.make.graphics();
    this._maskGfx.fillRect(x, y, w, h);
    this._mask    = this._maskGfx.createGeometryMask();
  }

  /**
   * Apply mask + record baseY. Returns gfx for chaining.
   * If `baseY` is omitted, uses `gfx.y` at registration time — fine for
   * layouts that position gfx at their unscrolled Y. Callers that compute
   * gfx.y already accounting for current scroll (e.g. bag rebuilds at
   * actualY = baseY - scrollOffset) should pass `baseY` explicitly and call
   * `refresh()` at the end of the layout pass.
   */
  track(gfx, baseY) {
    this._tracked.push({ gfx, baseY: baseY ?? gfx.y });
    gfx.setMask(this._mask);
    return gfx;
  }

  untrack(gfx) {
    const i = this._tracked.findIndex(e => e.gfx === gfx);
    if (i >= 0) this._tracked.splice(i, 1);
    this._dragLocked.delete(gfx);
  }

  /** Bulk untrack for rebuilds. Preserves scrollOffset. */
  clear() {
    this._tracked.length = 0;
    this._dragLocked.clear();
  }

  /**
   * Optional explicit override. Pass null to revert to lazy compute.
   * Re-clamps the current scrollOffset against the new max so a shrink (e.g.
   * bag rebuild after equipping items) doesn't leave content scrolled off
   * the top.
   */
  setContentHeight(h) {
    this._contentH = h;
    this._clampOffset();
  }

  /** Optional overflow indicator. Helper updates its text + visibility. */
  setOverflowText(textGfx) {
    this._overflowText = textGfx;
  }

  /** True if pointer is inside the viewport rect. */
  contains(pointer) {
    return pointer.x >= this.x && pointer.x <= this.x + this.w
        && pointer.y >= this.y && pointer.y <= this.y + this.h;
  }

  /**
   * Mark gfx as being dragged: clears its mask so it can move outside the
   * viewport, and skips it during reposition so a wheel-mid-drag won't yank
   * it back. Pair with unlockDrag on dragend.
   */
  lockDrag(gfx) {
    this._dragLocked.add(gfx);
    gfx.clearMask();
  }

  /** Re-apply the mask and resume reposition for this gfx. */
  unlockDrag(gfx) {
    this._dragLocked.delete(gfx);
    if (this._mask) gfx.setMask(this._mask);
  }

  /**
   * Apply a wheel delta (typically Math.sign(deltaY) * step). Clamps to
   * [0, contentH - viewportH] and repositions every non-drag-locked gfx.
   */
  handleWheel(deltaY) {
    const delta     = Math.sign(deltaY) * this.step;
    const contentH  = this._computeContentH();
    const maxScroll = Math.max(0, contentH - this.h);
    const next      = Math.max(0, Math.min(this.scrollOffset + delta, maxScroll));
    if (next === this.scrollOffset && this._overflowText === null) return;
    this.scrollOffset = next;
    this._reposition();
    this._updateOverflow(contentH);
  }

  /** Force a clamp + reposition pass — call after track()ing new gfx. */
  refresh() {
    this._clampOffset();
    this._reposition();
    this._updateOverflow(this._computeContentH());
  }

  destroy() {
    if (this._maskGfx) {
      this._maskGfx.destroy();
      this._maskGfx = null;
      this._mask    = null;
    }
    this._tracked.length = 0;
    this._dragLocked.clear();
    this._overflowText = null;
  }

  // ── Private ────────────────────────────────────────────────────────────

  _clampOffset() {
    const maxScroll = Math.max(0, this._computeContentH() - this.h);
    if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;
    if (this.scrollOffset < 0)         this.scrollOffset = 0;
  }

  _computeContentH() {
    if (this._contentH !== null) return this._contentH;
    if (this._tracked.length === 0) return 0;
    let maxBase = -Infinity;
    for (const { baseY } of this._tracked) {
      if (baseY > maxBase) maxBase = baseY;
    }
    return (maxBase - this.y) + this.bottomPad;
  }

  _reposition() {
    for (const { gfx, baseY } of this._tracked) {
      if (this._dragLocked.has(gfx)) continue;
      gfx.y = baseY - this.scrollOffset;
    }
  }

  _updateOverflow(contentH) {
    if (!this._overflowText) return;
    const hiddenBelow = contentH - this.h - this.scrollOffset;
    if (hiddenBelow > 0) {
      const moreCount = Math.ceil(hiddenBelow / this.step);
      this._overflowText.setText(`↓ ${moreCount} more  (scroll)`).setVisible(true);
    } else {
      this._overflowText.setVisible(false);
    }
  }
}
