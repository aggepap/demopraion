import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  canRefundOnline,
  decodePaymentSubject,
  encodePaymentSubject,
  getPaymentProvider,
  isOnlineProvider,
  manualProvider,
  paymentProviderKeys,
  registerPaymentProvider,
  type PaymentProvider,
} from '@/cms/core/payments';
import {
  paypalOutcome,
  stripeOutcome,
  subjectFromResource,
} from '@/cms/core/payments/events';
import { approvalLink, toPayPalAmount } from '@/cms/core/payments/paypal';

/**
 * The registry and the subject round-trip. These are what let ONE webhook
 * endpoint per provider serve both modules — if a subject cannot survive the
 * trip through a gateway, an event comes back with nothing to apply it to.
 */
describe('the provider registry', () => {
  test('manual is present before anything registers', () => {
    assert.ok(paymentProviderKeys().includes('manual'));
  });

  test('importing register.ts attaches every real gateway', async () => {
    // The registration is a side-effect import because Next builds one module
    // graph per route bundle; this asserts the side effect actually happens.
    await import('@/cms/core/payments/register');
    for (const key of ['stripe', 'paypal', 'viva']) {
      assert.ok(paymentProviderKeys().includes(key), `${key} was not registered`);
      assert.equal(getPaymentProvider(key).key, key);
      assert.equal(isOnlineProvider(getPaymentProvider(key)), true);
      assert.equal(canRefundOnline(getPaymentProvider(key)), true, `${key} should support refunds`);
    }
  });

  test('an unknown key falls back to manual rather than throwing', () => {
    // Deliberate: a site whose configured provider was removed should still be
    // able to take bookings offline, not 500 on every pay page.
    assert.equal(getPaymentProvider('nope').key, 'manual');
    assert.equal(getPaymentProvider(null).key, 'manual');
    assert.equal(getPaymentProvider(undefined).key, 'manual');
  });

  test('registration is idempotent by key — last one wins', () => {
    const first: PaymentProvider = { key: 'test-x', label: 'First', async start() { return { status: 'pending' }; } };
    const second: PaymentProvider = { key: 'test-x', label: 'Second', async start() { return { status: 'pending' }; } };
    registerPaymentProvider(first);
    registerPaymentProvider(second);
    assert.equal(getPaymentProvider('test-x').label, 'Second');
    assert.equal(paymentProviderKeys().filter((k) => k === 'test-x').length, 1);
  });

  test('only manual counts as offline', () => {
    assert.equal(isOnlineProvider(manualProvider), false);
    assert.equal(isOnlineProvider({ key: 'stripe', label: 'S', async start() { return { status: 'pending' }; } }), true);
  });

  test('refundability is a capability, not an assumption', () => {
    // The admin refund button is offered from this: manual has no API to call,
    // so a bank transfer is reversed at the bank and recorded here afterwards.
    assert.equal(canRefundOnline(manualProvider), false);
    assert.equal(
      canRefundOnline({
        key: 'r',
        label: 'R',
        async start() { return { status: 'pending' }; },
        async refund() { return { status: 'refunded' }; },
      }),
      true,
    );
  });
});

describe('the payment subject round-trip', () => {
  test('encodes and decodes', () => {
    assert.equal(encodePaymentSubject('reservation', 42), 'reservation:42');
    assert.deepEqual(decodePaymentSubject('reservation:42'), { subject: 'reservation', subjectId: 42 });
    assert.deepEqual(decodePaymentSubject('order:7'), { subject: 'order', subjectId: 7 });
  });

  test('refuses anything malformed rather than guessing', () => {
    // Each of these would otherwise become a lookup against a wrong id, which
    // is worse than not handling the event at all.
    for (const bad of ['', 'order', 'order:', 'order:abc', 'order:0', 'order:-1', 'nope:1', 'order:1.5', null, undefined]) {
      assert.equal(decodePaymentSubject(bad as string), null, `expected ${JSON.stringify(bad)} to be refused`);
    }
  });
});

describe('PayPal amount formatting', () => {
  test('minor units become a two-decimal string', () => {
    assert.equal(toPayPalAmount(10000), '100.00');
    assert.equal(toPayPalAmount(1), '0.01');
    assert.equal(toPayPalAmount(123456), '1234.56');
    assert.equal(toPayPalAmount(0), '0.00');
  });
});

describe('PayPal approval link', () => {
  test('prefers payer-action, the shape the payment_source flow returns', () => {
    assert.equal(
      approvalLink({
        id: 'o1',
        links: [
          { href: 'https://x/approve', rel: 'approve' },
          { href: 'https://x/payer', rel: 'payer-action' },
        ],
      }),
      'https://x/payer',
    );
  });

  test('falls back to approve, so the older shape still works', () => {
    assert.equal(
      approvalLink({ id: 'o1', links: [{ href: 'https://x/approve', rel: 'approve' }] }),
      'https://x/approve',
    );
  });

  test('returns null when PayPal sends no usable link', () => {
    assert.equal(approvalLink({ id: 'o1', links: [{ href: 'https://x/self', rel: 'self' }] }), null);
    assert.equal(approvalLink({ id: 'o1' }), null);
  });
});

