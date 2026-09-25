import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { signSession as signAdminSession } from '@/cms/modules/auth/session';
import {
  CUSTOMER_COOKIE_NAME,
  signCustomerToken,
  verifyCustomerToken,
  type CustomerClaims,
} from '@/cms/modules/customers/token';

/**
 * The shopper's session, which is NOT the administrator's.
 *
 * Two audiences signed with two different keys, so neither token can be
 * presented as the other. That is the whole reason customers are a separate
 * table rather than `admin_users` with a role: a mistake in one guard cannot
 * turn a shopper into staff, because the token a shopper holds does not even
 * verify on the admin side.
 *
 * `tokenVersion` is what makes a stateless token revocable: "sign out
 * everywhere" and a password change bump the customer's number, and every
 * request compares the one in the token against the one in the database.
 */

const claims: CustomerClaims = { customerId: 7, email: 'shopper@example.com', tokenVersion: 1 };

before(() => {
  process.env.ADMIN_SESSION_SECRET = 'a'.repeat(48);
});
after(() => {
  delete process.env.ADMIN_SESSION_SECRET;
});

describe('customer token', () => {
  test('round-trips its claims', async () => {
    const verified = await verifyCustomerToken(await signCustomerToken(claims));
    assert.deepEqual(verified, claims);
  });

  test('its cookie is not the admin cookie', () => {
    assert.equal(CUSTOMER_COOKIE_NAME, 'cms_customer');
    assert.notEqual(CUSTOMER_COOKIE_NAME, 'cms_session');
  });

  test('an admin session token is not a customer session', async () => {
    const adminToken = await signAdminSession({
      userId: 1,
      email: 'admin@example.com',
      name: 'Admin',
      permissions: ['*'],
      locale: 'el',
    });
    assert.equal(await verifyCustomerToken(adminToken), null);
  });

  test('a tampered or truncated token is refused', async () => {
    const token = await signCustomerToken(claims);
    assert.equal(await verifyCustomerToken(`${token}x`), null);
    assert.equal(await verifyCustomerToken(token.slice(0, -4)), null);
    assert.equal(await verifyCustomerToken(''), null);
  });

  test('a token signed under a different secret is refused', async () => {
    const token = await signCustomerToken(claims);
    process.env.ADMIN_SESSION_SECRET = 'b'.repeat(48);
    try {
      assert.equal(await verifyCustomerToken(token), null);
    } finally {
      process.env.ADMIN_SESSION_SECRET = 'a'.repeat(48);
    }
  });

  test('an expired token is refused', async () => {
    const token = await signCustomerToken(claims, { expiresAt: Math.floor(Date.now() / 1000) - 1 });
    assert.equal(await verifyCustomerToken(token), null);
  });

  test('a token missing a claim is refused rather than defaulted', async () => {
    // Guards against a future claim being added and old tokens silently
    // acquiring a `tokenVersion` of 0, which would make revocation a no-op.
    const token = await signCustomerToken({ ...claims, tokenVersion: 3 });
    const verified = await verifyCustomerToken(token);
    assert.equal(verified?.tokenVersion, 3);
  });
});
