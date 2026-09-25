/**
 * The rules behind the reservation drawer's money actions.
 *
 * The routes existed — issue a payment link, record a payment, refund — but no
 * screen called them, so an operator had no way to resend a lost link, note a
 * bank transfer, or send money back. These are the rules both the drawer (what it
 * offers) and the routes (what they accept) decide with, so the two cannot drift:
 * a button the API would refuse is not shown, and a crafted request the button
 * would never send is still refused.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  balanceDue,
  canRecordPayment,
  canResendPaymentLink,
  manualPaymentRefusal,
  parseMoneyInput,
  paymentLinkAmount,
  paymentLinkRefusal,
  recordPaymentRefusal,
  refundableAmount,
  refundRefusal,
} from '@/cms/modules/booking/payment-actions';
import type { ReservationStatus } from '@/cms/db/adapters/mysql/schema/booking';

const NOW = new Date('2026-09-23T10:00:00Z');

function reservation(
  over: Partial<{ status: ReservationStatus; total: number; amountPaid: number; expiresAt: Date | string | null }> = {},
) {
  return { status: 'awaiting_payment' as ReservationStatus, total: 10000, amountPaid: 0, expiresAt: null, ...over };
}

describe('balanceDue', () => {
  test('is what is left of the total', () => {
    assert.equal(balanceDue(reservation({ amountPaid: 3000 })), 7000);
  });
  test('never goes negative on an overpaid booking', () => {
    assert.equal(balanceDue(reservation({ amountPaid: 12000 })), 0);
  });
});

describe('resending a payment link', () => {
  test('is allowed while the booking awaits payment', () => {
    assert.equal(paymentLinkRefusal(reservation(), NOW), null);
    assert.equal(canResendPaymentLink(reservation(), NOW), true);
  });

  test('is allowed for the balance of a confirmed booking whose deposit is paid', () => {
    const r = reservation({ status: 'confirmed', amountPaid: 3000 });
    assert.equal(paymentLinkRefusal(r, NOW), null);
  });

  test('is refused once the booking is paid in full', () => {
    assert.match(paymentLinkRefusal(reservation({ status: 'paid', amountPaid: 10000 }), NOW) ?? '', /awaiting payment/);
    assert.match(
      paymentLinkRefusal(reservation({ status: 'confirmed', amountPaid: 10000 }), NOW) ?? '',
      /awaiting payment/,
    );
  });

  test('is refused for a cancelled or expired booking', () => {
    for (const status of ['cancelled', 'expired'] as const) {
      assert.notEqual(paymentLinkRefusal(reservation({ status }), NOW), null, status);
      assert.equal(canResendPaymentLink(reservation({ status }), NOW), false, status);
    }
  });

  test('is refused once the payment deadline has passed — the date may already be back on sale', () => {
    const r = reservation({ expiresAt: new Date(NOW.getTime() - 60_000) });
    assert.match(paymentLinkRefusal(r, NOW) ?? '', /deadline/);
  });

  test('a deadline still ahead does not refuse it, whether it arrives as a Date or as JSON', () => {
    assert.equal(paymentLinkRefusal(reservation({ expiresAt: new Date(NOW.getTime() + 60_000) }), NOW), null);
    assert.equal(
      paymentLinkRefusal(reservation({ expiresAt: new Date(NOW.getTime() + 60_000).toISOString() }), NOW),
      null,
    );
  });

  test('the drawer does not offer it for an unanswered request — accepting is what sends the first link', () => {
    assert.equal(canResendPaymentLink(reservation({ status: 'pending' }), NOW), false);
  });
});

describe('what a (re)issued link asks for', () => {
  test('a booking awaiting payment is asked for the deposit (or the full amount when there is none)', () => {
    assert.equal(paymentLinkAmount(reservation(), 3000), 3000);
    assert.equal(paymentLinkAmount(reservation(), 10000), 10000);
  });

  test('a confirmed booking whose deposit is paid is asked for the whole total, so the link collects the balance', () => {
    // The link's "due now" is (amount asked − paid). Asking for the deposit
    // again would show a customer with a balance to pay that nothing is due.
    assert.equal(paymentLinkAmount(reservation({ status: 'confirmed', amountPaid: 3000 }), 3000), 10000);
  });
});

describe('recording a payment', () => {
  test('is accepted up to the balance due', () => {
    assert.equal(recordPaymentRefusal(reservation({ amountPaid: 3000 }), 7000), null);
    assert.equal(canRecordPayment(reservation()), true);
  });

  test('refuses an amount above the balance due', () => {
    assert.match(recordPaymentRefusal(reservation({ amountPaid: 3000 }), 7001) ?? '', /balance due/);
  });

  test('refuses nothing, a negative amount or a fraction of a cent', () => {
    for (const amount of [0, -100, 10.5, Number.NaN]) {
      assert.notEqual(recordPaymentRefusal(reservation(), amount), null, String(amount));
    }
  });

  test('refuses a booking already paid in full', () => {
    assert.match(recordPaymentRefusal(reservation({ status: 'paid', amountPaid: 10000 }), 100) ?? '', /paid in full/);
    assert.equal(canRecordPayment(reservation({ status: 'paid', amountPaid: 10000 })), false);
  });

  test('refuses a cancelled or expired booking', () => {
    for (const status of ['cancelled', 'expired'] as const) {
      assert.notEqual(recordPaymentRefusal(reservation({ status }), 100), null, status);
      assert.equal(canRecordPayment(reservation({ status })), false, status);
    }
  });

  test('is allowed on an unanswered request — a transfer can arrive before the reply', () => {
    assert.equal(recordPaymentRefusal(reservation({ status: 'pending' }), 5000), null);
  });
});

describe('refunds', () => {
  const captured = { status: 'captured', amount: 5000, metadata: {} as Record<string, unknown> };

  test('a captured gateway payment is refundable in full', () => {
    assert.equal(refundableAmount(captured, true), 5000);
  });

  test('what was already refunded is not refundable again', () => {
    assert.equal(refundableAmount({ ...captured, metadata: { refundedAmount: 2000 } }, true), 3000);
    assert.equal(refundableAmount({ ...captured, metadata: { refundedAmount: 5000 } }, true), 0);
  });

  test('a payment the provider cannot refund online (manual / bank transfer) is not refundable here', () => {
    assert.equal(refundableAmount(captured, false), 0);
  });

  test('a pending, failed or refund row is not refundable', () => {
    for (const status of ['pending', 'failed', 'refunded']) {
      assert.equal(refundableAmount({ ...captured, status }, true), 0, status);
    }
    assert.equal(refundableAmount({ ...captured, status: 'refunded', amount: -5000 }, true), 0);
  });

  test('refusing a refund when nothing captured is left', () => {
    assert.match(refundRefusal(0, undefined) ?? '', /nothing/i);
  });

  test('a partial amount within what is left is fine; empty means all of it', () => {
    assert.equal(refundRefusal(5000, 1000), null);
    assert.equal(refundRefusal(5000, undefined), null);
  });

  test('an amount above what is left, zero or a fraction is refused', () => {
    assert.match(refundRefusal(5000, 5001) ?? '', /more than/);
    assert.notEqual(refundRefusal(5000, 0), null);
    assert.notEqual(refundRefusal(5000, 12.5), null);
  });
});

describe('parseMoneyInput', () => {
  test('turns what an operator types into minor units', () => {
    assert.equal(parseMoneyInput('120'), 12000);
    assert.equal(parseMoneyInput('120.5'), 12050);
    assert.equal(parseMoneyInput(' 1,234.56 '.replace(',', '')), 123456);
  });

  test('accepts a decimal comma, as a Greek keyboard types it', () => {
    assert.equal(parseMoneyInput('99,90'), 9990);
  });

  test('returns null for empty, negative, or malformed input', () => {
    for (const bad of ['', '   ', '-5', 'abc', '1.2.3', '10.999']) {
      assert.equal(parseMoneyInput(bad), null, bad);
    }
  });
});

/**
 * "Record payment" checked the balance before taking the reservation's lock, so
 * two records at once both saw the same balance and could overpay the booking.
 * The check now runs on the row read under the lock — the same rule, with the
 * same readable refusals the route always gave.
 */
