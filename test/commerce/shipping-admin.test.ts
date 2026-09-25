import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BOXNOW_NOT_CONNECTED,
  COURIER_LABELS,
  COURIER_SECRET_DEFS,
  checkShippingMethod,
  shipmentActions,
} from '@/cms/modules/commerce/shipping-methods';

/**
 * Managing shipping methods, courier credentials and parcels from the admin.
 *
 * The API took any combination the schema allowed, including ones checkout can
 * never honour: a locker method from a courier with no lockers, a store pickup
 * pointing at a store that does not exist, "3 to 1 days".
 */

const input = (over: Record<string, unknown> = {}) => ({
  courier: 'acs',
  kind: 'address',
  etaMinDays: 1,
  etaMaxDays: 3,
  pickupLocationId: null,
  ...over,
});

describe('checkShippingMethod', () => {
  test('an ordinary courier method is fine', () => {
    assert.equal(checkShippingMethod(input(), []), null);
  });

  test('the slowest delivery cannot be quicker than the fastest', () => {
    assert.match(checkShippingMethod(input({ etaMinDays: 4, etaMaxDays: 2 }), []) ?? '', /delivery days/i);
  });

  test('a locker method has to be a courier with lockers', () => {
    assert.match(checkShippingMethod(input({ kind: 'locker', courier: 'acs' }), []) ?? '', /locker/i);
    assert.equal(checkShippingMethod(input({ kind: 'locker', courier: 'boxnow' }), []), null);
  });

  test('a store pickup has to name a pickup location that exists', () => {
    assert.match(checkShippingMethod(input({ kind: 'pickup', courier: 'pickup' }), ['athens']) ?? '', /pickup location/i);
    assert.match(
      checkShippingMethod(input({ kind: 'pickup', courier: 'pickup', pickupLocationId: 'gone' }), ['athens']) ?? '',
      /pickup location/i,
    );
    assert.equal(
      checkShippingMethod(input({ kind: 'pickup', courier: 'pickup', pickupLocationId: 'athens' }), ['athens']),
      null,
    );
  });
});

describe('courier credentials', () => {
  test('BoxNow declares a client id and a client secret', () => {
    assert.deepEqual(
      COURIER_SECRET_DEFS.map((def) => def.key),
      ['courier.boxnow.clientId', 'courier.boxnow.clientSecret'],
    );
  });

  test('the "not connected" message points at a screen that exists', () => {
    assert.match(BOXNOW_NOT_CONNECTED, /Settings → Ecommerce → Shipping → Couriers/);
    assert.doesNotMatch(BOXNOW_NOT_CONNECTED, /Integrations/);
  });
});

describe('shipmentActions', () => {
  test('a BoxNow order can have its voucher created here', () => {
    assert.deepEqual(shipmentActions('boxnow'), { createVoucher: true, trackingCouriers: ['acs', 'speedex', 'elta', 'custom'] });
  });

  test('any other order records a tracking number typed in', () => {
    assert.equal(shipmentActions('acs').createVoucher, false);
    assert.equal(shipmentActions(null).createVoucher, false);
  });

  test('every courier has a label', () => {
    for (const key of ['acs', 'speedex', 'elta', 'boxnow', 'pickup', 'custom'] as const) {
      assert.ok(COURIER_LABELS[key]);
    }
  });
});
