/**
 * Which id a provider's refund call is pointed at.
 *
 * The refund paths resolved it as `metadata.captureId ?? provider_ref`. That is
 * right for PayPal (the capture) and Stripe (the intent, which is the row's own
 * ref), and wrong for Viva: the row is keyed by the Viva ORDER CODE, while Viva's
 * refund call (`DELETE /api/transactions/{id}`) takes the TRANSACTION id, which
 * the webhook records as `metadata.transactionId`. Every Viva refund from the
 * admin was sent against the order code.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { refundTargetRef } from '@/cms/core/payments/refunds';

describe('refundTargetRef', () => {
  test('Viva refunds the transaction the webhook recorded, not the order code', () => {
    assert.equal(
      refundTargetRef({ provider: 'viva', providerRef: '1234567890123456', metadata: { transactionId: 'tx-uuid' } }),
      'tx-uuid',
    );
  });

  test('Viva with no recorded transaction has nothing valid to refund against', () => {
    // Falling back to the order code would send the refund to the wrong id.
    assert.equal(refundTargetRef({ provider: 'viva', providerRef: '1234567890123456', metadata: {} }), null);
    assert.equal(refundTargetRef({ provider: 'viva', providerRef: '1234567890123456', metadata: null }), null);
  });

  test('PayPal refunds the capture, falling back to the row ref', () => {
    assert.equal(refundTargetRef({ provider: 'paypal', providerRef: 'ORDER', metadata: { captureId: 'CAP' } }), 'CAP');
    assert.equal(refundTargetRef({ provider: 'paypal', providerRef: 'ORDER', metadata: {} }), 'ORDER');
  });

  test('Stripe refunds the intent, which is the row ref', () => {
    assert.equal(refundTargetRef({ provider: 'stripe', providerRef: 'pi_123', metadata: { refundedAmount: 100 } }), 'pi_123');
  });

  test('ignores empty or non-string ids', () => {
    assert.equal(refundTargetRef({ provider: 'paypal', providerRef: 'ORDER', metadata: { captureId: '' } }), 'ORDER');
    assert.equal(refundTargetRef({ provider: 'viva', providerRef: 'X', metadata: { transactionId: 42 } }), null);
    assert.equal(refundTargetRef({ provider: 'stripe', providerRef: null, metadata: null }), null);
  });
});

test('the order refund resolves its target through refundTargetRef', () => {
  const payments = readFileSync(new URL('../../src/cms/modules/commerce/payments.ts', import.meta.url), 'utf8');
  assert.match(payments, /refundTargetRef\(/);
  assert.doesNotMatch(payments, /metadata\.captureId \? metadata\.captureId : row\.providerRef/);
});

test('a Viva reversal does not overwrite the capture transaction id the refund needs', () => {
  const webhooks = readFileSync(new URL('../../src/cms/core/payments/webhooks.ts', import.meta.url), 'utf8');
  assert.match(webhooks, /kind === 'refunded' \? \{ reversalTransactionId: transactionId \} : \{ transactionId \}/);
});
