// server/auth/tokens.js
// Server-issued session tokens: HMAC-SHA256 over a base64url JSON payload.
//
// Chosen over Supabase Auth for Sprint D (roadmap allowed either): magic-link
// needs an email provider and anonymous sign-in needs dashboard config + the
// anon key in the client — this keeps the closed-playtest username/password
// UX self-contained. Trade-off accepted: no refresh (7-day expiry, re-login)
// and revocation only via secret rotation. Upgrade path: swap verifyToken's
// internals for supabase.auth.getUser(jwt) without touching callsites.
//
// Token format: <payload-b64url>.<hmac-b64url>, payload = { pid, exp }.
//
// Secret: AUTH_TOKEN_SECRET env var. Unset (local dev) → ephemeral random
// secret with a loud warning: tokens survive until the process restarts,
// then clients transparently land back on the login screen.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let SECRET = process.env.AUTH_TOKEN_SECRET;
if (!SECRET) {
  SECRET = randomBytes(32).toString('base64url');
  console.warn('[auth] AUTH_TOKEN_SECRET not set — using an ephemeral secret. ' +
    'Sessions will not survive a server restart. Set it in server/.env (and Railway) for stable sessions.');
}

const sign = (payloadB64) =>
  createHmac('sha256', SECRET).update(payloadB64).digest('base64url');

/**
 * Issue a signed session token for `playerId`.
 * @param {string} playerId
 * @param {number} [ttlMs] — override for tests
 * @returns {string}
 */
export function issueToken(playerId, ttlMs = TOKEN_TTL_MS) {
  const payload = Buffer.from(JSON.stringify({ pid: playerId, exp: Date.now() + ttlMs }))
    .toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a token. Returns `{ playerId }` on success, null on any failure
 * (missing, malformed, bad signature, expired). Never throws.
 * @param {string} token
 * @returns {{ playerId: string } | null}
 */
export function verifyToken(token) {
  try {
    const [payloadB64, sig] = String(token ?? '').split('.');
    if (!payloadB64 || !sig) return null;
    const expected = Buffer.from(sign(payloadB64));
    const actual   = Buffer.from(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const { pid, exp } = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (typeof pid !== 'string' || typeof exp !== 'number' || Date.now() > exp) return null;
    return { playerId: pid };
  } catch {
    return null;
  }
}

/**
 * Express middleware: require a valid Bearer token; when the route carries a
 * :playerId param, the token's playerId must match it (players can only act
 * on their own account). 401 = bad/missing token, 403 = someone else's.
 */
export function requireAuth(req, res, next) {
  const header  = req.headers?.authorization ?? '';
  const token   = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (req.params?.playerId && req.params.playerId !== payload.playerId) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  req.auth = payload;
  next();
}
