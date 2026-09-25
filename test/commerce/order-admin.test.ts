import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  giftCardAmountsUsed,
  orderStatusAfterRefund,
  refundableAmount,
} from '@/cms/modules/commerce/order-admin';
import { REFUNDED_AMOUNT_KEY } from '@/cms/core/payments/refunds';

/**
 * What the order panel is allowed to offer, decided on the server.
 *
 * The panel shows a Refund button per payment. Whether it may is not a UI
 * question: only a payment the gateway actually captured, from a provider that
 * can send money back, and with something left of it, can be refunded. The
 * number the button offers is what is LEFT — not the original capture.
 */

const online = (provider: string) => provider === 'stripe' || provider === 'paypal' || provider === 'viva';

const payment = (over: Record<string, unknown> = {}) => ({
  provider: 'stripe',
  status: 'captured',
  amount: 3000,
  metadata: null as Record<string, unknown> | null,
  ...over,
});

describe('refundableAmount', () => {
  test('a captured gateway payment can be refunded in full', () => {
    assert.equal(refundableAmount(payment(), online), 3000);
  });

  test('what was already refunded is not offered again', () => {
    assert.equal(refundableAmount(payment({ metadata: { [REFUNDED_AMOUNT_KEY]: 1000 } }), online), 2000);
    assert.equal(refundableAmount(payment({ metadata: { [REFUNDED_AMOUNT_KEY]: 3000 } }), online), 0);
  });

  test('a payment that was never captured cannot be refunded', () => {
    assert.equal(refundableAmount(payment({ status: 'pending' }), online), 0);
    assert.equal(refundableAmount(payment({ status: 'failed' }), online), 0);
  });

  test('the refund row itself is not refundable', () => {
    assert.equal(refundableAmount(payment({ status: 'refunded', amount: -1000 }), online), 0);
  });

  test('manual and gift card payments are settled outside the gateway', () => {
    assert.equal(refundableAmount(payment({ provider: 'manual' }), online), 0);
    assert.equal(refundableAmount(payment({ provider: 'giftcard' }), online), 0);
  });
});

describe('orderStatusAfterRefund', () => {
  test('a payment refunded in full moves the order to refunded', () => {
    assert.equal(orderStatusAfterRefund({ remaining: 0 }), 'refunded');
  });

  test('a partial refund leaves the order where it was', () => {
    // Marking a €30 order refunded after €5 went back would restock every item,
    // put the gift card balances back and email the customer a full refund.
    assert.equal(orderStatusAfterRefund({ remaining: 2500 }), null);
  });
});

describe('giftCardAmountsUsed', () => {
  test('lists the gift card payments on an order, with their total', () => {
    const used = giftCardAmountsUsed([
      { provider: 'giftcard', status: 'captured', amount: 1500, providerRef: 'giftcard:4' },
      { provider: 'stripe', status: 'captured', amount: 3500, providerRef: 'pi_1' },
      { provider: 'giftcard', status: 'captured', amount: 500, providerRef: 'giftcard:9' },
    ]);
    assert.deepEqual(used.cards, [
      { giftCardId: 4, amount: 1500 },
      { giftCardId: 9, amount: 500 },
    ]);
    assert.equal(used.total, 2000);
  });

  test('an order paid without a gift card uses none', () => {
    assert.deepEqual(giftCardAmountsUsed([{ provider: 'manual', status: 'pending', amount: 100, providerRef: null }]), {
      cards: [],
      total: 0,
    });
  });
});
