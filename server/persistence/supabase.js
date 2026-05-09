// Singleton Supabase client for server-side persistence.
// Uses the service-role / secret API key — bypasses RLS. Server-only.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    'Supabase env vars missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env ' +
    '(server is started with --env-file=server/.env from npm scripts).'
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
