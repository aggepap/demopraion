import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { amountDueFor, settlementFor } from '@/cms/modules/booking/payments';
import { canTransition } from '@/cms/modules/booking/lifecycle';
import { surchargeAmount } from '@/cms/modules/booking/pricing';
import type { ReservationStatus } from '@/cms/db/adapters/mysql/schema/booking';

/**
 * Where a credited payment leaves a reservation.
 *
 * The deposit row is the one that used to be wrong: settlement compared the
 * running total against `total` alone, so clearing a deposit advanced nothing.
 * The link then reported nothing due while the reservation sat in its old
 * status — unable to be either paid or progressed, and invisible as a fault.
 */
function reservation(over: Partial<Parameters<typeof settlementFor>[0]> = {}) {
  return {
    status: 'awaiting_payment' as ReservationStatus,
    total: 10000,
    depositAmount: 0,
    amountPaid: 0,
    ...over,
  };
}

describe('settlementFor', () => {
  test('the full amount pays it', () => {
    const r = settlementFor(reservation(), 10000);
    assert.deepEqual(r, { paid: 10000, next: 'paid', secured: true });
  });

  test('overpayment still pays it, and does not go backwards', () => {
    const r = settlementFor(reservation(), 12000);
    assert.equal(r.next, 'paid');
    assert.equal(r.secured, true);
  });

  test('a part payment with no deposit configured advances nothing', () => {
    // There is no threshold to have crossed, so the date is not secured.
    const r = settlementFor(reservation(), 4000);
    assert.deepEqual(r, { paid: 4000, next: 'awaiting_payment', secured: false });
  });

  test('clearing the deposit CONFIRMS — the date is taken, the balance is not', () => {
    const r = settlementFor(reservation({ depositAmount: 3000 }), 3000);
    assert.deepEqual(r, { paid: 3000, next: 'confirmed', secured: true });
  });

  test('falling short of the deposit secures nothing', () => {
    const r = settlementFor(reservation({ depositAmount: 3000 }), 2999);
    assert.deepEqual(r, { paid: 2999, next: 'awaiting_payment', secured: false });
  });

  test('the balance after a deposit pays it', () => {
    const r = settlementFor(reservation({ status: 'confirmed', depositAmount: 3000, amountPaid: 3000 }), 7000);
    assert.deepEqual(r, { paid: 10000, next: 'paid', secured: true });
  });

  test('a deposit payment never walks a further-along reservation backwards', () => {
    // `confirmed` must not become `confirmed` via a downgrade path, and `paid`
    // must never regress — money arriving late cannot undo a settled booking.
    const already = settlementFor(reservation({ status: 'paid', depositAmount: 3000, amountPaid: 3000 }), 0);
    assert.equal(already.next, 'paid');
    const confirmed = settlementFor(reservation({ status: 'confirmed', depositAmount: 3000 }), 3000);
    assert.equal(confirmed.next, 'confirmed');
  });

  test('a pending enquiry can be confirmed by a deposit', () => {
    const r = settlementFor(reservation({ status: 'pending', depositAmount: 3000 }), 3000);
    assert.equal(r.next, 'confirmed');
  });

  test('every status it produces is a legal transition', () => {
    // The settlement logic and the status machine are written separately; this
    // is what stops them drifting apart.
    for (const status of ['pending', 'awaiting_payment', 'confirmed'] as ReservationStatus[]) {
      for (const deposit of [0, 3000]) {
        for (const credit of [0, 2999, 3000, 10000]) {
          const r = settlementFor(reservation({ status, depositAmount: deposit }), credit);
          if (r.next === status) continue;
          assert.ok(
            canTransition(status, r.next),
            `settlement moved ${status} → ${r.next}, which the lifecycle forbids`,
          );
        }
      }
    }
  });
});

describe('amountDueFor', () => {
  test('with no deposit it is the whole total', () => {
    assert.equal(amountDueFor({ total: 10000, depositAmount: 0, amountPaid: 0 }), 10000);
  });

  test('with a deposit it is the deposit', () => {
    assert.equal(amountDueFor({ total: 10000, depositAmount: 3000, amountPaid: 0 }), 3000);
  });

  test('what is already paid comes off', () => {
    assert.equal(amountDueFor({ total: 10000, depositAmount: 0, amountPaid: 4000 }), 6000);
  });

  test('never negative, so an overpaid booking asks for nothing', () => {
    assert.equal(amountDueFor({ total: 10000, depositAmount: 0, amountPaid: 12000 }), 0);
  });
});

/**
 * The surcharge is charged to the customer but must NOT be credited against the
 * balance — otherwise the fee would help settle the bill it was added to, and a
 * booking would read as paid while the operator is short by the fee.
 */
describe('surcharge accounting', () => {
  const CARD_BPS = 400; // 4%, the rate the WordPress original charged
  const PAYPAL_BPS = 525; // 5.25%

  test('the documented rates still compute as documented', () => {
    assert.equal(surchargeAmount(10000, CARD_BPS), 400);
    assert.equal(surchargeAmount(10000, PAYPAL_BPS), 525);
  });

  test('the customer is charged due + surcharge', () => {
    const due = 10000;
    const surcharge = surchargeAmount(due, CARD_BPS);
    assert.equal(due + surcharge, 10400);
  });

  test('but only the base credits the balance, so the booking settles exactly', () => {
    const due = 10000;
    const surcharge = surchargeAmount(due, CARD_BPS);
    const chargeable = due + surcharge;
    // This is the sum `captureReservationPaymentByRef` performs from the row's
    // amount and its stored surcharge.
    const credit = chargeable - surcharge;
    const r = settlementFor(reservation({ total: 10000 }), credit);
    assert.equal(r.paid, 10000, 'the balance must land exactly on the total');
    assert.equal(r.next, 'paid');
  });

  test('a surcharged deposit still settles to exactly the deposit', () => {
    const due = 3000;
    const surcharge = surchargeAmount(due, PAYPAL_BPS);
    const credit = due + surcharge - surcharge;
    const r = settlementFor(reservation({ total: 10000, depositAmount: 3000 }), credit);
    assert.equal(r.paid, 3000);
    assert.equal(r.next, 'confirmed');
  });

  test('no surcharge configured changes nothing', () => {
    assert.equal(surchargeAmount(10000, 0), 0);
  });

  /*
   * Money landing on a booking that no longer exists.
   *
   * `cancelled` and `expired` have no outgoing transitions at all, so neither the
   * target status nor the `confirmed` fallback is reachable. The settlement is
   * therefore not "not yet" — it is "never", and `refused` is what distinguishes
   * the two for the caller. It matters because `recordBookingPayment` used to
   * write `amountPaid` on every captured payment regardless: a late webhook retry
   * after the sweeper ran inflated the balance of a dead reservation, so it
   * reported money owed on a booking nobody would honour.
   */
  for (const status of ['cancelled', 'expired'] as const) {
    test(`a payment clearing the bill on a ${status} reservation is refused, not credited`, () => {
      const r = settlementFor(reservation({ status, total: 10000 }), 10000);
      assert.equal(r.refused, true, 'the caller must be told the move was impossible');
      assert.equal(r.secured, false);
      assert.equal(r.next, status, 'a terminal reservation does not move');
    });
  }

  test('a settlement merely not reached yet is NOT refused', () => {
    // The distinction the write path turns on: this one has simply not cleared
    // the bill, so `amountPaid` must still advance.
    const r = settlementFor(reservation({ total: 10000 }), 4000);
    assert.equal(r.secured, false);
    assert.notEqual(r.refused, true);
    assert.equal(r.paid, 4000);
  });
});
