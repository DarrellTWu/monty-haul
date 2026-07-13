-- Sprint D: real auth (server-issued session tokens over username+password).
-- Apply via Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- password_hash format: 'scrypt:N:r:p:<salt-b64>:<hash-b64>' (see
-- server/auth/passwords.js). NULL = legacy trust-on-first-use account that
-- has not logged in since auth shipped; the first authed login sets it
-- (link-by-username migration path from roadmap Sprint D).

ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;
