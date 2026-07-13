-- Monty Haul: deny-all RLS ahead of first hosted deployment.
-- Apply via Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- No policies are defined, so the anon and authenticated roles can read/write
-- nothing via PostgREST. The game server uses the service-role key, which
-- bypasses RLS entirely — gameplay is unaffected.
-- Context: docs/deployment-guide.md §2; finding H4 in
-- docs/architecture-review-2026-07-07.md.

ALTER TABLE player_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gear_stash       ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_progression ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_history      ENABLE ROW LEVEL SECURITY;
