import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normaliseCoupon } from '@/cms/modules/commerce/coupons';
import { checkStructuredSetting } from '@/cms/core/settings/structured';
import {
  CUSTOM_FIELDS_KEY,
  ECOMMERCE_COUPONS_KEY,
  ECOMMERCE_SHIPPING_KEY,
} from '@/cms/core/settings/schema';

/**
 * The three settings that hold structured JSON used to be written with no checks
 * at all — the route said so, deferring their shape to sanitisers that run on
 * read. So the database accepted anything and the admin worked only because every
 * reader coerced defensively, which is exactly the assumption that turned "3,50"
 * into free gift wrapping (F-032).
 */
const coupon = (over: Record<string, unknown> = {}) => ({
  code: 'SAVE10',
  type: 'percent',
  value: 10,
  minSubtotal: 0,
  expiresAt: '',
  usageLimit: 0,
  perCustomerLimit: 0,
  active: true,
  ...over,
});

const shipping = (over: Record<string, unknown> = {}) => ({
  method: 'flat',
  baseCharge: 3.5,
  freeThreshold: 50,
  weightTiers: [],
  zones: [],
  paymentSurcharges: [],
  pickup: { enabled: false, charge: 0, locations: [] },
  ...over,
});

const check = (key: string, value: unknown) => checkStructuredSetting(key, value)!;

describe('structured settings — keys that are not handled here', () => {
  test('an ordinary key is left to the caller', () => {
    assert.equal(checkStructuredSetting('site.name', 'Praion'), undefined);
  });
});

describe('structured settings — coupons', () => {
  test('a well-formed list is accepted', () => {
    const res = check(ECOMMERCE_COUPONS_KEY, [coupon()]);
    assert.equal(res.ok, true);
  });

  test('a percentage over 100 is refused, naming the field', () => {
    const res = check(ECOMMERCE_COUPONS_KEY, [coupon({ value: 150 })]);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.message, /value/);
    assert.match(res.message, /cannot exceed 100/i);
  });

  test('a fixed amount may exceed 100 — it is money, not a proportion', () => {
    assert.equal(check(ECOMMERCE_COUPONS_KEY, [coupon({ type: 'fixed', value: 150 })]).ok, true);
  });

  test('duplicate codes are refused, because only the first would ever apply', () => {
    // `validateCoupon` resolves with `.find()`, so a second row with the same
    // code is dead configuration that looks alive in the admin.
    const res = check(ECOMMERCE_COUPONS_KEY, [coupon(), coupon({ code: 'save10' })]);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.message, /Duplicate coupon code/i);
  });

  test('junk is refused rather than coerced into something plausible', () => {
    assert.equal(check(ECOMMERCE_COUPONS_KEY, 'SAVE10').ok, false);
    assert.equal(check(ECOMMERCE_COUPONS_KEY, [coupon({ code: '' })]).ok, false);
    assert.equal(check(ECOMMERCE_COUPONS_KEY, [coupon({ type: 'freebie' })]).ok, false);
    assert.equal(check(ECOMMERCE_COUPONS_KEY, [coupon({ value: -5 })]).ok, false);
    assert.equal(check(ECOMMERCE_COUPONS_KEY, [coupon({ expiresAt: 'soon' })]).ok, false);
    assert.equal(check(ECOMMERCE_COUPONS_KEY, [coupon({ active: 'yes' })]).ok, false);
    // An unknown key is a typo or a stale client, either way worth saying.
    assert.equal(check(ECOMMERCE_COUPONS_KEY, [coupon({ discount: 10 })]).ok, false);
  });

  test('what the schema accepts, the reader leaves alone', () => {
    // The anti-drift guard. Two descriptions of a coupon now exist — this schema
    // at the write boundary and `normaliseCoupon` at the read one — so the thing
    // worth pinning is that they agree: a value good enough to store must survive
    // the reader unchanged, or one of them is wrong.
    const stored = check(ECOMMERCE_COUPONS_KEY, [
      coupon(),
      coupon({ code: 'FIVE', type: 'fixed', value: 5, minSubtotal: 20, usageLimit: 50 }),
      coupon({ code: 'OLD', expiresAt: '2020-01-01', active: false }),
    ]);
    assert.equal(stored.ok, true);
    if (!stored.ok) return;
    for (const c of stored.value as Record<string, unknown>[]) {
      assert.deepEqual(normaliseCoupon(c), c);
    }
  });
});

