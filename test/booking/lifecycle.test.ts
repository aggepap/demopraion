import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  allowedTransitions,
  canTransition,
  consumesCapacity,
  emailForNewReservation,
  emailForTransition,
  holdStateFor,
  initialStatus,
  isTerminal,
  RESERVATION_STATUSES,
  RESERVATION_STATUS_LABELS,
} from '@/cms/modules/booking/lifecycle';
import {
  formatBookingReference,
  hashToken,
  isBookingReference,
  isTokenLive,
  normalizeReference,
  paymentToken,
  referenceSuffix,
  tokenMatches,
} from '@/cms/modules/booking/reference';

describe('the status machine', () => {
  test('the happy path in request mode', () => {
    assert.ok(canTransition('pending', 'awaiting_payment'));
    assert.ok(canTransition('awaiting_payment', 'paid'));
  });
  test('the happy path in instant mode', () => {
    assert.equal(initialStatus('instant', true), 'awaiting_payment');
    assert.ok(canTransition('awaiting_payment', 'paid'));
  });
  test('instant with no gateway confirms outright and still takes the date', () => {
    assert.equal(initialStatus('instant', false), 'confirmed');
    assert.equal(consumesCapacity('confirmed'), true);
  });
  test('request mode always starts as an enquiry', () => {
    assert.equal(initialStatus('request', true), 'pending');
    assert.equal(initialStatus('request', false), 'pending');
  });

  test('nothing may return to pending — a live payment link would be left dangling', () => {
    for (const from of RESERVATION_STATUSES) {
      assert.equal(canTransition(from, 'pending'), false, `${from} → pending must be refused`);
    }
  });

  test('a finished reservation is finished', () => {
    assert.equal(isTerminal('cancelled'), true);
    assert.equal(isTerminal('expired'), true);
    assert.deepEqual(allowedTransitions('cancelled'), []);
    assert.deepEqual(allowedTransitions('expired'), []);
  });

  test('a paid reservation can only be cancelled — a refund is a payment row, not a status', () => {
    assert.deepEqual(allowedTransitions('paid'), ['cancelled']);
  });

  test('every illegal jump is refused', () => {
    const illegal: [string, string][] = [
      ['pending', 'paid'],
      ['cancelled', 'confirmed'],
      ['expired', 'awaiting_payment'],
      ['paid', 'confirmed'],
      ['cancelled', 'paid'],
    ];
    for (const [from, to] of illegal) {
      assert.equal(
        canTransition(from as never, to as never),
        false,
        `${from} → ${to} must be refused`,
      );
    }
  });

  test('a status can never transition to itself', () => {
    for (const s of RESERVATION_STATUSES) {
      assert.equal(canTransition(s, s), false, `${s} → ${s}`);
    }
  });

  test('every status is reachable from somewhere except the entry points', () => {
    const reachable = new Set(RESERVATION_STATUSES.flatMap((s) => allowedTransitions(s)));
    for (const s of RESERVATION_STATUSES) {
      if (s === 'pending') continue; // an entry point, never a destination
      assert.ok(reachable.has(s), `${s} is unreachable`);
    }
  });
});

describe('what a status means to the seat ledger', () => {
  /*
   * The rule the whole of request mode rests on: an enquiry holds nothing, so
   * ten people can ask about the same Saturday and all see it as available.
   */
  test('pending holds NOTHING', () => {
    assert.equal(holdStateFor('pending'), null);
    assert.equal(consumesCapacity('pending'), false);
  });
  test('awaiting_payment holds the date', () => {
    assert.equal(holdStateFor('awaiting_payment'), 'held');
    assert.equal(consumesCapacity('awaiting_payment'), true);
  });
  test('confirmed and paid hold it firmly', () => {
    assert.equal(holdStateFor('confirmed'), 'confirmed');
    assert.equal(holdStateFor('paid'), 'confirmed');
  });
  test('cancelled and expired give it back', () => {
    assert.equal(holdStateFor('cancelled'), 'released');
    assert.equal(holdStateFor('expired'), 'released');
    assert.equal(consumesCapacity('cancelled'), false);
  });
  test('every status has a defined ledger meaning', () => {
    for (const s of RESERVATION_STATUSES) {
      assert.doesNotThrow(() => holdStateFor(s));
    }
  });
});

describe('emails', () => {
  test('accepting a request sends the payment link', () => {
    assert.equal(emailForTransition('pending', 'awaiting_payment'), 'payment_link');
  });
  test('payment sends a receipt', () => {
    assert.equal(emailForTransition('awaiting_payment', 'paid'), 'receipt');
  });
  test('expiry always tells the customer — silence is worse than an extra email', () => {
    assert.equal(emailForTransition('pending', 'expired'), 'expired');
  });
  test('cancelling tells them too', () => {
    assert.equal(emailForTransition('confirmed', 'cancelled'), 'cancelled');
  });
  test('a non-move sends nothing', () => {
    assert.equal(emailForTransition('paid', 'paid'), null);
  });
});

