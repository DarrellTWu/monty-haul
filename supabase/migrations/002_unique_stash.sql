-- Monty Haul: Phase 3 #5 — atomic-safe sync via UPSERT + DELETE-NOT-IN
-- Apply via Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- What this migration does:
--   1. Defensively collapses any duplicate (player_id, item_id) rows by
--      summing quantities. No-op in dev since the per-player mutation lock
--      from Phase 3 #1 prevents duplicates from being written, but safe to
--      run. Without this step, ADD CONSTRAINT would fail on the first
--      conflicting pair.
--   2. Adds UNIQUE (player_id, item_id) to gear_stash. This unlocks an
--      idempotent UPSERT pattern (ON CONFLICT (player_id, item_id) DO UPDATE)
--      so syncStashAndMeta no longer needs DELETE-all + INSERT-all. Crash
--      between ops can no longer wipe a player's stash.
--
-- Why two indexes/constraints:
--   The original schema has PRIMARY KEY (id) — one row per acquisition. The
--   new UNIQUE on (player_id, item_id) is what lets ON CONFLICT target a
--   single canonical row per item per player. Both are kept; the PK on id
--   is fine to leave in place (UUID, no semantic meaning, harmless).

BEGIN;

-- 1. Collapse duplicates by summing quantity. Keeps the most recently
--    acquired row's metadata (acquired_via, acquired_at) on the survivor.
WITH ranked AS (
  SELECT
    id,
    player_id,
    item_id,
    quantity,
    acquired_at,
    ROW_NUMBER() OVER (
      PARTITION BY player_id, item_id
      ORDER BY acquired_at DESC, id
    ) AS rn,
    SUM(quantity) OVER (PARTITION BY player_id, item_id) AS total_qty
  FROM gear_stash
)
UPDATE gear_stash gs
SET quantity = ranked.total_qty
FROM ranked
WHERE gs.id = ranked.id
  AND ranked.rn = 1
  AND ranked.total_qty <> gs.quantity;

DELETE FROM gear_stash
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY player_id, item_id
        ORDER BY acquired_at DESC, id
      ) AS rn
    FROM gear_stash
  ) ranked
  WHERE rn > 1
);

-- 2. Now safe to add the UNIQUE constraint.
ALTER TABLE gear_stash
  ADD CONSTRAINT gear_stash_player_item_unique
  UNIQUE (player_id, item_id);

COMMIT;
