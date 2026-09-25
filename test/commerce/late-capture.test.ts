/**
 * A gateway capture that lands on an order that is already closed.
 *
 * `settleCapturedOrder` took the stock and marked the order `paid` with no guard.
 * The stale-order job cancels a `pending` order whose payment never arrived, and
 * restores any gift card balance it had used — so a capture that arrived after
 * that revived the cancelled order to `paid`, took the stock a second time and
 * left the gift card balance returned: the customer paid less than the total.
 * Now a capture on a cancelled or refunded order leaves it closed, takes nothing
 * off the shelf, and flags the order for a refund, which the admin panel shows.
 *
 * The same flag is written on the older path where the capture lands but the
 * stock has run out and the order is cancelled: the customer has been charged
 * for an order that will not be filled.
 *
 * No automatic refund: the settlement runs inside the webhook, a thrown refund
 * there would hold the claim with nobody told, and the payment row has only just
 * been captured. The admin refund (`refundOrderPayment`) is the safe path, and
 * the flag sends the admin to it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { CLOSED_ORDER_STATUSES, refundStillOwed } from '@/cms/modules/commerce/order-admin';

const source = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

function fnBody(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = text.slice(start + 1).search(/\n(export )?(async )?function /);
  return text.slice(start, next < 0 ? undefined : start + 1 + next);
}

describe('refundStillOwed', () => {
  const note = { at: '2026-01-01T00:00:00.000Z', reason: 'captured_after_close' as const };

  test('is owed while a flagged order still has refundable money', () => {
    assert.deepEqual(refundStillOwed({ refundRequired: note }, [{ refundable: 0 }, { refundable: 1500 }]), note);
  });

  test('is settled once nothing is left to refund', () => {
    assert.equal(refundStillOwed({ refundRequired: note }, [{ refundable: 0 }]), null);
  });

  test('is never owed on an order without the flag', () => {
    assert.equal(refundStillOwed({}, [{ refundable: 1500 }]), null);
    assert.equal(refundStillOwed(null, [{ refundable: 1500 }]), null);
  });

  test('closed statuses are cancelled and refunded', () => {
    assert.deepEqual([...CLOSED_ORDER_STATUSES].sort(), ['cancelled', 'refunded']);
  });
});

describe('settleCapturedOrder', () => {
  const webhooks = source('src/cms/core/payments/webhooks.ts');
  const body = fnBody(webhooks, 'settleCapturedOrder');

  test('takes no stock from a closed order', () => {
    assert.match(body, /decrementStockForOrder\(orderId, \{ unlessStatus: CLOSED_ORDER_STATUSES \}\)/);
  });

  test('marks the order paid only from pending', () => {
    assert.match(body, /updateOrderStatus\(orderId, 'paid', \{ onlyFrom: 'pending' \}\)/);
    assert.doesNotMatch(body, /updateOrderStatus\(orderId, 'paid'\)/);
  });

  test('flags a late capture and a stock-short capture for refund', () => {
    assert.match(body, /reason: 'captured_after_close'/);
    assert.match(body, /reason: 'stock_short'/);
    assert.match(body, /flagOrderRefundRequired\(/);
  });

  test('the stock move refuses a sale while the order is in a refused status', () => {
    const stock = source('src/cms/modules/commerce/stock.ts');
    assert.match(fnBody(stock, 'moveOrderStock'), /unlessStatus\?\.includes\(order\.status\)/);
  });

  test('the admin read says whether a refund is still owed', () => {
    const orders = source('src/cms/modules/commerce/orders.ts');
    assert.match(fnBody(orders, 'getAdminOrder'), /refundDue: refundStillOwed\(/);
  });
});

test('the admin panel shows the refund notice for both reasons', () => {
  const table = readFileSync(new URL('../../src/cms/admin/OrdersTable.tsx', import.meta.url), 'utf8');
  assert.match(table, /captured_after_close:/);
  assert.match(table, /stock_short:/);
  assert.match(table, /order\?\.refundDue \?/);
});
