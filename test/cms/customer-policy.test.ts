import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  anonymisedCustomer,
  applyDefaultAddressFlags,
  buildCustomerExport,
  canClaimGuestOrders,
  normalizeCustomerEmail,
  publicCustomer,
  type CustomerAddressRow,
  type CustomerRow,
} from '@/cms/modules/customers/policy';

/**
 * The rules a customer account is made of, with no database in sight.
 */

const customer = (over: Partial<CustomerRow> = {}): CustomerRow => ({
  id: 3,
  email: 'shopper@example.com',
  name: 'A Shopper',
  phone: '+302100000000',
  locale: 'el',
  passwordHash: '$2a$12$notarealhash',
  emailVerifiedAt: new Date('2026-09-01T00:00:00Z'),
  status: 'active',
  tokenVersion: 2,
  marketingOptIn: false,
  lastLoginAt: null,
  deletedAt: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

describe('normalizeCustomerEmail', () => {
  test('lowercases and trims, so one person is one account', () => {
    assert.equal(normalizeCustomerEmail('  Shopper@Example.COM '), 'shopper@example.com');
  });

  test('leaves the local part otherwise alone', () => {
    // No dot-stripping or plus-stripping: `a.b@gmail.com` is Gmail's business,
    // and deciding two addresses are "the same" would merge two real people.
    assert.equal(normalizeCustomerEmail('a.b+shop@gmail.com'), 'a.b+shop@gmail.com');
  });
});

describe('canClaimGuestOrders', () => {
  test('a verified, active customer may claim their guest orders', () => {
    assert.equal(canClaimGuestOrders(customer()), true);
  });

  test('an unverified one may not — anyone can type someone else’s address', () => {
    assert.equal(canClaimGuestOrders(customer({ emailVerifiedAt: null })), false);
  });

  test('a disabled or deleted account claims nothing', () => {
    assert.equal(canClaimGuestOrders(customer({ status: 'disabled' })), false);
    assert.equal(canClaimGuestOrders(customer({ deletedAt: new Date() })), false);
  });
});

describe('publicCustomer', () => {
  test('never carries the password hash or the revocation counter', () => {
    const out = publicCustomer(customer()) as unknown as Record<string, unknown>;
    for (const key of ['passwordHash', 'tokenVersion', 'deletedAt']) {
      assert.equal(key in out, false, key);
    }
  });

  test('carries what the account screens need', () => {
    const out = publicCustomer(customer());
    assert.equal(out.email, 'shopper@example.com');
    assert.equal(out.name, 'A Shopper');
    assert.equal(out.emailVerified, true);
    assert.equal(publicCustomer(customer({ emailVerifiedAt: null })).emailVerified, false);
  });
});

describe('applyDefaultAddressFlags', () => {
  const addr = (over: Partial<CustomerAddressRow> = {}): CustomerAddressRow => ({
    id: 1,
    customerId: 3,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    label: 'Home',
    name: 'A Shopper',
    phone: null,
    address1: 'Street 1',
    address2: null,
    city: 'Loutraki',
    postal: '20300',
    country: 'GR',
    isDefaultShipping: false,
    isDefaultBilling: false,
    ...over,
  });

  test('a new default takes the flag off every other address', () => {
    const out = applyDefaultAddressFlags(
      [addr({ id: 1, isDefaultShipping: true }), addr({ id: 2 })],
      2,
      { shipping: true }
    );
    assert.deepEqual(
      out.map((a) => [a.id, a.isDefaultShipping]),
      [
        [1, false],
        [2, true],
      ]
    );
  });

  test('shipping and billing defaults are independent', () => {
    const out = applyDefaultAddressFlags(
      [addr({ id: 1, isDefaultShipping: true, isDefaultBilling: true }), addr({ id: 2 })],
      2,
      { shipping: true }
    );
    assert.equal(out.find((a) => a.id === 1)?.isDefaultBilling, true);
  });

  test('the first address of all becomes the default for both', () => {
    // Otherwise a customer with exactly one address has no default, and
    // checkout has nothing to prefill.
    const out = applyDefaultAddressFlags([addr({ id: 9 })], 9, {});
    assert.deepEqual([out[0].isDefaultShipping, out[0].isDefaultBilling], [true, true]);
  });

  test('leaves the existing default alone when nothing was asked', () => {
    const out = applyDefaultAddressFlags(
      [addr({ id: 1, isDefaultShipping: true }), addr({ id: 2 })],
      2,
      {}
    );
    assert.equal(out.find((a) => a.id === 1)?.isDefaultShipping, true);
    assert.equal(out.find((a) => a.id === 2)?.isDefaultShipping, false);
  });
});

describe('buildCustomerExport', () => {
  const orders = [
    {
      reference: 'ORD-2026-AAA',
      createdAt: new Date('2026-09-10T00:00:00Z'),
      total: 1234,
      currency: 'EUR',
      status: 'paid',
    },
  ];

  test('is the customer’s own data, and says when it was made', () => {
    const out = buildCustomerExport(customer(), [], orders, new Date('2026-09-17T12:00:00Z'));
    assert.equal(out.account.email, 'shopper@example.com');
    assert.equal(out.exportedAt, '2026-09-17T12:00:00.000Z');
    assert.equal(out.orders.length, 1);
    assert.equal(out.orders[0].reference, 'ORD-2026-AAA');
  });

  test('carries no password hash anywhere in it', () => {
    const out = buildCustomerExport(customer(), [], orders, new Date());
    assert.equal(JSON.stringify(out).includes('$2a$12$'), false);
  });
});

describe('anonymisedCustomer', () => {
  const at = new Date('2026-09-17T12:00:00Z');

  test('keeps the row but removes the person', () => {
    const out = anonymisedCustomer(customer(), at);
    assert.equal(out.name, null);
    assert.equal(out.phone, null);
    assert.equal(out.passwordHash, null);
    assert.equal(out.deletedAt.toISOString(), at.toISOString());
    assert.equal(out.status, 'disabled');
  });

  test('the email is replaced by something that can never be signed into', () => {
    const out = anonymisedCustomer(customer(), at);
    assert.notEqual(out.email, 'shopper@example.com');
    assert.match(out.email, /^deleted\+/);
    // Unique, so a second deletion cannot collide on the unique index.
    assert.notEqual(anonymisedCustomer(customer({ id: 4 }), at).email, out.email);
  });

  test('bumps the token version, so any open session dies', () => {
    assert.equal(anonymisedCustomer(customer({ tokenVersion: 2 }), at).tokenVersion, 3);
  });
});

describe('address limits', () => {
  test('a customer may keep a sensible number of addresses, not unlimited', async () => {
    const { MAX_CUSTOMER_ADDRESSES, canAddAddress } =
      await import('@/cms/modules/customers/policy');
    assert.equal(canAddAddress(0), true);
    assert.equal(canAddAddress(MAX_CUSTOMER_ADDRESSES - 1), true);
    // Without a cap, an authenticated endpoint is an open invitation to fill
    // the table one row at a time.
    assert.equal(canAddAddress(MAX_CUSTOMER_ADDRESSES), false);
    assert.equal(canAddAddress(MAX_CUSTOMER_ADDRESSES + 5), false);
  });
});
