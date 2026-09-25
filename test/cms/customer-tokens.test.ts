import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CUSTOMER_TOKEN_TTL_SECONDS,
  hashCustomerToken,
  isTokenUsable,
  newCustomerToken,
  type CustomerTokenRow,
} from '@/cms/modules/customers/tokens';

/**
 * The one-time links: "confirm your email" and "set a new password".
 *
 * The link is the credential, so only its hash is stored — a database leak must
 * not hand someone a working password-reset link for every account. Each one is
 * single use and short-lived, and the reset link is much shorter-lived than the
 * verification link because it is the one that takes over an account.
 */

const row = (over: Partial<CustomerTokenRow> = {}): CustomerTokenRow => ({
  id: 1,
  customerId: 5,
  purpose: 'reset_password',
  tokenHash: 'x',
  expiresAt: new Date('2026-09-17T13:00:00Z'),
  usedAt: null,
  ...over,
});

const now = new Date('2026-09-17T12:00:00Z');

describe('newCustomerToken', () => {
  test('gives a long random secret and its hash', () => {
    const { token, hash } = newCustomerToken();
    assert.ok(token.length >= 32, token);
    assert.match(token, /^[A-Za-z0-9_-]+$/); // URL-safe: it goes in an email link
    assert.equal(hash, hashCustomerToken(token));
    assert.notEqual(hash, token);
  });

  test('two tokens are never the same', () => {
    const seen = new Set(Array.from({ length: 50 }, () => newCustomerToken().token));
    assert.equal(seen.size, 50);
  });

  test('hashing is stable and case-sensitive', () => {
    const { token } = newCustomerToken();
    assert.equal(hashCustomerToken(token), hashCustomerToken(token));
    assert.notEqual(hashCustomerToken(token), hashCustomerToken(token.toUpperCase()));
  });
});

describe('token lifetimes', () => {
  test('a reset link dies long before a verification link', () => {
    assert.ok(CUSTOMER_TOKEN_TTL_SECONDS.reset_password < CUSTOMER_TOKEN_TTL_SECONDS.verify_email);
    assert.equal(CUSTOMER_TOKEN_TTL_SECONDS.reset_password, 60 * 60);
    assert.equal(CUSTOMER_TOKEN_TTL_SECONDS.verify_email, 24 * 60 * 60);
  });
});

describe('isTokenUsable', () => {
  test('an unused, unexpired token is usable', () => {
    assert.equal(isTokenUsable(row(), now), true);
  });

  test('an expired token is not, even a second late', () => {
    assert.equal(isTokenUsable(row({ expiresAt: new Date(now.getTime() - 1000) }), now), false);
  });

  test('a token already used is not usable again', () => {
    assert.equal(isTokenUsable(row({ usedAt: new Date(now.getTime() - 5000) }), now), false);
  });

  test('a missing token is not usable', () => {
    assert.equal(isTokenUsable(null, now), false);
    assert.equal(isTokenUsable(undefined, now), false);
  });
});
