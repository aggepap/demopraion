import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  normalizeCountry,
  quoteMethods,
  trackingUrlFor,
  type ShippingMethodRow,
  type ShippingZoneRow,
} from '@/cms/modules/commerce/shipping-methods';

/**
 * Letting the customer choose HOW their order arrives.
 *
 * Until now a site had one shipping calculation and the customer took what they
 * were given. The rules that matter here are the ones a shop loses money on:
 * free shipping above a threshold, the cash-on-delivery surcharge, and a locker
 * method that cannot be chosen without choosing a locker.
 */

const zone = (over: Partial<ShippingZoneRow> = {}): ShippingZoneRow => ({
  id: 1,
  name: 'Greece',
  countries: ['GR'],
  sort: 0,
  ...over,
});

const method = (over: Partial<ShippingMethodRow> = {}): ShippingMethodRow => ({
  id: 1,
  zoneId: 1,
  name: 'ACS',
  courier: 'acs',
  kind: 'address',
  cost: 350,
  freeThreshold: null,
  etaMinDays: 1,
  etaMaxDays: 3,
  codAllowed: true,
  active: true,
  sort: 0,
  pickupLocationId: null,
  ...over,
});

const ctx = {
  country: 'GR',
  subtotalCents: 2000,
  totalWeight: 1,
  paymentProvider: 'stripe',
};

describe('quoteMethods', () => {
  test('offers the methods of the matching zone', () => {
    const out = quoteMethods([method()], [zone()], ctx);
    assert.deepEqual(
      out.map((m) => m.id),
      [1]
    );
    assert.equal(out[0].cost, 350);
  });

  test('offers nothing for a country no zone covers', () => {
    assert.deepEqual(quoteMethods([method()], [zone()], { ...ctx, country: 'DE' }), []);
  });

  test('an inactive method is not offered', () => {
    assert.deepEqual(quoteMethods([method({ active: false })], [zone()], ctx), []);
  });

  test('free above the threshold, charged below it', () => {
    const free = method({ freeThreshold: 3000 });
    assert.equal(quoteMethods([free], [zone()], { ...ctx, subtotalCents: 2999 })[0].cost, 350);
    assert.equal(quoteMethods([free], [zone()], { ...ctx, subtotalCents: 3000 })[0].cost, 0);
  });

  test('the free threshold is a discount on shipping, never on the surcharge', () => {
    // Cash on delivery costs the shop the same whatever the basket is worth.
    const out = quoteMethods([method({ freeThreshold: 1000 })], [zone()], {
      ...ctx,
      paymentProvider: 'manual',
      surcharges: { manual: 200 },
    });
    assert.equal(out[0].cost, 0);
    assert.equal(out[0].surcharge, 200);
    assert.equal(out[0].total, 200);
  });

  test('the surcharge follows the payment method, not the courier', () => {
    const out = quoteMethods([method()], [zone()], { ...ctx, surcharges: { manual: 200 } });
    assert.equal(out[0].surcharge, 0, 'paying by card costs no cash-on-delivery fee');
  });

  test('a method that refuses cash on delivery disappears when that is how they pay', () => {
    const out = quoteMethods([method({ codAllowed: false })], [zone()], {
      ...ctx,
      paymentProvider: 'manual',
      codSelected: true,
    });
    assert.deepEqual(out, []);
  });

  test('weight tiers add to the base cost', () => {
    const heavy = method({
      weightTiers: [
        { minWeight: 2, charge: 150 },
        { minWeight: 5, charge: 400 },
      ],
    });
    assert.equal(quoteMethods([heavy], [zone()], { ...ctx, totalWeight: 1 })[0].cost, 350);
    assert.equal(quoteMethods([heavy], [zone()], { ...ctx, totalWeight: 3 })[0].cost, 500);
    assert.equal(quoteMethods([heavy], [zone()], { ...ctx, totalWeight: 9 })[0].cost, 750);
  });

  test('an all-digital order is offered nothing to ship', () => {
    assert.deepEqual(quoteMethods([method()], [zone()], { ...ctx, allVirtual: true }), []);
  });

  test('methods come back in the order the shop arranged them', () => {
    const out = quoteMethods(
      [method({ id: 1, sort: 2, name: 'B' }), method({ id: 2, sort: 1, name: 'A' })],
      [zone()],
      ctx
    );
    assert.deepEqual(
      out.map((m) => m.id),
      [2, 1]
    );
  });

  test('a country is matched however it was typed', () => {
    const out = quoteMethods([method()], [zone({ countries: ['gr'] })], { ...ctx, country: 'GR' });
    assert.equal(out.length, 1);
  });
});

describe('normalizeCountry', () => {
  test('accepts an ISO code as it is', () => {
    assert.equal(normalizeCountry('GR'), 'GR');
    assert.equal(normalizeCountry('gr'), 'GR');
  });

  test('understands what people actually typed before this existed', () => {
    // Orders placed when the field was free text.
    assert.equal(normalizeCountry('Greece'), 'GR');
    assert.equal(normalizeCountry('Ελλάδα'), 'GR');
    assert.equal(normalizeCountry('ΕΛΛΑΔΑ'), 'GR');
    assert.equal(normalizeCountry('Cyprus'), 'CY');
  });

  test('gives up rather than guessing', () => {
    assert.equal(normalizeCountry('somewhere else'), null);
    assert.equal(normalizeCountry(''), null);
  });
});

describe('trackingUrlFor', () => {
  test('builds the courier’s own tracking link', () => {
    assert.match(trackingUrlFor('acs', '1234567890') ?? '', /1234567890/);
    assert.match(trackingUrlFor('speedex', 'ABC') ?? '', /ABC/);
  });

  test('a courier with no template has no link', () => {
    assert.equal(trackingUrlFor('custom', '123'), null);
  });

  test('a voucher number is escaped into the URL', () => {
    const url = trackingUrlFor('acs', 'a b&c') ?? '';
    assert.doesNotMatch(url, /a b&c/);
    assert.match(url, /a%20b%26c/);
  });
});