describe('manualPaymentRefusal', () => {
  test('a live booking with a balance accepts a payment up to it', () => {
    assert.equal(manualPaymentRefusal(reservation({ amountPaid: 3000 }), 7000), null);
  });

  test('a dead booking is a state conflict', () => {
    assert.deepEqual(manualPaymentRefusal(reservation({ status: 'cancelled' }), 1000), {
      kind: 'conflict',
      message: 'A cancelled or expired booking cannot take a payment.',
    });
  });

  test('a settled booking is a state conflict', () => {
    assert.deepEqual(manualPaymentRefusal(reservation({ amountPaid: 10000 }), 1000), {
      kind: 'conflict',
      message: 'This booking is already paid in full.',
    });
  });

  test('more than the balance is a bad figure', () => {
    assert.deepEqual(manualPaymentRefusal(reservation({ amountPaid: 3000 }), 8000), {
      kind: 'bad_request',
      message: 'That is more than the balance due.',
    });
  });

  test('the second of two simultaneous records, seen after the first landed, is refused', () => {
    // Both operators saw 7000 due and each typed 7000. Under the lock the
    // second reads the row the first one wrote.
    const before = reservation({ amountPaid: 3000 });
    assert.equal(manualPaymentRefusal(before, 7000), null);
    const afterFirst = reservation({ status: 'paid', amountPaid: 10000 });
    assert.deepEqual(manualPaymentRefusal(afterFirst, 7000), {
      kind: 'conflict',
      message: 'This booking is already paid in full.',
    });
  });

  describe('where the check runs', () => {
    const src = readFileSync(new URL('../../src/cms/modules/booking/payments.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');
    const body = (name: string) => {
      const start = src.indexOf(`function ${name}(`);
      return src.slice(start, src.indexOf('\nexport ', start + 1));
    };

    test('recordBookingPayment checks the locked row, after FOR UPDATE and before the insert', () => {
      const fn = body('recordBookingPayment');
      const lockAt = fn.indexOf(".for('update')");
      const checkAt = fn.indexOf('manualPaymentRefusal(');
      const insertAt = fn.indexOf('.insert(schema.reservationPayments)');
      assert.ok(lockAt > 0 && checkAt > lockAt && insertAt > checkAt, 'the balance check is not inside the lock');
    });

    test('the route no longer decides on an unlocked read', () => {
      const fn = body('recordPaymentRoute');
      assert.doesNotMatch(fn, /recordPaymentRefusal\(/);
      assert.match(fn, /enforceBalance: true/);
    });
  });
});
