/**
 * A provider's refund webhook, and the admin refund it usually follows.
 *
 * The webhook moved the order to `refunded` on ANY refund event. Since the admin
 * can now refund part of a payment, the webhook for that partial refund flipped
 * the order to fully refunded a few seconds later — restocking every line,
 * putting gift card balances back and emailing the customer a full refund.
 *
 * The arithmetic is pure and tested in `test/core/refunds.test.ts` and
 * `test/commerce/order-admin.test.ts`. What is pinned here is the wiring, which
 * lives in DB-bound code this repo has no harness for: that the webhook asks the
 * same rule the admin route asks, and that neither repeats the other's move.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

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

const webhooks = source('src/cms/core/payments/webhooks.ts');
const payments = source('src/cms/modules/commerce/payments.ts');
const orders = source('src/cms/modules/commerce/orders.ts');

describe('a refund webhook for an order', () => {
  test('marks the order refunded only when the refund rule says nothing is left', () => {
    const body = fnBody(webhooks, 'applyToOrder');
    assert.match(body, /orderStatusAfterRefund\(/);
    assert.doesNotMatch(body, /updateOrderStatus\(result\.orderId, 'refunded'\)/, 'still refunds the order on any event');
  });

  test('reconciles the provider total with what the admin already claimed on the payment row', () => {
    const body = fnBody(payments, 'capturePaymentByRef');
    assert.match(body, /reconcileProviderRefund\(/);
    assert.match(body, /refundedTotal/);
  });

  test('passes the provider-reported total through to the payment row', () => {
    const body = fnBody(webhooks, 'applyToOrder');
    assert.match(body, /refundedTotal: outcome\.refundedTotal/);
  });
});

describe('the webhook and the admin refund do not both act', () => {
  test('both move the order to refunded only if it is not refunded already', () => {
    assert.match(fnBody(webhooks, 'applyToOrder'), /updateOrderStatus\([^)]*unlessAlready: true/);
    assert.match(fnBody(orders, 'orderRefundRoute'), /updateOrderStatus\([^)]*unlessAlready: true/);
  });

  test('a move that finds the order already there does nothing else', () => {
    const body = fnBody(orders, 'updateOrderStatus');
    assert.match(body, /unlessAlready/);
    assert.match(body, /ne\(schema\.orders\.status, status\)/);
  });
});
