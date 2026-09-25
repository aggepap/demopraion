import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SignJWT } from 'jose';

import {
  signSession,
  verifySession,
  verifySessionState,
  type SessionClaims,
} from '@/cms/modules/auth/session';

// getSecret() reads this lazily (only when signing/verifying), so setting it at
// module scope — which runs before any test callback — is sufficient.
process.env.ADMIN_SESSION_SECRET = 'test-session-secret-at-least-32-chars-long';

const claims: SessionClaims = { userId: 1, email: 'a@b.c', name: 'Admin', permissions: ['*'], locale: 'en' };

describe('session JWT', () => {
  test('sign → verify round-trips the claims', async () => {
    const token = await signSession(claims);
    assert.equal(typeof token, 'string');
    assert.deepEqual(await verifySession(token), claims);
  });

  test('tampered / garbage tokens verify to null', async () => {
    const token = await signSession(claims);
    assert.equal(await verifySession(token + 'x'), null);
    assert.equal(await verifySession('garbage.token.here'), null);
  });

  test('non-string permissions are filtered out', async () => {
    const token = await signSession({ ...claims, permissions: ['cms.access', 42 as unknown as string] });
    const back = await verifySession(token);
    assert.deepEqual(back?.permissions, ['cms.access']);
  });

  test('a too-short secret throws when signing', async () => {
    const prev = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_SESSION_SECRET = 'short';
    try {
      await assert.rejects(signSession(claims), /ADMIN_SESSION_SECRET/);
    } finally {
      process.env.ADMIN_SESSION_SECRET = prev;
    }
  });
});

/**
 * The two clocks: `exp` rides the idle window and moves, `abs` is the cap from
 * sign-in and does not. Everything below is about the second one, because a cap
 * that quietly fails open turns a sliding session into a permanent one.
 */
describe('session timing', () => {
  const secret = new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET!);

  /** Hand-roll a token so `exp` and `abs` can disagree — `signSession` caps exp to abs. */
  function forge(payload: Record<string, unknown>) {
    return new SignJWT({ ...claims, ...payload })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer('cms')
      .setAudience('cms-admin')
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(secret);
  }

  test('a signed session carries an absolute cap', async () => {
    const state = await verifySessionState(await signSession(claims));
    assert.ok(state);
    assert.ok(state.absoluteExpiry > Math.floor(Date.now() / 1000));
  });

  test('a refresh inherits the ORIGINAL cap rather than starting a new one', async () => {
    // The difference between a sliding session and one that never ends.
    const original = await verifySessionState(await signSession(claims));
    assert.ok(original);
    const renewed = await verifySessionState(
      await signSession(claims, { absoluteExpiry: original.absoluteExpiry }),
    );
    assert.equal(renewed?.absoluteExpiry, original.absoluteExpiry);
  });

  test('`exp` is never allowed past the cap', async () => {
    // Asking for an hour of idle life on a session capped in ten seconds must
    // yield ten seconds, not an hour.
    const abs = Math.floor(Date.now() / 1000) + 10;
    const token = await signSession(claims, { absoluteExpiry: abs, expiresAt: abs + 3600 });
    const state = await verifySessionState(token);
    assert.ok(state);
    assert.equal(state.absoluteExpiry, abs);
  });

  test('a token whose cap has passed is refused even though `exp` has not', async () => {
    /*
     * The fail-open this guards: `abs` is a custom claim, so jose does not
     * enforce it. If the check were missing, a token forged or replayed with a
     * long `exp` would outlive the cap entirely.
     */
    const token = await forge({ abs: Math.floor(Date.now() / 1000) - 1 });
    assert.equal(await verifySessionState(token), null);
    assert.equal(await verifySession(token), null);
  });

  test('a legacy token with no cap is honoured but given one', async () => {
    // Sessions issued before this feature existed are valid; treating a missing
    // cap as "no cap" would leave every one of them permanently renewable.
    const state = await verifySessionState(await forge({}));
    assert.ok(state, 'a pre-existing session should still work');
    assert.ok(state.absoluteExpiry > Math.floor(Date.now() / 1000));
    assert.ok(state.absoluteExpiry < Math.floor(Date.now() / 1000) + 9 * 3600);
  });
});
