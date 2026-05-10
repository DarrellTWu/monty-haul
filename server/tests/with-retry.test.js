// server/tests/with-retry.test.js
// Pure unit tests for the withRetry HOF. No Supabase. No env required.
//
// Run: node server/tests/with-retry.test.js
import { withRetry } from '../persistence/withRetry.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

function makeFlaky(failTimes, errFactory = () => new Error('flaky')) {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls <= failTimes) throw errFactory(calls);
    return 'ok';
  };
  fn.calls = () => calls;
  return fn;
}

async function run() {
  // ── 1. succeeds on first try ─────────────────────────────────────────────────
  console.log('1. succeeds on first try');
  {
    const fn  = makeFlaky(0);
    const out = await withRetry(fn);
    check('  returns the value', out === 'ok');
    check('  called exactly once', fn.calls() === 1);
  }

  // ── 2. fails twice, succeeds on third ────────────────────────────────────────
  console.log('\n2. fails twice, succeeds on third');
  {
    const fn  = makeFlaky(2);
    const out = await withRetry(fn, { baseDelayMs: 1 });
    check('  returns the value', out === 'ok');
    check('  called exactly 3 times', fn.calls() === 3);
  }

  // ── 3. fails 3 times, rethrows last error ────────────────────────────────────
  console.log('\n3. all attempts fail, last error rethrows');
  {
    const fn = makeFlaky(99, (n) => new Error(`attempt ${n}`));
    let caught = null;
    try { await withRetry(fn, { baseDelayMs: 1 }); }
    catch (e) { caught = e; }
    check('  threw', caught instanceof Error);
    check('  error is from the last attempt', caught?.message === 'attempt 3');
    check('  called exactly 3 times', fn.calls() === 3);
  }

  // ── 4. shouldRetry=false aborts after first failure ──────────────────────────
  console.log('\n4. shouldRetry returning false aborts immediately');
  {
    const fn = makeFlaky(99);
    let caught = null;
    try { await withRetry(fn, { baseDelayMs: 1, shouldRetry: () => false }); }
    catch (e) { caught = e; }
    check('  threw', caught instanceof Error);
    check('  called exactly once (no retries)', fn.calls() === 1);
  }

  // ── 5. default predicate skips Postgres semantic errors (5-digit code) ───────
  console.log('\n5. default predicate skips errors with 5-digit Postgres code');
  {
    const fn = makeFlaky(99, () => Object.assign(new Error('unique violation'), { code: '23505' }));
    let caught = null;
    try { await withRetry(fn, { baseDelayMs: 1 }); }
    catch (e) { caught = e; }
    check('  threw', caught instanceof Error);
    check('  called exactly once (Postgres errors not retried)', fn.calls() === 1);
    check('  preserves the code', caught?.code === '23505');
  }

  // ── 6. default predicate retries errors WITHOUT a 5-digit code ───────────────
  console.log('\n6. default predicate retries errors without a 5-digit code');
  {
    // String code that isn't a Postgres SQLSTATE → still transient.
    const fn = makeFlaky(2, () => Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' }));
    const out = await withRetry(fn, { baseDelayMs: 1 });
    check('  retried through to success', out === 'ok');
    check('  called exactly 3 times', fn.calls() === 3);
  }

  // ── 7. backoff timing is roughly correct ─────────────────────────────────────
  console.log('\n7. backoff delays grow exponentially');
  {
    const timestamps = [];
    const fn = async () => {
      timestamps.push(Date.now());
      if (timestamps.length < 3) throw new Error('flaky');
      return 'ok';
    };
    const start = Date.now();
    await withRetry(fn, { baseDelayMs: 50 });
    const elapsed = Date.now() - start;
    // Expect ≥50ms before attempt 2 and ≥100ms more before attempt 3 → ≥150ms total.
    // Bound generously above to allow for scheduler jitter.
    check(`  total elapsed ≥ 150ms (was ${elapsed}ms)`, elapsed >= 150);
    check(`  total elapsed < 1000ms (was ${elapsed}ms)`, elapsed < 1000);
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    check(`  gap2 (${gap2}ms) > gap1 (${gap1}ms)`, gap2 > gap1);
  }
}

try {
  await run();
} catch (err) {
  console.error('\nUNCAUGHT ERROR:', err);
  fail++;
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
