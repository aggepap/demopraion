import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_PENDING_ORDER_TTL_HOURS,
  parsePendingOrderTtlHours,
  planStaleOrderCancellations,
  type StaleOrderCandidate,
} from '@/cms/modules/commerce/stale-orders';

/**
 * Cancelling gateway orders nobody paid for.
 *
 * A customer who is sent to PayPal and closes the tab leaves an order `pending`
 * for ever. Stock is safe (a gateway order only takes stock on capture), but gift
 * card balances taken at checkout are not, so these orders need an end. Only
 * orders that were waiting on an ONLINE payment qualify: a manual/bank-transfer
 * order is legitimately pending until the money arrives, and cancelling it
 * automatically would lose a real sale.
 */

const now = new Date('2026-09-17T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

const order = (over: Partial<StaleOrderCandidate> = {}): StaleOrderCandidate => ({
  id: 1,
  status: 'pending',
  createdAt: hoursAgo(72),
  payments: [{ provider: 'stripe', status: 'pending' }],
  ...over,
});

const plan = (orders: StaleOrderCandidate[], ttlHours = 48) =>
  planStaleOrderCancellations(orders, { now, ttlHours });

describe('planStaleOrderCancellations', () => {
  test('an old pending gateway order is cancelled', () => {
    assert.deepEqual(plan([order()]), [1]);
  });

  test('a recent one is left alone', () => {
    assert.deepEqual(plan([order({ createdAt: hoursAgo(47) })]), []);
  });

  test('exactly at the limit counts as stale', () => {
    assert.deepEqual(plan([order({ createdAt: hoursAgo(48) })]), [1]);
  });

  test('a manual (bank transfer / cash) order is never cancelled', () => {
    assert.deepEqual(plan([order({ payments: [{ provider: 'manual', status: 'pending' }] })]), []);
  });

  test('an order with no payment row is left alone — nothing says it was online', () => {
    assert.deepEqual(plan([order({ payments: [] })]), []);
  });

  test('any captured or authorized payment keeps the order', () => {
    for (const status of ['captured', 'authorized'] as const) {
      const payments = [
        { provider: 'stripe', status: 'failed' as const },
        { provider: 'stripe', status },
      ];
      assert.deepEqual(plan([order({ payments })]), [], status);
    }
  });

  test('a failed gateway attempt is still stale', () => {
    assert.deepEqual(plan([order({ payments: [{ provider: 'paypal', status: 'failed' }] })]), [1]);
  });

  test('a mix of manual and gateway payments is left for a person to decide', () => {
    const payments = [
      { provider: 'stripe', status: 'failed' as const },
      { provider: 'manual', status: 'pending' as const },
    ];
    assert.deepEqual(plan([order({ payments })]), []);
  });

  test('only pending orders qualify', () => {
    for (const status of ['paid', 'fulfilled', 'cancelled', 'refunded'] as const) {
      assert.deepEqual(plan([order({ status })]), [], status);
    }
  });

  test('a TTL of zero switches the job off', () => {
    assert.deepEqual(plan([order({ createdAt: hoursAgo(10_000) })], 0), []);
  });

  test('returns every qualifying id, in input order', () => {
    const out = plan([
      order({ id: 3 }),
      order({ id: 4, createdAt: hoursAgo(1) }),
      order({ id: 5 }),
    ]);
    assert.deepEqual(out, [3, 5]);
  });
});

describe('parsePendingOrderTtlHours', () => {
  test('unset uses the default', () => {
    assert.equal(parsePendingOrderTtlHours(undefined), DEFAULT_PENDING_ORDER_TTL_HOURS);
    assert.equal(parsePendingOrderTtlHours(''), DEFAULT_PENDING_ORDER_TTL_HOURS);
  });

  test('a whole number of hours is used as given, including 0', () => {
    assert.equal(parsePendingOrderTtlHours('24'), 24);
    assert.equal(parsePendingOrderTtlHours('0'), 0);
  });

  test('garbage falls back to the default rather than to "off" or "immediately"', () => {
    for (const raw of ['abc', '-5', '1.5', null, {}]) {
      assert.equal(parsePendingOrderTtlHours(raw), DEFAULT_PENDING_ORDER_TTL_HOURS, String(raw));
    }
  });

  test('a fractional TTL is not a way to cancel within minutes', () => {
    // A customer on a 3-D Secure page must not have their order cancelled under them.
    assert.equal(parsePendingOrderTtlHours('0.1'), DEFAULT_PENDING_ORDER_TTL_HOURS);
  });
});

describe('the setting', () => {
  test('the admin edits the same key the job reads', async () => {
    const { MANAGED_SETTING_KEYS } = await import('@/cms/core/settings/schema');
    const { PENDING_ORDER_TTL_KEY } = await import('@/cms/modules/commerce/stale-orders');
    assert.ok(MANAGED_SETTING_KEYS.includes(PENDING_ORDER_TTL_KEY));
  });
});
