import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  bookingSlotKey,
  canFit,
  cutoffFor,
  dayStatus,
  daysBetween,
  eachDate,
  isHoldExpired,
  readDayRules,
  remainingSeats,
  resolveCapacity,
  resourceSlotKey,
  slotClaimFor,
  slotRequestsFor,
  staySlotRequestsFor,
  todayInTimeZone,
  weekdayOf,
  type DayRules,
  type DayState,
} from '@/cms/modules/booking/availability';

const OPEN_RULES: DayRules = { window: null, leadTimeHours: 0, maxAdvanceDays: 0, weekdays: null };

function day(over: Partial<DayState> = {}): DayState {
  return { date: '2026-07-15', capacity: 10, held: 0, confirmed: 0, closed: false, ...over };
}

/** Fixed "now" so nothing here depends on when the suite runs. */
const NOW = new Date('2026-07-01T09:00:00Z');
const TZ = 'Europe/Athens';

describe('remainingSeats / canFit', () => {
  test('capacity minus what is claimed', () => {
    assert.equal(remainingSeats({ capacity: 10, held: 2, confirmed: 3 }), 5);
  });
  test('an over-allocated slot floors at zero rather than going negative', () => {
    assert.equal(remainingSeats({ capacity: 4, held: 3, confirmed: 5 }), 0);
  });
  test('canFit is inclusive of the last seat', () => {
    assert.equal(canFit({ capacity: 4, held: 2, confirmed: 0 }, 2), true);
    assert.equal(canFit({ capacity: 4, held: 3, confirmed: 0 }, 2), false);
  });
});

