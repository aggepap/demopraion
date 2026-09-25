/**
 * The half-authenticated state between "password accepted" and "second factor
 * accepted".
 *
 * This is the part of a 2FA flow that is easy to get subtly, catastrophically
 * wrong: whatever the browser holds between the two steps proves the password
 * step passed, and if it can be presented as a session then the second factor
 * is decorative. The challenge is therefore a separate JWT with its own
 * AUDIENCE, and the two tests that matter here are the ones asserting that
 * neither token verifies as the other.
 *
 * It is short-lived for the same reason: a token that proves a password is
 * correct is a credential, and ten minutes is as long as anyone needs to read a
 * code off a phone.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// Read lazily by both modules, so module scope is early enough — see session.test.ts.
process.env.ADMIN_SESSION_SECRET = 'test-session-secret-at-least-32-chars-long';

import {
  MFA_CHALLENGE_COOKIE_NAME,
  MFA_CHALLENGE_TTL_SECONDS,
  signMfaChallenge,
  verifyMfaChallenge,
  type MfaChallengeClaims,
} from '@/cms/modules/auth/mfa-challenge';
import { signSession, verifySession, type SessionClaims } from '@/cms/modules/auth/session';

const challenge: MfaChallengeClaims = {
  userId: 7,
  email: 'a@b.co',
  purpose: 'verify',
};

const session: SessionClaims = {
  userId: 7,
  email: 'a@b.co',
  name: 'Admin',
  permissions: ['*'],
  locale: 'el',
};

describe('MFA challenge token', () => {
  test('sign → verify round-trips the claims', async () => {
    const token = await signMfaChallenge(challenge);
    assert.deepEqual(await verifyMfaChallenge(token), challenge);
  });

  test('carries the enrollment purpose distinctly', async () => {
    const token = await signMfaChallenge({ ...challenge, purpose: 'enroll' });
    assert.equal((await verifyMfaChallenge(token))?.purpose, 'enroll');
  });

  test('tampered or garbage tokens verify to null', async () => {
    const token = await signMfaChallenge(challenge);
    assert.equal(await verifyMfaChallenge(`${token}x`), null);
    assert.equal(await verifyMfaChallenge('garbage.token.here'), null);
    assert.equal(await verifyMfaChallenge(''), null);
  });

  test('a SESSION token is not accepted as a challenge', async () => {
    /*
     * The privilege escalation this closes: without the audience split, the
     * signature is the same HS256 over the same secret, so any valid token
     * would satisfy any check that only asks "does this verify?".
     */
    const token = await signSession(session);
    assert.equal(await verifyMfaChallenge(token), null);
  });

  test('a CHALLENGE token is not accepted as a session', async () => {
    /*
     * And the direction that actually matters. A challenge is issued after the
     * PASSWORD alone; if it could be presented as `cms_session`, the second
     * factor could be skipped by moving one cookie's value into another.
     */
    const token = await signMfaChallenge(challenge);
    assert.equal(await verifySession(token), null);
  });

  test('an unknown purpose is rejected rather than passed through', async () => {
    // The shape check is the only thing standing between a hand-crafted claim
    // and a branch that trusts it; an unvalidated field is a field an attacker
    // chooses.
    const token = await signMfaChallenge({
      ...challenge,
      purpose: 'admin' as MfaChallengeClaims['purpose'],
    });
    assert.equal(await verifyMfaChallenge(token), null);
  });

  test('expires, and well inside a session lifetime', async () => {
    assert.ok(
      MFA_CHALLENGE_TTL_SECONDS > 0 && MFA_CHALLENGE_TTL_SECONDS <= 15 * 60,
      'a token proving the password is correct must be short-lived',
    );
    const expired = await signMfaChallenge(challenge, -1);
    assert.equal(await verifyMfaChallenge(expired), null);
  });

  test('uses its own cookie name, so neither can overwrite the other', () => {
    assert.equal(MFA_CHALLENGE_COOKIE_NAME, 'cms_mfa');
  });

  test('a too-short secret throws when signing', async () => {
    const prev = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_SESSION_SECRET = 'short';
    try {
      await assert.rejects(signMfaChallenge(challenge), /ADMIN_SESSION_SECRET/);
    } finally {
      process.env.ADMIN_SESSION_SECRET = prev;
    }
  });
});
