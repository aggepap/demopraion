import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  checkoutPrefill,
  planCheckoutAccount,
  type CustomerAddressRow,
} from '@/cms/modules/customers/checkout';

/**
 * Where an account meets an order.
 *
 * Two separate questions, deliberately not one: WHOSE order this is (the
 * signed-in customer, if any) and whether a new account should be made from it.
 * A signed-in customer never creates a second account, and a checkout with
 * accounts switched off ignores the request entirely — the tick is hidden in
 * the page, and a hidden checkbox is not a control.
 */

const base = {
  accountsEnabled: true,
  signedInCustomerId: null,
  createAccount: false,
  password: '',
};

describe('planCheckoutAccount', () => {
  test('a signed-in customer has their order linked, and no account is made', () => {
    assert.deepEqual(
      planCheckoutAccount({ ...base, signedInCustomerId: 7, createAccount: true, password: 'x' }),
      { action: 'link', customerId: 7 }
    );
  });

  test('a guest who asked for an account gets one', () => {
    assert.deepEqual(
      planCheckoutAccount({ ...base, createAccount: true, password: 'Sup3rGoodPass!' }),
      { action: 'create', password: 'Sup3rGoodPass!' }
    );
  });

  test('a guest who did not ask stays a guest', () => {
    assert.deepEqual(planCheckoutAccount(base), { action: 'none' });
  });

  test('asking without a password is not an account request', () => {
    assert.deepEqual(planCheckoutAccount({ ...base, createAccount: true, password: '' }), {
      action: 'none',
    });
  });

  test('with the module off, both the tick and a stale session are ignored', () => {
    assert.deepEqual(
      planCheckoutAccount({
        accountsEnabled: false,
        signedInCustomerId: 7,
        createAccount: true,
        password: 'Sup3rGoodPass!',
      }),
      { action: 'none' }
    );
  });
});

describe('checkoutPrefill', () => {
  const address = (over: Partial<CustomerAddressRow> = {}): CustomerAddressRow => ({
    id: 1,
    customerId: 3,
    label: 'Home',
    name: 'A Shopper',
    phone: '+302100000000',
    address1: 'Street 1',
    address2: null,
    city: 'Loutraki',
    postal: '20300',
    country: 'GR',
    isDefaultShipping: false,
    isDefaultBilling: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  const customer = { name: 'A Shopper', email: 'shopper@example.com', phone: null };

  test('uses the default shipping address, not simply the first one', () => {
    const out = checkoutPrefill(customer, [
      address({ id: 1, city: 'Athens' }),
      address({ id: 2, city: 'Loutraki', isDefaultShipping: true }),
    ]);
    assert.equal(out.city, 'Loutraki');
  });

  test('falls back to the only address when none is marked default', () => {
    assert.equal(checkoutPrefill(customer, [address({ city: 'Athens' })]).city, 'Athens');
  });

  test('the email is always the account’s, never the address', () => {
    const out = checkoutPrefill(customer, [address()]);
    assert.equal(out.email, 'shopper@example.com');
  });

  test('the address name and phone win over the account’s', () => {
    // The person who receives the parcel is not always the account holder.
    const out = checkoutPrefill(customer, [address({ name: 'Someone Else', phone: '+30210999' })]);
    assert.equal(out.name, 'Someone Else');
    assert.equal(out.phone, '+30210999');
  });

  test('an account with no addresses still prefills who they are', () => {
    assert.deepEqual(checkoutPrefill(customer, []), {
      name: 'A Shopper',
      email: 'shopper@example.com',
      phone: '',
      address1: '',
      city: '',
      postal: '',
      country: '',
    });
  });

  test('nulls become empty strings, because they go into form inputs', () => {
    const out = checkoutPrefill({ name: null, email: 'a@b.co', phone: null }, [
      address({ address2: null, postal: null }),
    ]);
    assert.equal(out.postal, '');
    assert.equal(typeof out.name, 'string');
  });
});