describe('structured settings — shipping', () => {
  test('a well-formed config is accepted', () => {
    assert.equal(check(ECOMMERCE_SHIPPING_KEY, shipping()).ok, true);
  });

  test('nested rows are checked, which the reader never did', () => {
    // `getShippingConfig` coerces the top level and passes these arrays straight
    // through whenever they are arrays, so this is where bad data used to land in
    // the shipping calculation itself.
    assert.equal(
      check(ECOMMERCE_SHIPPING_KEY, shipping({ zones: [{ name: 'EU', charge: 5 }] })).ok,
      false,
      'a zone with no country list is refused — the calculation calls .includes() on it',
    );
    assert.equal(
      check(ECOMMERCE_SHIPPING_KEY, shipping({ zones: [{ name: '', countries: ['GR'], charge: 5 }] })).ok,
      false,
    );
    assert.equal(
      check(ECOMMERCE_SHIPPING_KEY, shipping({ weightTiers: [{ minWeight: 1 }] })).ok,
      false,
    );
    assert.equal(
      check(ECOMMERCE_SHIPPING_KEY, shipping({ paymentSurcharges: [{ charge: 2 }] })).ok,
      false,
    );
    assert.equal(
      check(ECOMMERCE_SHIPPING_KEY, shipping({ pickup: { enabled: true, charge: 0 } })).ok,
      false,
      'pickup without a locations array is refused',
    );
  });

  test('a valid zone and pickup location pass', () => {
    const res = check(
      ECOMMERCE_SHIPPING_KEY,
      shipping({
        method: 'zone',
        zones: [{ name: 'Greece', countries: ['GR'], charge: 3 }],
        pickup: { enabled: true, charge: 0, locations: [{ id: 'athens', name: 'Athens store' }] },
      }),
    );
    assert.equal(res.ok, true);
  });

  test('an unknown method or a negative charge is refused', () => {
    assert.equal(check(ECOMMERCE_SHIPPING_KEY, shipping({ method: 'teleport' })).ok, false);
    assert.equal(check(ECOMMERCE_SHIPPING_KEY, shipping({ baseCharge: -1 })).ok, false);
    assert.equal(check(ECOMMERCE_SHIPPING_KEY, 'free').ok, false);
  });
});

describe('structured settings — custom fields', () => {
  test('the stored value is what the sanitiser produced, per collection', () => {
    const res = check(CUSTOM_FIELDS_KEY, {
      product: {
        groups: [],
        fields: [
          { id: 'a1', key: 'material', kind: 'text', label: { el: 'Υλικό' } },
          // Dropped by the sanitiser: an invalid key.
          { id: 'a2', key: 'Not A Key', kind: 'text', label: { el: 'x' } },
        ],
      },
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const stored = res.value as Record<string, { fields: { key: string }[] }>;
    assert.deepEqual(
      stored.product.fields.map((f) => f.key),
      ['material'],
      'what is stored is exactly what a reader would have accepted',
    );
  });

  test('junk for one collection degrades to an empty config, not a refusal', () => {
    // Deliberately different from coupons/shipping: the sanitiser is the rule
    // here, and its documented behaviour is to drop what it cannot use.
    const res = check(CUSTOM_FIELDS_KEY, { product: 'nonsense' });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual((res.value as Record<string, unknown>).product, { groups: [], fields: [] });
  });

  test('a non-object blob is refused', () => {
    assert.equal(check(CUSTOM_FIELDS_KEY, []).ok, false);
    assert.equal(check(CUSTOM_FIELDS_KEY, 'fields').ok, false);
  });
});
