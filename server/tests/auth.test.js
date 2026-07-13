// server/tests/auth.test.js
// Session-token + password-hash + route-guard tests (Sprint D).
// Run with: node server/tests/auth.test.js
//
// AUTH_TOKEN_SECRET is pinned before the module import so token values are
// deterministic-ish and the ephemeral-secret warning stays out of test output.

process.env.AUTH_TOKEN_SECRET = 'test-secret-do-not-use-in-prod';

const { issueToken, verifyToken, requireAuth } = await import('../auth/tokens.js');
const { hashPassword, verifyPassword }         = await import('../auth/passwords.js');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); passed++; }
  else      { console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); failed++; }
}

// ── Tokens ────────────────────────────────────────────────────────────────────
console.log('tokens');
{
  const token = issueToken('player-123');
  const v = verifyToken(token);
  check('issue → verify roundtrip', v?.playerId === 'player-123');

  check('expired token rejected', verifyToken(issueToken('player-123', -1000)) === null);

  // Tampered payload: swap the payload for another player but keep the signature.
  const [, sig] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ pid: 'victim', exp: Date.now() + 60000 }))
    .toString('base64url');
  check('tampered payload rejected', verifyToken(`${forgedPayload}.${sig}`) === null);

  // Tampered signature.
  const [payload] = token.split('.');
  check('tampered signature rejected', verifyToken(`${payload}.AAAA${sig.slice(4)}`) === null);

  check('garbage rejected',   verifyToken('not-a-token') === null);
  check('empty rejected',     verifyToken('') === null);
  check('undefined rejected', verifyToken(undefined) === null);
}

// ── requireAuth middleware ────────────────────────────────────────────────────
console.log('\nrequireAuth');
{
  const fakeRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json   = (b) => { res.body = b; return res; };
    return res;
  };

  {
    const res = fakeRes();
    let nextCalled = false;
    requireAuth({ headers: {}, params: { playerId: 'p1' } }, res, () => { nextCalled = true; });
    check('missing header → 401, next not called', res.statusCode === 401 && !nextCalled);
  }
  {
    const res = fakeRes();
    let nextCalled = false;
    requireAuth({ headers: { authorization: 'Bearer bogus' }, params: { playerId: 'p1' } }, res, () => { nextCalled = true; });
    check('forged token → 401', res.statusCode === 401 && !nextCalled);
  }
  {
    const res = fakeRes();
    let nextCalled = false;
    const token = issueToken('attacker');
    requireAuth({ headers: { authorization: `Bearer ${token}` }, params: { playerId: 'victim' } }, res, () => { nextCalled = true; });
    check("someone else's playerId → 403", res.statusCode === 403 && !nextCalled);
  }
  {
    const res = fakeRes();
    let nextCalled = false;
    const req = { headers: { authorization: `Bearer ${issueToken('p1')}` }, params: { playerId: 'p1' } };
    requireAuth(req, res, () => { nextCalled = true; });
    check('matching token → next called, req.auth set',
      nextCalled && req.auth?.playerId === 'p1' && res.statusCode === 200);
  }
  {
    const res = fakeRes();
    let nextCalled = false;
    const token = issueToken('p1', -1);
    requireAuth({ headers: { authorization: `Bearer ${token}` }, params: { playerId: 'p1' } }, res, () => { nextCalled = true; });
    check('expired token → 401', res.statusCode === 401 && !nextCalled);
  }
}

// ── Passwords ─────────────────────────────────────────────────────────────────
console.log('\npasswords');
{
  const hash = await hashPassword('hunter22');
  check('hash format is self-describing scrypt', hash.startsWith('scrypt:'));
  check('correct password verifies',      await verifyPassword('hunter22', hash) === true);
  check('wrong password rejected',        await verifyPassword('hunter23', hash) === false);
  check('empty password rejected',        await verifyPassword('', hash) === false);
  check('malformed stored hash rejected', await verifyPassword('hunter22', 'garbage') === false);
  check('null stored hash rejected',      await verifyPassword('hunter22', null) === false);

  const hash2 = await hashPassword('hunter22');
  check('same password → different salt/hash', hash !== hash2);
  check('second hash still verifies', await verifyPassword('hunter22', hash2) === true);
}

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
if (failed > 0) process.exit(1);