describe('todayInTimeZone', () => {
  test('formats as YYYY-MM-DD', () => {
    assert.match(todayInTimeZone(NOW, TZ), /^\d{4}-\d{2}-\d{2}$/);
  });
  test('late UTC evening is already tomorrow in Athens', () => {
    // 23:30 UTC on 14 July is 02:30 on 15 July in Athens (UTC+3 in summer).
    // Filing that booking under the 14th would be a real, silent off-by-one-day.
    assert.equal(todayInTimeZone(new Date('2026-07-14T23:30:00Z'), TZ), '2026-07-15');
    assert.equal(todayInTimeZone(new Date('2026-07-14T23:30:00Z'), 'UTC'), '2026-07-14');
  });
  test('winter and summer differ by the DST offset', () => {
    // Athens is UTC+2 in winter, so 23:30 UTC is still the same day.
    assert.equal(todayInTimeZone(new Date('2026-01-14T23:30:00Z'), TZ), '2026-01-15');
    assert.equal(todayInTimeZone(new Date('2026-01-14T21:30:00Z'), TZ), '2026-01-14');
  });
  test('an invalid timezone falls back instead of throwing', () => {
    assert.match(todayInTimeZone(NOW, 'Not/AZone'), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('date helpers', () => {
  test('daysBetween counts whole days, signed', () => {
    assert.equal(daysBetween('2026-07-01', '2026-07-15'), 14);
    assert.equal(daysBetween('2026-07-15', '2026-07-01'), -14);
    assert.equal(daysBetween('2026-07-01', '2026-07-01'), 0);
  });
  test('daysBetween is unaffected by a DST change in the range', () => {
    // 29 March 2026 is the European spring-forward; a naive hour-based diff
    // would return 30.958… and floor to the wrong day.
    assert.equal(daysBetween('2026-03-01', '2026-04-01'), 31);
  });
  test('weekdayOf reads in UTC', () => {
    assert.equal(weekdayOf('2026-07-15'), 3); // Wednesday
    assert.equal(weekdayOf('2026-07-19'), 0); // Sunday
  });
  test('eachDate is inclusive at both ends', () => {
    assert.deepEqual(eachDate('2026-07-01', '2026-07-03'), ['2026-07-01', '2026-07-02', '2026-07-03']);
  });
  test('eachDate crosses a month and a year boundary', () => {
    assert.deepEqual(eachDate('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
  });
  test('eachDate is capped so a crafted range cannot ask for ten thousand days', () => {
    assert.equal(eachDate('2026-01-01', '2030-01-01').length, 366);
    assert.equal(eachDate('2026-01-01', '2030-01-01', 10).length, 10);
  });
  test('eachDate rejects malformed input rather than looping', () => {
    assert.deepEqual(eachDate('nope', '2026-07-03'), []);
  });
  test('cutoffFor anchors to the start of the booked day', () => {
    assert.equal(cutoffFor('2026-07-15', 24).toISOString(), '2026-07-14T00:00:00.000Z');
    assert.equal(cutoffFor('2026-07-15', 0).toISOString(), '2026-07-15T00:00:00.000Z');
  });
});

describe('dayStatus', () => {
  test('an ordinary future date with room is open', () => {
    assert.equal(dayStatus(day(), OPEN_RULES, 2, NOW, TZ), 'open');
  });
  test('a past date is past', () => {
    assert.equal(dayStatus(day({ date: '2026-06-01' }), OPEN_RULES, 1, NOW, TZ), 'past');
  });
  test('today itself is not past', () => {
    assert.equal(dayStatus(day({ date: todayInTimeZone(NOW, TZ) }), OPEN_RULES, 1, NOW, TZ), 'open');
  });
  test('outside the season', () => {
    const rules = { ...OPEN_RULES, window: { from: '09-01', to: '10-31' } };
    assert.equal(dayStatus(day(), rules, 1, NOW, TZ), 'out_of_season');
  });
  test('inside a season that wraps the new year', () => {
    const rules = { ...OPEN_RULES, window: { from: '11-01', to: '02-28' } };
    const winter = new Date('2026-12-01T09:00:00Z');
    assert.equal(dayStatus(day({ date: '2026-12-20' }), rules, 1, winter, TZ), 'open');
    assert.equal(dayStatus(day({ date: '2027-01-10' }), rules, 1, winter, TZ), 'open');
  });
  test('the wrong weekday', () => {
    // 15 July 2026 is a Wednesday (3); allow only weekends.
    const rules = { ...OPEN_RULES, weekdays: [0, 6] };
    assert.equal(dayStatus(day(), rules, 1, NOW, TZ), 'wrong_weekday');
    assert.equal(dayStatus(day({ date: '2026-07-19' }), rules, 1, NOW, TZ), 'open');
  });
  test('an empty weekday list means every day, not no days', () => {
    assert.equal(dayStatus(day(), { ...OPEN_RULES, weekdays: [] }, 1, NOW, TZ), 'open');
  });
  test('too far ahead', () => {
    const rules = { ...OPEN_RULES, maxAdvanceDays: 7 };
    assert.equal(dayStatus(day(), rules, 1, NOW, TZ), 'too_far');
    assert.equal(dayStatus(day({ date: '2026-07-05' }), rules, 1, NOW, TZ), 'open');
  });
  test('inside the lead-time cut-off', () => {
    const rules = { ...OPEN_RULES, leadTimeHours: 48 };
    // Booking the 2nd at 09:00 on the 1st is inside a 48-hour cut-off.
    assert.equal(dayStatus(day({ date: '2026-07-02' }), rules, 1, NOW, TZ), 'too_soon');
    assert.equal(dayStatus(day({ date: '2026-07-10' }), rules, 1, NOW, TZ), 'open');
  });
  test('exactly at the cut-off instant is still bookable', () => {
    const rules = { ...OPEN_RULES, leadTimeHours: 24 };
    // Midnight on the 15th in Athens (UTC+3 in July) is 21:00Z on the 14th, so
    // a 24-hour cut-off falls at 21:00Z on the 13th — not UTC midnight.
    const atCutoff = new Date('2026-07-13T21:00:00Z');
    assert.equal(dayStatus(day(), rules, 1, atCutoff, TZ), 'open');
    assert.equal(dayStatus(day(), rules, 1, new Date('2026-07-13T21:00:01Z'), TZ), 'too_soon');
  });
  test('a blacked-out date is closed', () => {
    assert.equal(dayStatus(day({ closed: true }), OPEN_RULES, 1, NOW, TZ), 'closed');
  });
  test('no room left is full', () => {
    assert.equal(dayStatus(day({ capacity: 4, confirmed: 4 }), OPEN_RULES, 1, NOW, TZ), 'full');
  });
  test('a party larger than the remaining seats is full', () => {
    assert.equal(dayStatus(day({ capacity: 10, confirmed: 9 }), OPEN_RULES, 2, NOW, TZ), 'full');
  });

  /*
   * The reason given must be the most fundamental one. Telling someone a date is
   * "sold out" when it is also out of season sends them back tomorrow to try again.
   */
  test('out-of-season beats sold-out', () => {
    const rules = { ...OPEN_RULES, window: { from: '09-01', to: '10-31' } };
    assert.equal(dayStatus(day({ capacity: 1, confirmed: 1 }), rules, 1, NOW, TZ), 'out_of_season');
  });
  test('past beats everything', () => {
    const rules = { ...OPEN_RULES, window: { from: '09-01', to: '10-31' }, leadTimeHours: 48 };
    assert.equal(dayStatus(day({ date: '2026-01-01', closed: true }), rules, 1, NOW, TZ), 'past');
  });
  test('a lead-time miss is not reported as sold out', () => {
    const rules = { ...OPEN_RULES, leadTimeHours: 48 };
    assert.equal(dayStatus(day({ date: '2026-07-02', capacity: 1, confirmed: 1 }), rules, 1, NOW, TZ), 'too_soon');
  });
});

describe('slotRequestsFor', () => {
  const base = { bookingGroupId: 'grp-exp', persons: 4, capacityPerDay: 8 };

  test('shared: the party consumes seats on the item slot', () => {
    const reqs = slotRequestsFor({ ...base, allocationMode: 'shared' });
    assert.deepEqual(reqs, [{ slotKey: 'exp:grp-exp', seats: 4, defaultCapacity: 8 }]);
  });

  test('exclusive: one seat of one, whatever the party size', () => {
    // A 1-person and a 12-person booking are equally blocking.
    const solo = slotRequestsFor({ ...base, persons: 1, allocationMode: 'exclusive' });
    const group = slotRequestsFor({ ...base, persons: 12, allocationMode: 'exclusive' });
    assert.deepEqual(solo, [{ slotKey: 'exp:grp-exp', seats: 1, defaultCapacity: 1 }]);
    assert.deepEqual(group, solo);
  });

  test('resource: the item slot AND the resource slot are both consumed', () => {
    const reqs = slotRequestsFor({
      ...base,
      allocationMode: 'resource',
      resourceGroupId: 'grp-yacht',
      resourceCapacityPerDay: 1,
    });
    assert.deepEqual(reqs, [
      { slotKey: 'exp:grp-exp', seats: 4, defaultCapacity: 8 },
      { slotKey: 'res:grp-yacht', seats: 1, defaultCapacity: 1 },
    ]);
  });

  test('resource mode with no resource chosen falls back to the item slot alone', () => {
    const reqs = slotRequestsFor({ ...base, allocationMode: 'resource', resourceGroupId: '' });
    assert.deepEqual(reqs, [{ slotKey: 'exp:grp-exp', seats: 4, defaultCapacity: 8 }]);
  });

  /*
   * Sorted order is not cosmetic: two concurrent reservations touching the same
   * item and resource would deadlock if one locked item→resource and the other
   * resource→item.
   */
  test('requests are always in a stable lock order', () => {
    const reqs = slotRequestsFor({
      allocationMode: 'resource',
      bookingGroupId: 'zzz',
      resourceGroupId: 'aaa',
      persons: 2,
      capacityPerDay: 5,
      resourceCapacityPerDay: 1,
    });
    assert.deepEqual(reqs.map((r) => r.slotKey), ['exp:zzz', 'res:aaa']);
    const keys = reqs.map((r) => r.slotKey);
    assert.deepEqual([...keys].sort(), keys);
  });

  test('capacities and party sizes are floored to sane integers', () => {
    const reqs = slotRequestsFor({ ...base, persons: 0, capacityPerDay: 0, allocationMode: 'shared' });
    assert.deepEqual(reqs, [{ slotKey: 'exp:grp-exp', seats: 1, defaultCapacity: 1 }]);
  });

  test('slot keys namespace items and resources apart', () => {
    assert.equal(bookingSlotKey('x'), 'exp:x');
    assert.equal(resourceSlotKey('x'), 'res:x');
    assert.notEqual(bookingSlotKey('x'), resourceSlotKey('x'));
  });
});

/*
 * `slotClaimFor` is the operator-accept path's half of the ledger: a `pending`
 * enquiry holds nothing, so accepting it is where the date is actually claimed —
 * and it must claim EXACTLY what `createReservation` would have, working from
 * the stored row instead of the resolved document.
 */
describe('slotClaimFor — reclaiming from a stored reservation', () => {
  const transport = {
    allocationMode: 'shared' as const,
    bookingGroupId: 'grp-exp',
    resourceGroupId: '',
    persons: 4,
    capacityPerDay: 8,
    slotDate: '2026-07-15',
    endDate: null,
    nights: 0,
  };

  test('transport claims the single date, with the same requests as the create path', () => {
    const claim = slotClaimFor(transport);
    assert.deepEqual(claim.slotDates, ['2026-07-15']);
    assert.deepEqual(claim.requests, slotRequestsFor(transport));
  });

  test("the experience's own capacity is what limits the accept, not the site default", () => {
    // The bug this exists to stop: a capacity-1 experience accepted twice
    // because the accept path reached for the site-wide default instead.
    const claim = slotClaimFor({ ...transport, persons: 1, capacityPerDay: 1 });
    assert.deepEqual(claim.requests, [{ slotKey: 'exp:grp-exp', seats: 1, defaultCapacity: 1 }]);
  });

  test('every transport allocation mode keeps its meaning', () => {
    const exclusive = slotClaimFor({ ...transport, allocationMode: 'exclusive' });
    assert.deepEqual(exclusive.requests, [{ slotKey: 'exp:grp-exp', seats: 1, defaultCapacity: 1 }]);

    const resource = slotClaimFor({
      ...transport,
      allocationMode: 'resource',
      resourceGroupId: 'grp-yacht',
      resourceCapacityPerDay: 1,
    });
    assert.deepEqual(resource.requests, [
      { slotKey: 'exp:grp-exp', seats: 4, defaultCapacity: 8 },
      { slotKey: 'res:grp-yacht', seats: 1, defaultCapacity: 1 },
    ]);
  });

  const stay = {
    // A stay is stored with `allocationMode: 'resource'`, but the nights are
    // what identify it — matching the schema's own "0 nights means transport".
    allocationMode: 'resource' as const,
    bookingGroupId: 'grp-hotel',
    resourceGroupId: 'opt-suite',
    resourceCapacityPerDay: 1,
    persons: 3,
    capacityPerDay: 5,
    slotDate: '2026-08-14',
    endDate: '2026-08-17',
    nights: 3,
  };

  test('a stay claims one seat of its unit, per night, never the party size', () => {
    const claim = slotClaimFor(stay);
    assert.deepEqual(claim.requests, staySlotRequestsFor(stay));
    assert.deepEqual(claim.requests, [{ slotKey: 'res:opt-suite', seats: 1, defaultCapacity: 1 }]);
  });

  test('a stay claims every night it occupies, not just the check-in date', () => {
    // Accepting only the 14th left the 15th and 16th free for someone else.
    assert.deepEqual(slotClaimFor(stay).slotDates, ['2026-08-14', '2026-08-15', '2026-08-16']);
  });

  test('the departure date is never claimed', () => {
    assert.ok(!slotClaimFor(stay).slotDates.includes('2026-08-17'));
  });

  test('a stay with no option holds the experience itself as the unit', () => {
    const claim = slotClaimFor({ ...stay, resourceGroupId: '', capacityPerDay: 2 });
    assert.deepEqual(claim.requests, [{ slotKey: 'exp:grp-hotel', seats: 1, defaultCapacity: 2 }]);
  });

  test('a stay whose range is unusable still claims its check-in night', () => {
    // Claiming nothing would be worse than claiming too little: the accept
    // would report success having taken no date at all.
    assert.deepEqual(slotClaimFor({ ...stay, endDate: null }).slotDates, ['2026-08-14']);
    assert.deepEqual(slotClaimFor({ ...stay, endDate: '2026-08-14' }).slotDates, ['2026-08-14']);
    assert.deepEqual(slotClaimFor({ ...stay, endDate: 'nonsense' }).slotDates, ['2026-08-14']);
  });

  test('requests stay in the lock order the allocator depends on', () => {
    const claim = slotClaimFor({
      ...transport,
      allocationMode: 'resource',
      bookingGroupId: 'zzz',
      resourceGroupId: 'aaa',
      resourceCapacityPerDay: 1,
    });
    const keys = claim.requests.map((r) => r.slotKey);
    assert.deepEqual([...keys].sort(), keys);
  });
});

describe('resolveCapacity', () => {
  test('no override uses the document default', () => {
    assert.deepEqual(resolveCapacity(8, null), { capacity: 8, closed: false });
  });
  test('a null capacity on an existing row still inherits', () => {
    assert.deepEqual(resolveCapacity(8, { capacity: null, closed: false }), { capacity: 8, closed: false });
  });
  test('an override replaces the default', () => {
    assert.deepEqual(resolveCapacity(8, { capacity: 2, closed: false }), { capacity: 2, closed: false });
  });
  test('closed is carried through even with an inherited capacity', () => {
    assert.deepEqual(resolveCapacity(8, { capacity: null, closed: true }), { capacity: 8, closed: true });
  });
  test('a zero override is honoured — it means nobody, not "unset"', () => {
    assert.deepEqual(resolveCapacity(8, { capacity: 0, closed: false }), { capacity: 0, closed: false });
  });
});

describe('isHoldExpired', () => {
  test('null never expires', () => {
    assert.equal(isHoldExpired(null, NOW), false);
  });
  test('past expires, future does not', () => {
    assert.equal(isHoldExpired(new Date('2026-06-30T00:00:00Z'), NOW), true);
    assert.equal(isHoldExpired(new Date('2026-07-02T00:00:00Z'), NOW), false);
  });
  test('exactly now counts as expired', () => {
    assert.equal(isHoldExpired(NOW, NOW), true);
  });
});

describe('readDayRules', () => {
  test('an empty document is open all year with the site default lead time', () => {
    assert.deepEqual(readDayRules({}, { leadTimeHours: 24 }), {
      window: null,
      leadTimeHours: 24,
      maxAdvanceDays: 0,
      weekdays: null,
    });
  });
  test('reads the window, cut-off, horizon and weekdays', () => {
    const rules = readDayRules(
      { availableFrom: '04-01', availableTo: '10-31', leadTimeHours: 48, maxAdvanceDays: 90, weekdays: ['1', '6'] },
      { leadTimeHours: 24 },
    );
    assert.deepEqual(rules.window, { from: '04-01', to: '10-31' });
    assert.equal(rules.leadTimeHours, 48);
    assert.equal(rules.maxAdvanceDays, 90);
    assert.deepEqual(rules.weekdays, [1, 6]);
  });
  test('a lead time of 0 overrides the site default rather than falling back to it', () => {
    assert.equal(readDayRules({ leadTimeHours: 0 }, { leadTimeHours: 24 }).leadTimeHours, 0);
  });
  test('half a window is no window — one date alone cannot bound a season', () => {
    assert.equal(readDayRules({ availableFrom: '04-01' }, { leadTimeHours: 0 }).window, null);
  });
  test('junk weekdays are discarded', () => {
    assert.equal(readDayRules({ weekdays: ['x', 9, -1] }, { leadTimeHours: 0 }).weekdays, null);
  });
});

/*
 * Guards `allocation.ts`, which cannot be imported here: it pulls in
 * `server-only` and a live pool. The invariant is worth a source read anyway,
 * because breaking it fails silently and in the overbooking direction.
 *
 * `reservation_holds.expires_at` is written by the app, formatted in the NODE
 * process's timezone (mysql2 defaults to `timezone: 'local'`). A clock the
 * DATABASE evaluates — `NOW()`, `CURRENT_TIMESTAMP` — reads in the MySQL
 * session's zone instead. The round trip through JS cancels its own conversion
 * and is safe; a comparison decided inside SQL does not, and skews by the offset
 * between the two. With the session ahead of the process, live holds read as
 * expired: a 20-minute payment hold under a 3-hour skew is born expired, stops
 * counting the moment it is written, and the seat it paid for is sold twice.
 *
 * Every other expiry check in the module already binds a JS `Date` as a
 * parameter (`gt(expiresAt, now)`), which is exactly what makes them immune.
 */
test('the seat ledger never asks the database what time it is', () => {
  const source = readFileSync(
    new URL('../../src/cms/modules/booking/allocation.ts', import.meta.url),
    'utf8',
  );
  // Comments strip out first: the invariant is about what runs, and the reason
  // it exists is written above `readUsage` in the words it bans.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  assert.equal(/\bNOW\s*\(\)/i.test(code), false, 'allocation.ts must not call SQL NOW()');
  assert.equal(/\bCURRENT_TIMESTAMP\b/i.test(code), false, 'allocation.ts must not use CURRENT_TIMESTAMP');
  assert.equal(/\bUTC_TIMESTAMP\s*\(\)/i.test(code), false, 'a UTC server clock is still a server clock');
});
