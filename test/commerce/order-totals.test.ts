import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeOrderTotals } from '@/cms/modules/commerce/totals';

/**
 * The order total, in one place.
 *
 * `createOrder` and the admin `saveOrder` each wrote
 * `max(0, subtotal − discount + shipping + surcharge + giftWrap)` inline. The
 * first group of tests pins exactly that formula before either caller moves onto
 * this function. The second adds what gift cards need: an amount already paid
 * by other means (a "tender"), which reduces what the gateway is asked for but
 * never the order total the merchant sees.
 */

const base = { subtotal: 10_000, discount: 0, shipping: 0, surcharge: 0, giftWrap: 0 };

describe('computeOrderTotals — the existing formula', () => {
  test('subtotal alone', () => {
    assert.equal(computeOrderTotals(base).total, 10_000);
  });

  test('every cost adds, the discount subtracts', () => {
    const t = computeOrderTotals({
      subtotal: 10_000,
      discount: 1_500,
      shipping: 450,
      surcharge: 200,
      giftWrap: 350,
    });
    assert.equal(t.total, 10_000 - 1_500 + 450 + 200 + 350);
  });

  test('a discount larger than everything clamps to zero', () => {
    assert.equal(computeOrderTotals({ ...base, discount: 20_000, shipping: 500 }).total, 0);
  });

  test('without tenders the whole total is due', () => {
    const t = computeOrderTotals({ ...base, shipping: 500 });
    assert.equal(t.amountDue, t.total);
    assert.equal(t.tendered, 0);
  });
});

describe('computeOrderTotals — tenders', () => {
  test('a partial tender reduces the amount due, not the total', () => {
    const t = computeOrderTotals({ ...base, tenders: [2_500] });
    assert.deepEqual(t, { total: 10_000, tendered: 2_500, amountDue: 7_500 });
  });

  test('several tenders are applied in order', () => {
    const t = computeOrderTotals({ ...base, tenders: [2_500, 1_000] });
    assert.deepEqual(t, { total: 10_000, tendered: 3_500, amountDue: 6_500 });
  });

  test('tenders never cover more than the total', () => {
    const t = computeOrderTotals({ ...base, tenders: [8_000, 8_000] });
    assert.deepEqual(t, { total: 10_000, tendered: 10_000, amountDue: 0 });
  });

  test('a tender on a zero total takes nothing', () => {
    const t = computeOrderTotals({ ...base, discount: 10_000, tenders: [500] });
    assert.deepEqual(t, { total: 0, tendered: 0, amountDue: 0 });
  });

  test('negative, fractional or non-finite tenders are refused', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => computeOrderTotals({ ...base, tenders: [bad] }), RangeError, String(bad));
    }
  });

  test('non-integer money anywhere is refused', () => {
    // Everything here is minor units; a fraction means a caller forgot to convert.
    assert.throws(() => computeOrderTotals({ ...base, shipping: 4.5 }), RangeError);
    assert.throws(() => computeOrderTotals({ ...base, subtotal: -1 }), RangeError);
  });
});
