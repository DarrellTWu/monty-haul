// Generic retry wrapper for async functions.
//
// Used by Supabase persistence calls (playerLoad, playerSync UPSERT/DELETE) so
// a single transient blip doesn't bubble out as a 500 to the client. Domain-
// agnostic — the file has no Supabase dependency. Callers that want to retry a
// supabase-js call should throw on `error`:
//
//   const data = await withRetry(async () => {
//     const { data, error } = await supabase.from('foo').select('*');
//     if (error) throw error;
//     return data;
//   });
//
// IMPORTANT: only wrap idempotent operations. Wrapping a bare INSERT means a
// transient post-commit network blip can produce duplicate rows on retry.
// SELECT, DELETE, and UPSERT-by-PK are safe; raw INSERT is not (without a
// UNIQUE constraint to absorb the duplicate).

const DEFAULT_ATTEMPTS      = 3;
const DEFAULT_BASE_DELAY_MS = 100;

// Default predicate: retry on transport-layer errors, but not on Postgres
// semantic errors (UNIQUE / FK / check / etc.). Postgres errors come back from
// supabase-js with a 5-digit SQLSTATE in `code`; transport blips don't.
function _defaultShouldRetry(err) {
  if (err && typeof err.code === 'string' && /^\d{5}$/.test(err.code)) return false;
  return true;
}

export async function withRetry(fn, {
  attempts    = DEFAULT_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  shouldRetry = _defaultShouldRetry,
} = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1)        break;
      if (!shouldRetry(err, i))      break;
      const delay = baseDelayMs * (2 ** i);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
