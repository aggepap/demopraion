/**
 * The order emails printed subtotal, discount, shipping, surcharge and total —
 * but no gift-wrap line, so when gift wrap was charged the lines did not add up
 * to the total the customer paid.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { computeOrderTotals, orderSummaryLines } from '@/cms/modules/commerce/totals';

describe('orderSummaryLines', () => {
  test('includes gift wrap, and the lines add up to the total', () => {
    const costs = { discount: 500, shipping: 350, surcharge: 200, giftWrap: 300 };
    const subtotal = 10_000;
    const { total } = computeOrderTotals({ subtotal, ...costs });
    const lines = orderSummaryLines({ subtotal, total, costs });

    assert.deepEqual(
      lines.map((l) => l.key),
      ['subtotal', 'discount', 'shipping', 'surcharge', 'giftWrap', 'total'],
    );
    const sum = lines.filter((l) => l.key !== 'total').reduce((s, l) => s + l.cents, 0);
    assert.equal(sum, total);
    assert.equal(lines.at(-1)?.cents, total);
  });

  test('leaves out the charges that are zero or missing', () => {
    const lines = orderSummaryLines({ subtotal: 1000, total: 1000, costs: { giftWrap: 0 } });
    assert.deepEqual(lines.map((l) => l.key), ['subtotal', 'total']);
  });
});

test('the order email uses the summary lines and labels gift wrap in both languages', () => {
  const orders = readFileSync(new URL('../../src/cms/modules/commerce/orders.ts', import.meta.url), 'utf8');
  assert.match(orders, /orderSummaryLines\(/);
  assert.equal((orders.match(/giftWrap: '/g) ?? []).length, 2);
});