describe('Stripe events reduce to outcomes', () => {
  const meta = { subject: 'reservation', subjectId: '9', reference: 'BK-2026-ABC' };

  test('a succeeded intent captures, keyed on the intent id', () => {
    const outcome = stripeOutcome({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', metadata: meta, payment_method_types: ['card'] } },
    });
    assert.deepEqual(outcome, {
      provider: 'stripe',
      providerRef: 'pi_1',
      status: 'captured',
      subject: 'reservation',
      subjectId: 9,
      method: 'card',
    });
  });

  test('a failed intent is recorded, not ignored', () => {
    const outcome = stripeOutcome({
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_2', metadata: meta } },
    });
    assert.equal(outcome?.status, 'failed');
    assert.equal(outcome?.providerRef, 'pi_2');
  });

  test('a refunded charge is keyed on its INTENT, which is what the row holds', () => {
    // The charge's own id would match no payment row — this is the mapping the
    // refund path depends on.
    const outcome = stripeOutcome({
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_3', metadata: meta } },
    });
    assert.equal(outcome?.providerRef, 'pi_3');
    assert.equal(outcome?.status, 'refunded');
  });

  test('a refunded charge carries the running refunded total, so a partial refund reads as partial', () => {
    const outcome = stripeOutcome({
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_3', amount: 3000, amount_refunded: 1000, metadata: meta } },
    });
    assert.equal(outcome?.refundedTotal, 1000);
  });

  test('events without our metadata are ignored', () => {
    // Another integration on the same Stripe account must not move our rows.
    assert.equal(
      stripeOutcome({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_x' } } }),
      null,
    );
  });

  test('event types we do not act on are ignored', () => {
    assert.equal(
      stripeOutcome({ type: 'customer.created', data: { object: { id: 'cus_1', metadata: meta } } }),
      null,
    );
  });
});

describe('PayPal events reduce to outcomes', () => {
  const captureEvent = (type: string) => ({
    event_type: type,
    resource: {
      id: 'CAPTURE1',
      custom_id: 'order:12',
      supplementary_data: { related_ids: { order_id: 'ORDER1' } },
    },
  });

  test('a completed capture is keyed on the ORDER id, and keeps the capture id', () => {
    // The row was written with the order id (known at start); the capture id is
    // what a later refund must target, so it rides along in metadata.
    const outcome = paypalOutcome(captureEvent('PAYMENT.CAPTURE.COMPLETED'));
    assert.deepEqual(outcome, {
      provider: 'paypal',
      providerRef: 'ORDER1',
      status: 'captured',
      subject: 'order',
      subjectId: 12,
      method: 'paypal',
      metadata: { captureId: 'CAPTURE1' },
    });
  });

  test('denied and declined both fail', () => {
    assert.equal(paypalOutcome(captureEvent('PAYMENT.CAPTURE.DENIED'))?.status, 'failed');
    assert.equal(paypalOutcome(captureEvent('PAYMENT.CAPTURE.DECLINED'))?.status, 'failed');
  });

  test('a refund is recognised', () => {
    assert.equal(paypalOutcome(captureEvent('PAYMENT.CAPTURE.REFUNDED'))?.status, 'refunded');
  });

  test('a refund carries the running refunded total in minor units', () => {
    const event = captureEvent('PAYMENT.CAPTURE.REFUNDED');
    const outcome = paypalOutcome({
      ...event,
      resource: {
        ...event.resource,
        seller_payable_breakdown: { total_refunded_amount: { value: '12.50', currency_code: 'EUR' } },
      },
    });
    assert.equal(outcome?.refundedTotal, 1250);
  });

  test('a refund without a stated total carries none, rather than guessing', () => {
    assert.equal(paypalOutcome(captureEvent('PAYMENT.CAPTURE.REFUNDED'))?.refundedTotal, undefined);
  });

  test('without a related order id there is no row to match, so it is ignored', () => {
    assert.equal(
      paypalOutcome({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'C', custom_id: 'order:12' } }),
      null,
    );
  });

  test('events carrying no subject of ours are ignored', () => {
    assert.equal(
      paypalOutcome({
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: 'C', supplementary_data: { related_ids: { order_id: 'O' } } },
      }),
      null,
    );
  });
});

describe('subjectFromResource reads both PayPal shapes', () => {
  test('a capture carries custom_id directly', () => {
    assert.deepEqual(subjectFromResource({ custom_id: 'reservation:3' }), {
      subject: 'reservation',
      subjectId: 3,
    });
  });

  test('an order event carries it on the purchase unit', () => {
    assert.deepEqual(subjectFromResource({ purchase_units: [{ custom_id: 'order:5' }] }), {
      subject: 'order',
      subjectId: 5,
    });
  });

  test('neither present is null, not a throw', () => {
    assert.equal(subjectFromResource({}), null);
    assert.equal(subjectFromResource(undefined), null);
  });
});
