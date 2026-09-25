/**
 * Accepting a request, and what the customer is then told.
 *
 * "Accept & send payment link" used to change the status and nothing else. No
 * link was issued, so the approval email said "We will send you payment
 * instructions" — which nobody ever did — and the accepted booking inherited the
 * 20-minute INSTANT payment hold, so the expiry sweep could lapse it before the
 * customer had even opened the email.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { MANAGED_SETTINGS } from '@/cms/core/settings/schema';
import { customerEmailBody } from '@/cms/modules/booking/emails';
import { holdsKeepDeadline, operatorPaymentDeadline, paymentDeadlineForMove } from '@/cms/modules/booking/lifecycle';
import { BOOKING_SETTING_READERS } from '@/cms/modules/booking/settings-read';

const source = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

/** The body of one exported function, for wiring checks. */
function fnBody(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = text.indexOf('\nexport ', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

describe('the payment deadline of an accepted request', () => {
  test('is the payment-link lifetime in days, not the instant hold in minutes', () => {
    const now = new Date('2026-09-23T10:00:00Z');
    assert.equal(operatorPaymentDeadline(now, 7).toISOString(), '2026-09-30T10:00:00.000Z');
  });

  test('updateReservationStatus takes it from "Payment links expire after (days)"', () => {
    const body = fnBody(source('src/cms/modules/booking/reservations.ts'), 'updateReservationStatus');
    assert.match(body, /getPaymentLinkTtlDays\(\)/);
    assert.match(body, /operatorPaymentDeadline\(/);
    assert.doesNotMatch(body, /getPaymentHoldMinutes/, 'an operator move must not inherit the instant hold');
  });
});

/**
 * An operator moving a CONFIRMED booking back to awaiting payment (to collect a
 * balance, say) was given a payment deadline, and the expiry sweep then expired
 * a booking whose date had already been confirmed — releasing a date the
 * customer had been told was theirs.
 */
describe('a payment deadline only applies to a date that is merely held', () => {
  const deadline = new Date('2026-09-30T10:00:00Z');

  test('accepting a request (awaiting your reply → awaiting payment) gets the link-days deadline', () => {
    assert.equal(paymentDeadlineForMove('pending', 'awaiting_payment', deadline), deadline);
  });

  test('confirmed → awaiting payment gets no deadline: the date is already confirmed', () => {
    assert.equal(paymentDeadlineForMove('confirmed', 'awaiting_payment', deadline), null);
  });

  test('paid → awaiting payment gets no deadline either', () => {
    assert.equal(paymentDeadlineForMove('paid', 'awaiting_payment', deadline), null);
  });

  test('a move to anything other than awaiting payment clears the deadline', () => {
    assert.equal(paymentDeadlineForMove('awaiting_payment', 'confirmed', deadline), null);
    assert.equal(paymentDeadlineForMove('awaiting_payment', 'cancelled', deadline), null);
  });

  test('a payment link sets a deadline while the date is held', () => {
    assert.equal(holdsKeepDeadline('awaiting_payment', ['held']), true);
    assert.equal(holdsKeepDeadline('awaiting_payment', []), true);
  });

  test('a payment link sets no deadline once the date is confirmed', () => {
    assert.equal(holdsKeepDeadline('awaiting_payment', ['confirmed']), false);
    assert.equal(holdsKeepDeadline('awaiting_payment', ['confirmed', 'confirmed']), false);
  });

  test('a payment link on a confirmed booking sets no deadline', () => {
    assert.equal(holdsKeepDeadline('confirmed', ['confirmed']), false);
  });

  test('both the move and the link use these rules', () => {
    assert.match(fnBody(source('src/cms/modules/booking/reservations.ts'), 'updateReservationStatus'), /paymentDeadlineForMove\(/);
    assert.match(fnBody(source('src/cms/modules/booking/payments.ts'), 'issuePaymentLink'), /holdsKeepDeadline\(/);
  });
});

describe('accepting issues a real payment request', () => {
  test('a move to awaiting payment asks for payment through the configured method', () => {
    const body = fnBody(source('src/cms/modules/booking/reservations.ts'), 'updateReservationStatus');
    assert.match(body, /requestPayment\(/);
  });

  test('with a gateway, the request issues a payment link and emails it', () => {
    const body = fnBody(source('src/cms/modules/booking/payments.ts'), 'requestPayment');
    assert.match(body, /isOnlineProvider\(/);
    assert.match(body, /issuePaymentLink\(/);
    assert.match(body, /sendPaymentLinkEmail\(/);
  });

  test('the reservation PATCH route knows the site locale and has the gateways registered', () => {
    const route = readFileSync(new URL('../../src/app/api/cms/reservations/[id]/route.ts', import.meta.url), 'utf8');
    assert.match(route, /import '@\/cms\/core\/payments\/register';/);
    assert.match(route, /reservationUpdateRoute\(\{ defaultLocale: config\.defaultLocale \}\)/);
  });
});

describe('the approval email', () => {
  test('carries the payment link when there is one', () => {
    const body = customerEmailBody('payment_link', 'en', { paymentUrl: 'https://example.com/booking/pay/R1?t=x' });
    assert.match(body.html, /href="https:\/\/example\.com\/booking\/pay\/R1\?t=x"/);
  });

  test('with manual payment, carries the payment instructions, line by line and escaped', () => {
    const body = customerEmailBody('payment_link', 'en', {
      paymentInstructions: 'IBAN GR12 3456\nBank <Alpha> & Co',
    });
    assert.match(body.html, /IBAN GR12 3456<br>Bank &lt;Alpha&gt; &amp; Co/);
    assert.doesNotMatch(body.html, /We will send you payment instructions/);
  });

  test('with no link and no instructions, says something true instead of promising instructions', () => {
    const en = customerEmailBody('payment_link', 'en', {});
    const el = customerEmailBody('payment_link', 'el', {});
    assert.doesNotMatch(en.html, /We will send you payment instructions/);
    assert.match(en.html, /contact us/i);
    assert.ok(el.html.length > 0);
  });

  test('blank instructions count as none', () => {
    assert.deepEqual(
      customerEmailBody('payment_link', 'en', { paymentInstructions: '  \n ' }),
      customerEmailBody('payment_link', 'en', {}),
    );
  });
});

describe('the "Payment instructions" setting', () => {
  const field = MANAGED_SETTINGS.find((f) => f.key === 'booking.paymentInstructions');

  test('exists on the Booking tab as a multi-line field', () => {
    assert.ok(field, 'booking.paymentInstructions is not a managed setting');
    assert.equal(field.label, 'Payment instructions');
    assert.equal(field.type, 'textarea');
    assert.equal(field.group, 'Booking');
  });

  test('says where it is used', () => {
    assert.match(field?.description ?? '', /approval email/i);
    assert.match(field?.description ?? '', /manual/i);
  });

  test('has a reader', () => {
    assert.equal(typeof BOOKING_SETTING_READERS['booking.paymentInstructions'], 'function');
  });

  test('"Payment links expire after (days)" explains it is also the deadline to pay', () => {
    const ttl = MANAGED_SETTINGS.find((f) => f.key === 'booking.paymentLinkExpiryDays');
    assert.match(ttl?.description ?? '', /accepted/i);
  });
});

describe('the expiry email', () => {
  test('an unanswered request is told it lapsed', () => {
    const body = customerEmailBody('expired', 'en', { from: 'pending' });
    assert.equal(body.subject, 'Your request expired');
  });

  test('an unpaid booking is told the payment deadline passed, not that we failed to reply', () => {
    const body = customerEmailBody('expired', 'en', { from: 'awaiting_payment' });
    assert.match(body.html, /payment/i);
    assert.doesNotMatch(body.html, /did not manage to confirm/);
    assert.ok(customerEmailBody('expired', 'el', { from: 'awaiting_payment' }).html.length > 0);
  });

  test('the automatic sweep sends it, and only for a row it actually moved', () => {
    const body = fnBody(source('src/cms/modules/booking/allocation.ts'), 'expireStaleReservations');
    assert.match(body, /affectedRows\(/);
    assert.match(body, /sendStatusEmail\(row\.id, row\.status, 'expired'\)/);
  });
});

describe('the drawer money routes are for bookings writers only', () => {
  const payments = source('src/cms/modules/booking/payments.ts');
  for (const factory of ['paymentLinkRoute', 'recordPaymentRoute', 'refundReservationRoute']) {
    test(`${factory} is guarded by reservationsWrite (a read-only role gets 403)`, () => {
      assert.match(fnBody(payments, factory), /guard: \(\) => requireApiPerm\(PERMISSIONS\.reservationsWrite\)/);
    });
  }

  test('the status PATCH is guarded by reservationsWrite', () => {
    const body = fnBody(source('src/cms/modules/booking/reservations.ts'), 'reservationUpdateRoute');
    assert.match(body, /guard: \(\) => requireApiPerm\(PERMISSIONS\.reservationsWrite\)/);
  });

  test('each money route applies the same refusal rules the drawer does', () => {
    assert.match(fnBody(payments, 'paymentLinkRoute'), /paymentLinkRefusal\(/);
    // Record payment decides on the row it has locked, inside recordBookingPayment.
    assert.match(fnBody(payments, 'recordPaymentRoute'), /enforceBalance: true/);
    assert.match(fnBody(payments, 'recordBookingPayment'), /manualPaymentRefusal\(/);
    assert.match(fnBody(payments, 'refundReservationPayment'), /refundRefusal\(/);
  });
});
