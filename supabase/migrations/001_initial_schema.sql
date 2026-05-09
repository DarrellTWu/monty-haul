-- Monty Haul: Phase 2 server persistence schema
-- Apply via Supabase Dashboard → SQL Editor → New query → paste → Run

-- Player identity (no auth.users dependency yet — username-only for now)
CREATE TABLE player_profiles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username     TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Persistent stash (items that survive in the hub)
CREATE TABLE gear_stash (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    UUID NOT NULL REFERENCES player_profiles,
  item_id      TEXT NOT NULL,
  quantity     INT  NOT NULL DEFAULT 1,
  acquired_via TEXT NOT NULL DEFAULT 'extract', -- 'extract' | 'buy' | 'craft' | 'sell_refund'
  acquired_at  TIMESTAMPTZ DEFAULT now()
);

-- Hub gold and raider pack (items staged for next run)
CREATE TABLE meta_progression (
  player_id    UUID PRIMARY KEY REFERENCES player_profiles,
  gold         INT  NOT NULL DEFAULT 0,
  raider_pack  JSONB NOT NULL DEFAULT '[]', -- [{ id, qty }]
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- One row per completed or abandoned run
CREATE TABLE run_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID NOT NULL REFERENCES player_profiles,
  class           TEXT NOT NULL,
  floors_reached  INT  NOT NULL DEFAULT 1,
  extracted       BOOLEAN NOT NULL DEFAULT false,
  gold_extracted  INT  NOT NULL DEFAULT 0,
  items_extracted JSONB NOT NULL DEFAULT '[]', -- [{ id, qty }]
  kills           INT  NOT NULL DEFAULT 0,
  run_duration_s  INT,
  completed_at    TIMESTAMPTZ DEFAULT now()
);
