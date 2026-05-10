// server/tests/dead-letter.test.js
// Pure unit tests for the dead-letter helpers. No Supabase. No env required.
//
// Uses MH_DEAD_LETTER_PATH to redirect writes to a temp file in OS tmp dir,
// then imports the module so the override is picked up.
//
// Run: node server/tests/dead-letter.test.js
import { tmpdir } from 'os';
import { join }   from 'path';
import { unlink, writeFile } from 'fs/promises';

const TMP = join(tmpdir(), `mh-deadletter-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jsonl`);
process.env.MH_DEAD_LETTER_PATH = TMP;

const { appendDeadLetter, readDeadLetter, deadLetterCount, DEAD_LETTER_PATH }
  = await import('../persistence/deadLetter.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else      { console.log(`  FAIL  ${label}`); fail++; }
}

async function cleanup() {
  try { await unlink(TMP); } catch { /* missing is fine */ }
}

async function run() {
  console.log(`Temp file: ${TMP}\n`);
  check('module honors env override', DEAD_LETTER_PATH === TMP);

  // ── 1. missing file → empty reads ────────────────────────────────────────────
  console.log('\n1. missing file behavior');
  await cleanup();
  check('  readDeadLetter returns [] for missing file', (await readDeadLetter()).length === 0);
  check('  deadLetterCount returns 0 for missing file', (await deadLetterCount()) === 0);

  // ── 2. single append round-trips ─────────────────────────────────────────────
  console.log('\n2. single append round-trip');
  const record1 = {
    kind:     'extract',
    playerId: 'abc-123',
    payload:  { survivingItems: ['longsword'], goldEarned: 5 },
    error:    'Network error: ECONNRESET',
  };
  await appendDeadLetter(record1);
  const after1 = await readDeadLetter();
  check('  one record after append', after1.length === 1);
  check('  count == 1',              (await deadLetterCount()) === 1);
  check('  kind preserved',          after1[0]?.kind === 'extract');
  check('  playerId preserved',      after1[0]?.playerId === 'abc-123');
  check('  error preserved',         after1[0]?.error === 'Network error: ECONNRESET');
  check('  payload nested object preserved',
    JSON.stringify(after1[0]?.payload?.survivingItems) === JSON.stringify(['longsword']));
  check('  ts present',              typeof after1[0]?.ts === 'string');
  check('  ts is ISO 8601',          /^\d{4}-\d{2}-\d{2}T/.test(after1[0]?.ts ?? ''));

  // ── 3. multiple appends → multiple lines, in order ───────────────────────────
  console.log('\n3. multiple appends');
  await appendDeadLetter({ kind: 'death', playerId: 'def-456', payload: { classId: 'fighter' }, error: 'b' });
  await appendDeadLetter({ kind: 'death', playerId: 'ghi-789', payload: { classId: 'monk' },    error: 'c' });
  const after3 = await readDeadLetter();
  check('  three records total',     after3.length === 3);
  check('  count == 3',              (await deadLetterCount()) === 3);
  check('  order preserved (1st)',   after3[0]?.playerId === 'abc-123');
  check('  order preserved (2nd)',   after3[1]?.playerId === 'def-456');
  check('  order preserved (3rd)',   after3[2]?.playerId === 'ghi-789');

  // ── 4. empty file (zero bytes) is treated as zero entries ────────────────────
  console.log('\n4. empty file');
  await cleanup();
  await writeFile(TMP, '', 'utf8');
  check('  count == 0 for empty file', (await deadLetterCount()) === 0);
  check('  read returns [] for empty file', (await readDeadLetter()).length === 0);
}

try {
  await run();
} catch (err) {
  console.error('\nUNCAUGHT ERROR:', err);
  fail++;
} finally {
  await cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
