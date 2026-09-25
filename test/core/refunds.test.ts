/**
 * Both refund paths left the captured row untouched — deliberately, since a
 * refund is its own row — which meant `status === 'captured'` stayed true after a
 * refund and could not serve as the guard against a second one. Neither used a
 * transaction or a row lock either, so the only thing refusing a double refund
 * was the payment provider.
 *
 * The claim is now recorded on the capture row under `metadata.refundedAmount`,
 * written inside a locked transaction before the provider is called. The locking
 * lives in the two modules; the arithmetic and the rules live here.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ApiError } from '@/cms/core/errors';
import {
  reconcileProviderRefund,
  REFUNDED_AMOUNT_KEY,
  refundedSoFar,
  resolveRefundAmount,
  withRefundClaim,
} from '@/cms/core/payments/refunds';

describe('refundedSoFar', () => {
  test('nothing recorded yet reads as zero', () => {
    assert.equal(refundedSoFar(null), 0);
    assert.equal(refundedSoFar(undefined), 0);
    assert.equal(refundedSoFar({}), 0);
    // The pre-existing shape: a capture row carrying only the PayPal capture id.
    assert.equal(refundedSoFar({ captureId: 'abc' }), 0);
  });

  test('reads a recorded claim', () => {
    assert.equal(refundedSoFar({ [REFUNDED_AMOUNT_KEY]: 1500 }), 1500);
  });

  test('a numeric string still counts', () => {
    // Tolerated rather than trusted: JSON columns accumulate shapes over time,
    // and mis-reading a real claim as zero is the one outcome that permits a
    // double refund.
    assert.equal(refundedSoFar({ [REFUNDED_AMOUNT_KEY]: '1500' }), 1500);
  });

  test('junk reads as zero rather than throwing', () => {
    // Zero restores the old permissive behaviour, which is the safe direction to
    // fail for a *refund*: an operator can still get the money back.
    assert.equal(refundedSoFar({ [REFUNDED_AMOUNT_KEY]: 'nonsense' }), 0);
    assert.equal(refundedSoFar({ [REFUNDED_AMOUNT_KEY]: null }), 0);
    assert.equal(refundedSoFar({ [REFUNDED_AMOUNT_KEY]: -50 }), 0);
    assert.equal(refundedSoFar({ [REFUNDED_AMOUNT_KEY]: {} }), 0);
  });

  test('fractional minor units are floored, never rounded up', () => {
    // Rounding up would let the balance drift above what was captured.
    assert.equal(refundedSoFar({ [REFUNDED_AMOUNT_KEY]: 10.9 }), 10);
  });
});

describe('withRefundClaim', () => {
  test('records the total without disturbing the rest of the metadata', () => {
    const before = { captureId: 'cap_1', refundOf: 7 };
    assert.deepEqual(withRefundClaim(before, 500), {
      captureId: 'cap_1',
      refundOf: 7,
      [REFUNDED_AMOUNT_KEY]: 500,
    });
  });

  test('works from an empty column', () => {
    assert.deepEqual(withRefundClaim(null, 500), { [REFUNDED_AMOUNT_KEY]: 500 });
  });

  test('overwrites a previous total rather than adding a second key', () => {
    const claimed = withRefundClaim({ [REFUNDED_AMOUNT_KEY]: 100 }, 300);
    assert.deepEqual(claimed, { [REFUNDED_AMOUNT_KEY]: 300 });
  });

  test('does not mutate its input', () => {
    const before = { captureId: 'cap_1' };
    withRefundClaim(before, 100);
    assert.deepEqual(before, { captureId: 'cap_1' });
  });
});

describe('resolveRefundAmount', () => {
  test('no amount asked for means everything still outstanding', () => {
    assert.equal(resolveRefundAmount({ capturedAmount: 3000, alreadyRefunded: 0 }), 3000);
    // Not the full capture — what is LEFT of it. Returning 3000 here is the bug
    // this whole file exists to prevent.
    assert.equal(resolveRefundAmount({ capturedAmount: 3000, alreadyRefunded: 1000 }), 2000);
  });

  test('a requested amount is capped at what remains', () => {
    assert.equal(
      resolveRefundAmount({ capturedAmount: 3000, alreadyRefunded: 1000, requested: 5000 }),
      2000,
    );
    assert.equal(
      resolveRefundAmount({ capturedAmount: 3000, alreadyRefunded: 1000, requested: 500 }),
      500,
    );
  });

  test('a fully refunded payment is refused', () => {
    assert.throws(
      () => resolveRefundAmount({ capturedAmount: 3000, alreadyRefunded: 3000 }),
      (err: unknown) =>
        err instanceof ApiError && err.status === 409 && /already been refunded in full/.test(err.message),
    );
  });

  test('an over-refunded row is refused rather than yielding a negative refund', () => {
    // Should not happen, but a negative amount sent to a gateway is a charge.
    assert.throws(
      () => resolveRefundAmount({ capturedAmount: 3000, alreadyRefunded: 4000 }),
      ApiError,
    );
  });

  test('a request for nothing is refused', () => {
    assert.throws(
      () => resolveRefundAmount({ capturedAmount: 3000, alreadyRefunded: 0, requested: 0 }),
      (err: unknown) => err instanceof ApiError && /more than nothing/.test(err.message),
    );
    assert.throws(
      () => resolveRefundAmount({ capturedAmount: 3000, alreadyRefunded: 0, requested: -100 }),
      ApiError,
    );
  });

  test('partial refunds accumulate to exactly the captured amount', () => {
    // The sequence the claim mechanism has to get right: three partials that
    // together exhaust the capture, then a fourth attempt that must fail.
    const captured = 3000;
    let refunded = 0;
    for (const requested of [1000, 1000, 1000]) {
      refunded += resolveRefundAmount({
        capturedAmount: captured,
        alreadyRefunded: refunded,
        requested,
      });
    }
    assert.equal(refunded, captured);
    assert.throws(
      () => resolveRefundAmount({ capturedAmount: captured, alreadyRefunded: refunded }),
      ApiError,
    );
  });

  test('a second concurrent claim finds nothing left', () => {
    // What the row lock buys: the first request writes its claim, the second
    // reads it and has no balance to work with.
    const captured = 2000;
    const first = resolveRefundAmount({ capturedAmount: captured, alreadyRefunded: 0 });
    const metadata = withRefundClaim(null, first);
    assert.throws(
      () =>
        resolveRefundAmount({
          capturedAmount: captured,
          alreadyRefunded: refundedSoFar(metadata),
        }),
      ApiError,
    );
  });
});

/**
 * A refund reported BY THE PROVIDER (a webhook), reconciled against what this
 * site already claimed on the capture row.
 *
 * The webhook used to treat every refund event as a full refund, so a partial
 * refund from the admin was later flipped to "refunded" by its own webhook —
 * restocking every line, restoring gift card balances and emailing the customer
 * that everything had come back.
 */
