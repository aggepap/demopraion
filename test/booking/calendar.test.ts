import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatDay,
  monthEnd,
  monthOf,
  monthStart,
  shiftMonth,
  type Availability,
  type AvailabilityDay,
} from '@/components/booking/booking-form-types';
import { isKnown, reasonFor } from '@/components/booking/use-availability';

describe('calendar month arithmetic', () => {
  test('shifts within a year', () => {
    assert.equal(shiftMonth('2026-08', 1), '2026-09');
    assert.equal(shiftMonth('2026-08', -1), '2026-07');
    assert.equal(shiftMonth('2026-08', 0), '2026-08');
  });

  test('crosses the year boundary in both directions', () => {
    // The calendar pages one month at a time, so December→January is a normal
    // click and not an edge case anyone would think to try by hand.
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('2026-06', 12), '2027-06');
  });

  test('knows how long each month is, February included', () => {
    assert.equal(monthEnd('2026-01'), '2026-01-31');
    assert.equal(monthEnd('2026-04'), '2026-04-30');
    assert.equal(monthEnd('2026-02'), '2026-02-28');
    assert.equal(monthEnd('2028-02'), '2028-02-29', 'leap year');
    assert.equal(monthEnd('2026-12'), '2026-12-31');
  });

  test('start and month-of round-trip', () => {
    assert.equal(monthStart('2026-08'), '2026-08-01');
    assert.equal(monthOf('2026-08-21'), '2026-08');
    assert.equal(monthOf(monthEnd('2026-08')), '2026-08');
    assert.equal(monthOf(monthStart('2026-08')), '2026-08');
  });
});

/** An availability window covering `from`…`to`, with the listed days present. */
function windowOf(from: string, to: string, days: Partial<AvailabilityDay>[]): Availability {
  return {
    from,
    to,
    rules: null,
    days: new Map(
      days.map((d) => [
        d.date!,
        { date: d.date!, status: d.status ?? 'open', bookable: d.bookable ?? true, remaining: 1 },
      ]),
    ),
  };
}

describe('a day is available, unavailable, or unchecked', () => {
  const availability = windowOf('2026-08-01', '2026-09-30', [
    { date: '2026-08-10', bookable: true },
    { date: '2026-08-11', bookable: false, status: 'full' },
  ]);

  test('a bookable day inside the window is known and has no reason', () => {
    assert.equal(isKnown(availability, '2026-08-10'), true);
    assert.equal(reasonFor(availability, '2026-08-10'), null);
  });

  test('a blocked day inside the window reports why', () => {
    assert.equal(isKnown(availability, '2026-08-11'), true);
    assert.equal(reasonFor(availability, '2026-08-11'), 'full');
  });

  /*
   * The distinction the calendar is built on. `reasonFor` answers null both for
   * "free" and for "never asked", which is right for a form that must not
   * refuse what it has not checked — but painting an unchecked day green would
   * be a promise nobody made, so the calendar needs `isKnown` as well.
   */
  test('a day beyond the fetched window is unchecked, not unavailable', () => {
    assert.equal(isKnown(availability, '2026-12-25'), false);
    assert.equal(reasonFor(availability, '2026-12-25'), null);
  });

  test('a day inside the window the server did not list is unchecked', () => {
    assert.equal(isKnown(availability, '2026-08-12'), false);
    assert.equal(reasonFor(availability, '2026-08-12'), null);
  });

  test('nothing loaded at all leaves every day unchecked and bookable', () => {
    assert.equal(isKnown(null, '2026-08-10'), false);
    assert.equal(reasonFor(null, '2026-08-10'), null);
  });

  test('an empty date is never known', () => {
    assert.equal(isKnown(availability, ''), false);
    assert.equal(reasonFor(availability, ''), null);
  });
});

describe('the fetch window grows to cover the months paged through', () => {
  /*
   * `useAvailability` merges each month's answer into one map and widens
   * `from`/`to` to the union. This asserts the property that matters to
   * `reasonFor`: a date in an earlier-fetched month stays known after a later
   * month arrives, rather than falling outside a window that moved.
   */
  test('a merged window covers both months', () => {
    const august = windowOf('2026-08-01', '2026-09-30', [{ date: '2026-08-10' }]);
    const merged: Availability = {
      ...august,
      to: '2026-11-30',
      days: new Map([...august.days, ['2026-10-05', { date: '2026-10-05', status: 'open', bookable: true, remaining: 1 }]]),
    };
    assert.equal(isKnown(merged, '2026-08-10'), true, 'the first month is still known');
    assert.equal(isKnown(merged, '2026-10-05'), true, 'and so is the newly fetched one');
  });
});

describe('the chosen dates, in words', () => {
  // Fixed "today" so the year rule is testable without freezing the clock.
  const now = new Date(2026, 7, 21);

  test('day and month, in the reader’s language', () => {
    assert.equal(formatDay('2026-08-12', 'en', now), '12 Aug');
    assert.equal(formatDay('2026-08-12', 'el', now), '12 Αυγ');
  });

  test('the year appears only when it is not this one', () => {
    // "12 Aug" is unambiguous for a stay next month; "3 Jan" alone is not, when
    // the January in question is sixteen months out.
    assert.equal(formatDay('2026-12-31', 'en', now), '31 Dec');
    assert.equal(formatDay('2027-01-03', 'en', now), '3 Jan 2027');
    assert.equal(formatDay('2025-12-31', 'en', now), '31 Dec 2025');
  });

  test('an unset or malformed date formats to nothing, not to "Invalid Date"', () => {
    // The summary row renders straight from the selection, which is empty until
    // the visitor picks — and half-empty between the two clicks of a range.
    for (const bad of ['', 'not-a-date', '2026-08']) {
      assert.equal(formatDay(bad, 'en', now), '');
    }
  });
});
