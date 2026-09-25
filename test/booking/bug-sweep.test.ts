/**
 * Regressions from the booking bug sweep — one `describe` per defect, each named
 * for what used to go wrong. Pure functions are exercised directly; the DB-bound
 * wiring (routes, transactions) is checked by reading the source, the pattern
 * the rest of `test/booking` uses for code that needs a live pool.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  combinedDayStatus,
  cutoffFor,
  dayStatus,
  holdConfirmationVerdict,
  isOverCapacity,
  overbookedFrom,
  readAllocationMode,
  slotRequestsForKind,
  type DayRules,
  type DayState,
} from '@/cms/modules/booking/availability';
import { bookedDatesText } from '@/cms/modules/booking/lifecycle';
import {
  markPaidPlan,
  needsAttention,
  withAttention,
  withoutAttention,
} from '@/cms/modules/booking/payment-actions';
import { structuredOfferPrice } from '@/cms/modules/booking/data';
import { reservationsListQuery } from '@/cms/modules/booking/reservations';
import { availabilityParams } from '@/components/booking/booking-form-types';

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

/** The body of one function, up to the next top-level export. */
function fnBody(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = text.indexOf('\nexport ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

const OPEN: DayRules = { window: null, leadTimeHours: 0, maxAdvanceDays: 0, weekdays: null };
const NOW = new Date('2026-07-01T09:00:00Z');
const TZ = 'Europe/Athens';
const day = (over: Partial<DayState> = {}): DayState => ({
  date: '2026-07-15',
  capacity: 10,
  held: 0,
  confirmed: 0,
  closed: false,
  ...over,
});

describe('1. the public calendar reads the slots the booking would hold', () => {
  const base = { bookingGroupId: 'g', resourceGroupId: 'opt', persons: 3, capacityPerDay: 8, resourceCapacityPerDay: 1 };

  test('shared transport with an option chosen reads the experience slot only', () => {
    const reqs = slotRequestsForKind({ ...base, kind: 'transport', allocationMode: 'shared' });
    assert.deepEqual(reqs.map((r) => r.slotKey), ['exp:g']);
  });

  test('exclusive transport with an option chosen reads the experience slot, one of one', () => {
    const reqs = slotRequestsForKind({ ...base, kind: 'transport', allocationMode: 'exclusive' });
    assert.deepEqual(reqs, [{ slotKey: 'exp:g', seats: 1, defaultCapacity: 1 }]);
  });

  test('resource transport reads both', () => {
    const reqs = slotRequestsForKind({ ...base, kind: 'transport', allocationMode: 'resource' });
    assert.deepEqual(reqs.map((r) => r.slotKey), ['exp:g', 'res:opt']);
  });

  test('a stay with an option reads the option', () => {
    const reqs = slotRequestsForKind({ ...base, kind: 'stay', allocationMode: 'shared' });
    assert.deepEqual(reqs, [{ slotKey: 'res:opt', seats: 1, defaultCapacity: 1 }]);
  });

  test('allocation mode is read the way createReservation reads it', () => {
    assert.equal(readAllocationMode({ allocationMode: 'exclusive' }, 'transport'), 'exclusive');
    assert.equal(readAllocationMode({}, 'transport'), 'shared');
    assert.equal(readAllocationMode({ allocationMode: 'nonsense' }, 'transport'), 'shared');
    // Hidden on a stay: leftover transport config is ignored.
    assert.equal(readAllocationMode({ allocationMode: 'exclusive' }, 'stay'), 'resource');
  });

  test('a day is full when ANY slot it needs is full', () => {
    const status = combinedDayStatus(
      [
        { state: day({ capacity: 8, confirmed: 2 }), seats: 3 },
        { state: day({ capacity: 1, confirmed: 1 }), seats: 1 },
      ],
      OPEN,
      NOW,
      TZ,
    );
    assert.equal(status, 'full');
  });

  test('a day every slot can take is open', () => {
    assert.equal(combinedDayStatus([{ state: day(), seats: 3 }], OPEN, NOW, TZ), 'open');
  });

  test('the route builds its requests through slotRequestsForKind, not a hard-coded res: slot', () => {
    const fn = fnBody(read('src/cms/modules/booking/quote.ts'), 'bookingAvailabilityRoute');
    assert.match(fn, /slotRequestsForKind\(/);
    assert.match(fn, /readAllocationMode\(/);
    assert.doesNotMatch(fn, /resourceSlotKey\(option/);
  });
});

describe('2. the booking form asks about its own party size', () => {
  test('transport sends persons', () => {
    const p = availabilityParams({ slug: 's', locale: 'el', from: '2026-07-01', to: '2026-07-31', resourceId: '', persons: 5 });
    assert.equal(p.get('persons'), '5');
    assert.equal(p.has('resourceId'), false);
  });

  test('a stay (no persons) sends none', () => {
    const p = availabilityParams({ slug: 's', locale: 'el', from: '2026-07-01', to: '2026-07-31', resourceId: 'r' });
    assert.equal(p.has('persons'), false);
    assert.equal(p.get('resourceId'), 'r');
  });

  test('the form passes the transport party size to the hook', () => {
    const form = read('src/components/booking/BookingForm.tsx');
    assert.match(form, /useAvailability\([^)]*isStay \? undefined : selection\.persons/);
  });
});

describe('3. a capture only confirms holds that are still live and fit', () => {
  const later = new Date('2026-07-01T10:00:00Z');
  const earlier = new Date('2026-07-01T08:00:00Z');

  test('an unexpired held hold is live', () => {
    assert.equal(holdConfirmationVerdict([{ state: 'held', expiresAt: later }], NOW), 'live');
    assert.equal(holdConfirmationVerdict([{ state: 'held', expiresAt: null }], NOW), 'live');
  });

  test('an expired hold, before the sweep, has lapsed', () => {
    assert.equal(
      holdConfirmationVerdict(
        [
          { state: 'held', expiresAt: later },
          { state: 'held', expiresAt: earlier },
        ],
        NOW,
      ),
      'lapsed',
    );
  });

  test('a released hold, after the sweep, has lapsed', () => {
    assert.equal(holdConfirmationVerdict([{ state: 'released', expiresAt: null }], NOW), 'lapsed');
  });

  test('already-confirmed holds need nothing; no holds at all is reported as such', () => {
    assert.equal(holdConfirmationVerdict([{ state: 'confirmed', expiresAt: null }], NOW), 'confirmed');
    assert.equal(holdConfirmationVerdict([], NOW), 'none');
  });

  test('over capacity means more taken than the slot allows', () => {
    assert.equal(isOverCapacity({ capacity: 4, held: 2, confirmed: 2 }), false);
    assert.equal(isOverCapacity({ capacity: 3, held: 2, confirmed: 2 }), true);
  });

  test('the attention flag round-trips and is detected', () => {
    const flagged = withAttention({ other: 1 }, { reason: 'hold_lapsed', amount: 5000, provider: 'stripe', at: 'x' });
    assert.equal(needsAttention(flagged), true);
    assert.equal(flagged.other, 1);
    const cleared = withoutAttention(flagged);
    assert.equal(needsAttention(cleared), false);
    assert.equal(cleared.other, 1);
    assert.equal(needsAttention(null), false);
  });

  const payments = read('src/cms/modules/booking/payments.ts');
  for (const name of ['recordBookingPayment', 'captureReservationPaymentByRef']) {
    test(`${name} confirms through the checked path and flags a refusal`, () => {
      const fn = fnBody(payments, name);
      assert.doesNotMatch(fn, /\bconfirmHolds\(/, 'the unchecked confirm is back');
      assert.match(fn, /confirmHoldsChecked\(/);
      assert.match(fn, /flagForAttention\(/);
      // The check runs before the balance is credited.
      assert.ok(fn.indexOf('confirmHoldsChecked(') < fn.indexOf('amountPaid: settlement.paid'));
    });
  }

  test('the checked confirm locks the slot rows it confirms', () => {
    const fn = fnBody(read('src/cms/modules/booking/allocation.ts'), 'confirmHoldsChecked');
    assert.match(fn, /\.for\('update'\)/);
    assert.match(fn, /holdConfirmationVerdict\(/);
    assert.match(fn, /isOverCapacity\(/);
  });

  test('"Needs action" includes flagged bookings', () => {
    const fn = fnBody(read('src/cms/modules/booking/reservations.ts'), 'listReservations');
    assert.match(fn, /jsonScalar\(schema\.reservations\.metadata, 'attention\.reason'\)/);
  });
});

describe('4. Mark paid records the money it claims', () => {
  test('an outstanding balance is recorded as a manual payment of that balance', () => {
    assert.deepEqual(markPaidPlan({ status: 'awaiting_payment', total: 10000, amountPaid: 3000 }), {
      kind: 'record',
      amount: 7000,
    });
  });

  test('nothing owed is a plain status move', () => {
    assert.deepEqual(markPaidPlan({ status: 'confirmed', total: 10000, amountPaid: 10000 }), { kind: 'status' });
  });

  test('the update route sends status "paid" through markReservationPaid', () => {
    const fn = fnBody(read('src/cms/modules/booking/reservations.ts'), 'reservationUpdateRoute');
    assert.match(fn, /markReservationPaid\(/);
    const mark = fnBody(read('src/cms/modules/booking/payments.ts'), 'markReservationPaid');
    assert.match(mark, /recordBookingPayment\(/);
    assert.match(mark, /provider: 'manual'/);
    assert.match(mark, /enforceBalance: true/);
  });
});

describe('5. the overbooking check judges every date and ignores lapsed holds', () => {
  test('a date with no capacity override is judged against the slot default', () => {
    const rows = [
      { slotKey: 'exp:a', slotDate: '2026-07-01', taken: 5, capacity: null },
      { slotKey: 'exp:a', slotDate: '2026-07-02', taken: 3, capacity: null },
      { slotKey: 'exp:b', slotDate: '2026-07-01', taken: 3, capacity: 2 },
    ];
    const out = overbookedFrom(rows, (key) => (key === 'exp:a' ? 4 : 10));
    assert.deepEqual(out, [
      { slotKey: 'exp:a', slotDate: '2026-07-01', capacity: 4, taken: 5 },
      { slotKey: 'exp:b', slotDate: '2026-07-01', capacity: 2, taken: 3 },
    ]);
  });

  test('a slot whose default is unknown is only judged by its override', () => {
    const rows = [{ slotKey: 'exp:gone', slotDate: '2026-07-01', taken: 50, capacity: null }];
    assert.deepEqual(overbookedFrom(rows, () => null), []);
  });

  test('the query excludes expired held rows with the app clock', () => {
    const fn = fnBody(read('src/cms/modules/booking/allocation.ts'), 'findOverbookedSlots');
    assert.match(fn, /expiresAt\} > \$\{now\}/);
    assert.match(fn, /overbookedFrom\(/);
  });
});

describe('6. the booking cron secret needs the same length as CMS_CRON_SECRET', () => {
  test('the expiry route authorises through authorizeCronRequest', () => {
    const fn = fnBody(read('src/cms/modules/booking/payments.ts'), 'bookingExpireRoute');
    assert.match(fn, /authorizeCronRequest\(/);
    assert.doesNotMatch(fn, /timingSafeEquals\(/);
  });
});

describe('8. the cut-off is anchored on operator-local midnight', () => {
  test('Athens midnight, in summer (UTC+3)', () => {
    assert.equal(cutoffFor('2026-07-15', 24, TZ).toISOString(), '2026-07-13T21:00:00.000Z');
    assert.equal(cutoffFor('2026-07-15', 0, TZ).toISOString(), '2026-07-14T21:00:00.000Z');
  });

  test('Athens midnight, in winter (UTC+2)', () => {
    assert.equal(cutoffFor('2026-01-15', 0, TZ).toISOString(), '2026-01-14T22:00:00.000Z');
  });

  test('dayStatus uses it: 22:00 UTC on the 13th is already inside a 24h cut-off for the 15th in Athens', () => {
    const rules = { ...OPEN, leadTimeHours: 24 };
    assert.equal(dayStatus(day(), rules, 1, new Date('2026-07-13T21:00:00Z'), TZ), 'open');
    assert.equal(dayStatus(day(), rules, 1, new Date('2026-07-13T22:00:00Z'), TZ), 'too_soon');
  });
});

describe('9. needsAction=false means false', () => {
  test('parses both ways', () => {
    assert.equal(reservationsListQuery.parse({ needsAction: 'false' }).needsAction, false);
    assert.equal(reservationsListQuery.parse({ needsAction: '0' }).needsAction, false);
    assert.equal(reservationsListQuery.parse({ needsAction: 'true' }).needsAction, true);
    assert.equal(reservationsListQuery.parse({ needsAction: '1' }).needsAction, true);
    assert.equal(reservationsListQuery.parse({}).needsAction, undefined);
    assert.equal(reservationsListQuery.safeParse({ needsAction: 'maybe' }).success, false);
  });
});

describe('10. the drawer only offers Cancel where the API would accept it', () => {
  test('the button is gated on canTransition', () => {
    const table = read('src/cms/admin/ReservationsTable.tsx');
    assert.match(table, /canTransition\(detail\.reservation\.status as ReservationStatus, 'cancelled'\)/);
    assert.doesNotMatch(table, /detail\.reservation\.status !== 'cancelled'/);
  });
});

describe('11. a stay is shown as a range everywhere the guest sees it', () => {
  test('transport is one date', () => {
    assert.equal(bookedDatesText({ slotDate: '2026-07-15', endDate: null, nights: 0 }, 'en'), '2026-07-15');
  });

  test('a stay is check-in → check-out with the nights', () => {
    assert.equal(
      bookedDatesText({ slotDate: '2026-07-15', endDate: '2026-07-18', nights: 3 }, 'en'),
      '2026-07-15 → 2026-07-18 (3 nights)',
    );
    assert.equal(
      bookedDatesText({ slotDate: '2026-07-15', endDate: '2026-07-16', nights: 1 }, 'el'),
      '2026-07-15 → 2026-07-16 (1 νύχτα)',
    );
    assert.equal(
      bookedDatesText({ slotDate: '2026-07-15', endDate: '2026-07-18', nights: 3 }, 'el', (d) => `[${d}]`),
      '[2026-07-15] → [2026-07-18] (3 νύχτες)',
    );
  });

  test('email, lookup and pay page all use it', () => {
    assert.match(read('src/cms/modules/booking/emails.ts'), /bookedDatesText\(/);
    assert.match(read('src/app/[locale]/booking/lookup/BookingLookupClient.tsx'), /bookedDatesText\(/);
    assert.match(read('src/app/[locale]/booking/pay/[reference]/page.tsx'), /bookedDatesText\(/);
    const lookup = fnBody(read('src/cms/modules/booking/reservations.ts'), 'lookupReservation');
    assert.match(lookup, /endDate: row\.endDate/);
    assert.match(lookup, /nights: row\.nights/);
  });
});

describe('12. a stay advertises its nightly price in JSON-LD', () => {
  test('stay: the lowest nightly price', () => {
    assert.equal(
      structuredOfferPrice({ kind: 'stay', nightlyRate: 120, seasonalRates: [{ rate: 90 }] }, null),
      90,
    );
  });

  test('stay with nothing priced: no offer', () => {
    assert.equal(structuredOfferPrice({ kind: 'stay' }, null), null);
  });

  test('transport: the base price, as before', () => {
    assert.equal(structuredOfferPrice({ kind: 'transport', basePrice: 50 }, 50), 50);
  });

  test('the experience page uses it', () => {
    assert.match(read('src/app/[locale]/booking/[slug]/page.tsx'), /structuredOfferPrice\(/);
  });
});

describe('14. a Viva refund targets the transaction, not the order code', () => {
  // The rule itself (Viva → metadata.transactionId, else captureId ?? ref) is
  // `refundTargetRef` in core, covered by test/core/refund-target.test.ts.
  test('the booking refund path resolves its target through the shared refundTargetRef', () => {
    const payments = read('src/cms/modules/booking/payments.ts');
    const fn = fnBody(payments, 'refundReservationPayment');
    assert.match(fn, /refundTargetRef\(row\)/);
    assert.doesNotMatch(payments, /refundTargetFor/);
  });

  test('the booking-local duplicate is gone', () => {
    assert.doesNotMatch(read('src/cms/modules/booking/payment-actions.ts'), /function refundTargetFor\(/);
  });
});
