// Append-only dead-letter log for failed extract/death commits (Phase 3 #6).
//
// When `playerStore.commitExtract` / `commitDeath` fail to persist after
// withRetry exhausts (i.e. a sustained Supabase outage), the cache holds the
// correct post-run state but the DB does not. If the server restarts before
// the next successful mutation reconciles, the run is silently lost. This
// module records the payload to a local JSONL file so an operator can replay
// it manually.
//
// Format: one JSON object per line.
//   { kind: 'extract' | 'death', playerId, payload, error, ts }
//
// Path: server/.deadletter.jsonl (gitignored). Override with the
// MH_DEAD_LETTER_PATH env var for tests.
//
// Recovery is operator-driven for now. Inspect the file, validate against the
// current Supabase state, and replay by hand. No auto-replay (out of scope —
// commitExtract / commitDeath are non-idempotent without an idempotency key).
import { appendFile, readFile, stat } from 'fs/promises';
import { fileURLToPath }              from 'url';
import { dirname, resolve }           from 'path';

const here         = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(here, '..', '.deadletter.jsonl');

export const DEAD_LETTER_PATH = process.env.MH_DEAD_LETTER_PATH || DEFAULT_PATH;

export async function appendDeadLetter(record, { path = DEAD_LETTER_PATH } = {}) {
  const line = JSON.stringify({ ...record, ts: new Date().toISOString() }) + '\n';
  await appendFile(path, line, 'utf8');
}

export async function readDeadLetter({ path = DEAD_LETTER_PATH } = {}) {
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export async function deadLetterCount({ path = DEAD_LETTER_PATH } = {}) {
  let info;
  try { info = await stat(path); }
  catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  if (info.size === 0) return 0;
  // File exists and is non-empty — count newlines. Cheap; no JSON parsing.
  const text = await readFile(path, 'utf8');
  return text.split('\n').filter(Boolean).length;
}
