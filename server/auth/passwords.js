// server/auth/passwords.js
// Password hashing with node:crypto scrypt — no external deps.
//
// Stored format: 'scrypt:<N>:<r>:<p>:<salt-b64url>:<hash-b64url>'.
// Parameters ride in the string so they can be raised later without
// invalidating existing hashes (verify reads them back per-hash).

import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt);

// OWASP-recommended scrypt baseline (N=2^17 needs maxmem > default 32 MiB,
// so pass maxmem explicitly).
const N = 131072, R = 8, P = 1;
const KEY_LEN  = 32;
const SALT_LEN = 16;
const MAXMEM   = 256 * 1024 * 1024;

/** Hash a plaintext password. Returns the self-describing stored format. */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_LEN);
  const hash = await scrypt(String(password), salt, KEY_LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt:${N}:${R}:${P}:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

/**
 * Verify a plaintext password against a stored hash. Returns false (never
 * throws) on malformed/unknown stored formats so a corrupt row can't 500 the
 * login route.
 */
export async function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = String(stored ?? '').split(':');
    if (scheme !== 'scrypt') return false;
    const salt     = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual   = await scrypt(String(password), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