describe('reconcileProviderRefund', () => {
  test('a provider total equal to the capture is a full refund', () => {
    assert.deepEqual(reconcileProviderRefund({ capturedAmount: 3000, metadata: null, reportedTotal: 3000 }), {
      refundedTotal: 3000,
      remaining: 0,
    });
  });

  test('a partial refund leaves the rest of the capture outstanding', () => {
    assert.deepEqual(reconcileProviderRefund({ capturedAmount: 3000, metadata: null, reportedTotal: 1000 }), {
      refundedTotal: 1000,
      remaining: 2000,
    });
  });

  test('the webhook for a refund the admin already claimed does not count it twice', () => {
    const metadata = withRefundClaim(null, 1000);
    assert.deepEqual(reconcileProviderRefund({ capturedAmount: 3000, metadata, reportedTotal: 1000 }), {
      refundedTotal: 1000,
      remaining: 2000,
    });
  });

  test('a replayed event gives the same answer as the first delivery', () => {
    const first = reconcileProviderRefund({ capturedAmount: 3000, metadata: null, reportedTotal: 1000 });
    const replay = reconcileProviderRefund({
      capturedAmount: 3000,
      metadata: withRefundClaim(null, first.refundedTotal),
      reportedTotal: 1000,
    });
    assert.deepEqual(replay, first);
  });

  test('a refund made in the provider dashboard raises the total above the claim', () => {
    const metadata = withRefundClaim(null, 1000);
    assert.deepEqual(reconcileProviderRefund({ capturedAmount: 3000, metadata, reportedTotal: 3000 }), {
      refundedTotal: 3000,
      remaining: 0,
    });
  });

  test('an older event arriving after a newer admin claim does not lower the claim', () => {
    const metadata = withRefundClaim(null, 2500);
    assert.deepEqual(reconcileProviderRefund({ capturedAmount: 3000, metadata, reportedTotal: 1000 }), {
      refundedTotal: 2500,
      remaining: 500,
    });
  });

  test('a reported total above the capture is capped at the capture', () => {
    assert.deepEqual(reconcileProviderRefund({ capturedAmount: 3000, metadata: null, reportedTotal: 9000 }), {
      refundedTotal: 3000,
      remaining: 0,
    });
  });

  test('when the provider states no amount, what the admin claimed stands', () => {
    const metadata = withRefundClaim(null, 1000);
    assert.deepEqual(reconcileProviderRefund({ capturedAmount: 3000, metadata }), {
      refundedTotal: 1000,
      remaining: 2000,
    });
  });

  test('when the provider states no amount and nothing was claimed here, it is a full refund', () => {
    // The only refund this site knows nothing about came from the dashboard,
    // and without an amount the old reading (all of it) is the one left.
    assert.deepEqual(reconcileProviderRefund({ capturedAmount: 3000, metadata: null }), {
      refundedTotal: 3000,
      remaining: 0,
    });
  });
});