describe('the email a brand-new reservation owes', () => {
  test('an enquiry is acknowledged, not confirmed', () => {
    assert.equal(emailForNewReservation('pending'), 'request_received');
  });

  // The regression this function exists for: the send site branched on
  // `pending` alone, so an instant booking awaiting payment was mailed "your
  // booking is confirmed" while its hold was still counting down.
  test('an instant booking awaiting payment is asked to pay, not told it is confirmed', () => {
    assert.equal(emailForNewReservation('awaiting_payment'), 'payment_link');
    assert.notEqual(emailForNewReservation('awaiting_payment'), 'confirmed');
  });

  test('instant with no gateway is genuinely confirmed', () => {
    assert.equal(emailForNewReservation('confirmed'), 'confirmed');
  });

  test('every status `initialStatus` can produce is answered', () => {
    for (const mode of ['request', 'instant'] as const) {
      for (const online of [true, false]) {
        assert.ok(emailForNewReservation(initialStatus(mode, online)));
      }
    }
  });
});

describe('status labels', () => {
  test('every status has a human label, and none is the raw key', () => {
    for (const s of RESERVATION_STATUSES) {
      const label = RESERVATION_STATUS_LABELS[s];
      assert.ok(label && label.length > 0, `${s} has no label`);
      assert.notEqual(label, s);
      assert.ok(!label.includes('_'), `${s} → "${label}" still looks like an identifier`);
    }
  });
});

describe('booking references', () => {
  test('shaped BKG-<year>-<random>', () => {
    const ref = formatBookingReference(2026);
    assert.match(ref, /^BKG-2026-[0-9A-Z]{8}$/);
    assert.ok(isBookingReference(ref));
  });
  test('the alphabet excludes the characters people mis-read aloud', () => {
    const suffix = referenceSuffix(2000);
    for (const ambiguous of ['I', 'L', 'O', 'U']) {
      assert.ok(!suffix.includes(ambiguous), `${ambiguous} should not appear in a spoken reference`);
    }
  });
  test('references are not sequential — they must not leak the booking count', () => {
    const a = formatBookingReference(2026);
    const b = formatBookingReference(2026);
    assert.notEqual(a, b);
  });
  test('collisions are vanishingly rare across many draws', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => referenceSuffix()));
    assert.equal(seen.size, 2000);
  });
  test('rejects things that are not references', () => {
    assert.equal(isBookingReference('ORD-2026-ABCDEFGH'), false);
    assert.equal(isBookingReference('BKG-26-ABCDEFGH'), false);
    assert.equal(isBookingReference(''), false);
    assert.equal(isBookingReference(null), false);
  });
  test('accepts one re-keyed off paper in the wrong case, with stray spaces', () => {
    const ref = formatBookingReference(2026);
    assert.ok(isBookingReference(`  ${ref.toLowerCase()}  `));
    assert.equal(normalizeReference(`  ${ref.toLowerCase()} `), ref);
  });
});

describe('payment tokens', () => {
  test('long and random', () => {
    const token = paymentToken();
    assert.equal(token.length, 32);
    assert.notEqual(token, paymentToken());
  });
  test('the stored form is a hash, not the token', () => {
    const token = paymentToken();
    const stored = hashToken(token);
    assert.equal(stored.length, 64);
    assert.notEqual(stored, token);
    assert.ok(!stored.includes(token));
  });
  test('hashing is deterministic, so a presented token can be checked', () => {
    const token = paymentToken();
    assert.equal(hashToken(token), hashToken(token));
  });
  test('the right token matches and a wrong one does not', () => {
    const token = paymentToken();
    const stored = hashToken(token);
    assert.equal(tokenMatches(hashToken(token), stored), true);
    assert.equal(tokenMatches(hashToken(paymentToken()), stored), false);
  });
  test('a missing or malformed stored hash never matches', () => {
    assert.equal(tokenMatches(hashToken('x'), null), false);
    assert.equal(tokenMatches(hashToken('x'), undefined), false);
    assert.equal(tokenMatches(hashToken('x'), 'too-short'), false);
  });
  test('a spent link is dead: no hash means no match', () => {
    assert.equal(isTokenLive(null, new Date('2030-01-01')), false);
  });
  test('an expired link is dead even though the hash is still right', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    assert.equal(isTokenLive('abc', new Date('2026-06-30T00:00:00Z'), now), false);
    assert.equal(isTokenLive('abc', new Date('2026-07-02T00:00:00Z'), now), true);
  });
  test('no expiry means it does not expire', () => {
    assert.equal(isTokenLive('abc', null), true);
  });
});
