/**
 * The stay price engine.
 *
 * The invariants worth stating up front, because everything else follows:
 *   · a stay occupies check-in through the night BEFORE check-out;
 *   · consecutive nights at one rate collapse into ONE breakdown line;
 *   · lines always sum to the total, in minor units.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  readStayRules,
  slotDatePairs,
  stayNights,
  staySlotRequestsFor,
  stayStatus,
  type DayState,
} from '@/cms/modules/booking/availability';
import type { ExtrasConfig } from '@/cms/modules/booking/pricing';
import {
  maxOccupancyFor,
  minNightsFor,
  quoteStay,
  readStayConfig,
  validateStayConfig,
  type StayPricing,
  type StayQuote,
} from '@/cms/modules/booking/stay';

const NO_EXTRAS: ExtrasConfig = {
  enabled: false,
  multiplyPerPerson: false,
  mandatory: false,
  options: [],
};

function cfg(over: Partial<StayPricing> = {}): StayPricing {
  return {
    nightlyRate: 100,
    currency: 'EUR',
    seasonalRates: [],
    minNights: 1,
    maxNights: 0,
    baseOccupancy: 2,
    maxOccupancy: 0,
    extraGuestPerNight: 0,
    childrenEnabled: false,
    childMaxAge: 12,
    childPerNight: 0,
    fees: [],
    options: [],
    extras: NO_EXTRAS,
    extrasPerNight: false,
    ...over,
  };
}

/** Assert a quote succeeded, and hand back the narrowed value. */
function quoted(result: ReturnType<typeof quoteStay>): StayQuote {
  assert.equal(result.ok, true, `expected a quote, got ${result.ok ? '' : result.reason}`);
  return result as StayQuote;
}

/** Every breakdown line must add up to the total. Checked on every quote. */
function assertLinesSumToTotal(q: StayQuote): void {
  const sum = q.lines.reduce((n, l) => n + l.amount, 0);
  assert.equal(sum, q.total, 'breakdown lines do not sum to the total');
  q.lines.forEach((l) => assert.equal(l.unitAmount * l.quantity, l.amount, `line ${l.code} does not multiply out`));
}

describe('stayNights', () => {
  test('the check-out night is NOT occupied', () => {
    // 14 -> 17 August is three nights. Holding the 17th would block the next
    // guest from arriving on the day the room is genuinely free.
    assert.deepEqual(stayNights('2026-08-14', '2026-08-17'), ['2026-08-14', '2026-08-15', '2026-08-16']);
  });

  test('one night is one date', () => {
    assert.deepEqual(stayNights('2026-08-14', '2026-08-15'), ['2026-08-14']);
  });

  test('a range that is not a range is no nights', () => {
    assert.deepEqual(stayNights('2026-08-14', '2026-08-14'), []);
    assert.deepEqual(stayNights('2026-08-17', '2026-08-14'), []);
    assert.deepEqual(stayNights('nonsense', '2026-08-14'), []);
  });

  test('it crosses a month and a year boundary', () => {
    assert.deepEqual(stayNights('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01']);
  });
});

describe('quoteStay — the nightly rate', () => {
  test('a flat rate is one line, priced per night', () => {
    const q = quoted(quoteStay(cfg(), { checkIn: '2026-08-14', checkOut: '2026-08-17' }));
    assert.equal(q.nights, 3);
    assert.equal(q.total, 30_000);
    assert.equal(q.lines.length, 1);
    assert.equal(q.lines[0].quantity, 3);
    assert.equal(q.lines[0].unitAmount, 10_000);
    assert.match(q.lines[0].label, /3 nights/);
    assertLinesSumToTotal(q);
  });

  test('seven nights in one season stay ONE line, not seven', () => {
    const q = quoted(
      quoteStay(cfg({ seasonalRates: [{ from: '07-01', to: '08-31', rate: 260 }] }), {
        checkIn: '2026-08-01',
        checkOut: '2026-08-08',
      }),
    );
    assert.equal(q.lines.length, 1);
    assert.equal(q.lines[0].quantity, 7);
    assert.equal(q.total, 7 * 26_000);
    assertLinesSumToTotal(q);
  });

  test('a stay straddling a season boundary is TWO lines that explain the total', () => {
    // 30, 31 Aug at 260; 1, 2 Sep at 100.
    const q = quoted(
      quoteStay(cfg({ seasonalRates: [{ from: '07-01', to: '08-31', rate: 260 }] }), {
        checkIn: '2026-08-30',
        checkOut: '2026-09-03',
      }),
    );
    assert.equal(q.nights, 4);
    assert.equal(q.lines.length, 2);
    assert.deepEqual(q.lines.map((l) => [l.quantity, l.unitAmount]), [[2, 26_000], [2, 10_000]]);
    assert.equal(q.total, 2 * 26_000 + 2 * 10_000);
    assertLinesSumToTotal(q);
  });

  test('a season that wraps the new year prices both sides', () => {
    const q = quoted(
      quoteStay(cfg({ seasonalRates: [{ from: '12-20', to: '01-05', rate: 300 }] }), {
        checkIn: '2026-12-30',
        checkOut: '2027-01-02',
      }),
    );
    assert.equal(q.lines.length, 1);
    assert.equal(q.lines[0].quantity, 3);
    assert.equal(q.total, 3 * 30_000);
  });

  test('no rate at all is "on request", not free', () => {
    const r = quoteStay(cfg({ nightlyRate: null }), { checkIn: '2026-08-14', checkOut: '2026-08-17' });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'price_on_request');
  });
});

describe('quoteStay — options', () => {
  const withOptions = cfg({
    nightlyRate: 180,
    options: [
      { id: 'suite', label: 'Sea View Suite', cost: 260, seats: 4 },
      { id: 'studio', label: 'Garden Studio', cost: 140, seats: 2 },
    ],
  });

  test('a chosen option REPLACES the nightly rate', () => {
    const q = quoted(quoteStay(withOptions, { checkIn: '2026-08-14', checkOut: '2026-08-16', optionId: 'studio' }));
    assert.equal(q.total, 2 * 14_000);
    assert.equal(q.lines[0].refId, 'studio');
    assert.match(q.lines[0].label, /Garden Studio/);
  });

  test('no option chosen falls back to the experience rate', () => {
    const q = quoted(quoteStay(withOptions, { checkIn: '2026-08-14', checkOut: '2026-08-16' }));
    assert.equal(q.total, 2 * 18_000);
  });

  test("an option's own season replaces its own flat cost", () => {
    const config = cfg({
      options: [{ id: 'suite', label: 'Suite', cost: 200, seasonal: [{ from: '08-01', to: '08-31', cost: 350 }] }],
    });
    const q = quoted(quoteStay(config, { checkIn: '2026-08-14', checkOut: '2026-08-16', optionId: 'suite' }));
    assert.equal(q.total, 2 * 35_000);
  });

  test('an unknown option is refused, never silently ignored', () => {
    const r = quoteStay(withOptions, { checkIn: '2026-08-14', checkOut: '2026-08-16', optionId: 'ghost' });
    assert.equal(r.ok === false && r.reason, 'unknown_resource');
  });
});

describe('quoteStay — nights rules', () => {
  test('below the minimum is refused, with the minimum stated', () => {
    const r = quoteStay(cfg({ minNights: 3 }), { checkIn: '2026-08-14', checkOut: '2026-08-16' });
    assert.equal(r.ok === false && r.reason, 'min_nights');
    assert.equal(r.ok === false && r.reason === 'min_nights' && r.minNights, 3);
  });

  test('above the maximum is refused', () => {
    const r = quoteStay(cfg({ maxNights: 2 }), { checkIn: '2026-08-14', checkOut: '2026-08-20' });
    assert.equal(r.ok === false && r.reason, 'max_nights');
  });

  test('a seasonal minimum applies to the ARRIVAL date only', () => {
    // Arriving 1 Aug into a 7-night August season needs 7 nights…
    const config = cfg({ seasonalRates: [{ from: '08-01', to: '08-31', rate: 260, minNights: 7 }] });
    assert.equal(minNightsFor(config, '2026-08-01'), 7);
    assert.equal(quoteStay(config, { checkIn: '2026-08-01', checkOut: '2026-08-04' }).ok, false);
    assert.equal(quoteStay(config, { checkIn: '2026-08-01', checkOut: '2026-08-08' }).ok, true);

    // …but arriving 29 July and running INTO August keeps July's minimum. A
    // rule that changed depending on how long you stayed would be unexplainable.
    assert.equal(minNightsFor(config, '2026-07-29'), 1);
    assert.equal(quoteStay(config, { checkIn: '2026-07-29', checkOut: '2026-08-02' }).ok, true);
  });

  test('missing or backwards dates are told apart', () => {
    assert.equal((quoteStay(cfg(), {}) as { reason: string }).reason, 'missing_dates');
    assert.equal(
      (quoteStay(cfg(), { checkIn: '2026-08-17', checkOut: '2026-08-14' }) as { reason: string }).reason,
      'invalid_range',
    );
  });
});

describe('quoteStay — occupancy', () => {
  test('guests above the included count are charged per guest, per night', () => {
    const q = quoted(
      quoteStay(cfg({ baseOccupancy: 2, extraGuestPerNight: 25 }), {
        checkIn: '2026-08-14',
        checkOut: '2026-08-17',
        adults: 4,
      }),
    );
    const extra = q.lines.find((l) => l.code === 'extra_guests');
    assert.equal(extra?.quantity, 2 * 3);
    assert.equal(extra?.amount, 2 * 3 * 2_500);
    assert.equal(q.total, 30_000 + 15_000);
    assert.equal(q.persons, 4);
    assertLinesSumToTotal(q);
  });

  test('guests at or below the included count add nothing', () => {
    const q = quoted(
      quoteStay(cfg({ baseOccupancy: 2, extraGuestPerNight: 25 }), {
        checkIn: '2026-08-14',
        checkOut: '2026-08-17',
        adults: 2,
      }),
    );
    assert.equal(q.lines.some((l) => l.code === 'extra_guests'), false);
  });

  test('children are their own line and never displace an included adult', () => {
    const q = quoted(
      quoteStay(cfg({ baseOccupancy: 2, extraGuestPerNight: 25, childrenEnabled: true, childPerNight: 10 }), {
        checkIn: '2026-08-14',
        checkOut: '2026-08-16',
        adults: 2,
        children: 2,
      }),
    );
    assert.equal(q.lines.some((l) => l.code === 'extra_guests'), false);
    const kids = q.lines.find((l) => l.code === 'children');
    assert.equal(kids?.quantity, 2 * 2);
    assert.equal(kids?.amount, 4 * 1_000);
    assert.equal(q.persons, 4);
    assertLinesSumToTotal(q);
  });

  test('children are ignored entirely when the experience does not take them', () => {
    const q = quoted(
      quoteStay(cfg({ childrenEnabled: false, childPerNight: 0 }), {
        checkIn: '2026-08-14',
        checkOut: '2026-08-16',
        adults: 2,
        children: 3,
      }),
    );
    assert.equal(q.persons, 2);
  });

  test('over the maximum is REFUSED, not quietly trimmed', () => {
    // Clamping would quote a price for a booking nobody asked for, and the
    // party would only find out on arrival.
    const r = quoteStay(cfg({ maxOccupancy: 4 }), {
      checkIn: '2026-08-14',
      checkOut: '2026-08-16',
      adults: 6,
    });
    assert.equal(r.ok === false && r.reason, 'over_occupancy');
  });

  test("the chosen option's seats cap occupancy when the experience sets none", () => {
    const config = cfg({ maxOccupancy: 0, options: [{ id: 'studio', label: 'Studio', cost: 140, seats: 2 }] });
    assert.equal(maxOccupancyFor(config, config.options[0]), 2);
    const r = quoteStay(config, { checkIn: '2026-08-14', checkOut: '2026-08-16', optionId: 'studio', adults: 4 });
    assert.equal(r.ok === false && r.reason, 'over_occupancy');
  });
});

describe('quoteStay — fees and taxes', () => {
  const base = { checkIn: '2026-08-14', checkOut: '2026-08-17' }; // 3 nights

  test('each basis multiplies by the right thing', () => {
    const q = quoted(
      quoteStay(
        cfg({
          fees: [
            { id: 'clean', label: 'Cleaning', amount: 60, basis: 'per_stay' },
            { id: 'linen', label: 'Linen', amount: 5, basis: 'per_night' },
            { id: 'welcome', label: 'Welcome pack', amount: 8, basis: 'per_person' },
            { id: 'tax', label: 'Tourist tax', amount: 1.5, basis: 'per_person_per_night' },
          ],
        }),
        { ...base, adults: 2 },
      ),
    );
    const by = (code: string) => q.lines.find((l) => l.code === code);
    assert.equal(by('fee:clean')?.quantity, 1);
    assert.equal(by('fee:linen')?.quantity, 3);
    assert.equal(by('fee:welcome')?.quantity, 2);
    assert.equal(by('fee:tax')?.quantity, 6);
    assert.equal(by('fee:tax')?.amount, 6 * 150);
    assertLinesSumToTotal(q);
  });

  test('fees are their own lines, so the guest sees what they are paying for', () => {
    const q = quoted(
      quoteStay(cfg({ fees: [{ id: 'clean', label: 'Cleaning', amount: 60, basis: 'per_stay' }] }), base),
    );
    assert.equal(q.lines.length, 2);
    assert.equal(q.lines[1].kind, 'surcharge');
    assert.equal(q.lines[1].label, 'Cleaning');
    assert.equal(q.total, 30_000 + 6_000);
  });

  /* Every fee line has to say WHAT it is and WHAT it multiplies by. The guest
   * screenshot that motivated this read "Fee × 7 — 1.400,00 €": an unnamed
   * charge, a 7 that could have been nights or guests, and no unit price. */
  test('a fee line names what it multiplies by', () => {
    const q = quoted(
      quoteStay(
        cfg({
          fees: [
            { id: 'linen', label: 'Linen', amount: 5, basis: 'per_night' },
            { id: 'welcome', label: 'Welcome pack', amount: 8, basis: 'per_person' },
            { id: 'tax', label: 'Tourist tax', amount: 1.5, basis: 'per_person_per_night' },
          ],
        }),
        { ...base, adults: 2 },
      ),
    );
    const by = (code: string) => q.lines.find((l) => l.code === code)?.label;
    assert.equal(by('fee:linen'), 'Linen — 3 nights');
    assert.equal(by('fee:welcome'), 'Welcome pack — 2 guests');
    assert.equal(by('fee:tax'), 'Tourist tax — 2 guests × 3 nights');
  });

  test('a zero fee produces no line at all', () => {
    const q = quoted(quoteStay(cfg({ fees: [{ id: 'x', label: 'Nothing', amount: 0, basis: 'per_stay' }] }), base));
    assert.equal(q.lines.length, 1);
  });
});

describe('quoteStay — extras', () => {
  const extras: ExtrasConfig = {
    enabled: true,
    multiplyPerPerson: false,
    mandatory: false,
    options: [{ id: 'boat', name: 'Boat trip', price: 50 }],
  };
  const base = { checkIn: '2026-08-14', checkOut: '2026-08-17', adults: 2, extraIds: ['boat'] };

  test('once per booking by default', () => {
    const q = quoted(quoteStay(cfg({ extras }), base));
    assert.equal(q.lines.find((l) => l.code === 'extra:boat')?.quantity, 1);
  });

  test('per night when the experience says so', () => {
    const q = quoted(quoteStay(cfg({ extras, extrasPerNight: true }), base));
    const line = q.lines.find((l) => l.code === 'extra:boat');
    assert.equal(line?.quantity, 3);
    // The label carries the COUNT, not just the basis: the breakdown renders it
    // against the unit price, so "3 nights" is what makes the row add up.
    assert.match(String(line?.label), /3 nights/);
  });

  test('per guest and per night compose', () => {
    const q = quoted(
      quoteStay(cfg({ extras: { ...extras, multiplyPerPerson: true }, extrasPerNight: true }), base),
    );
    assert.equal(q.lines.find((l) => l.code === 'extra:boat')?.quantity, 2 * 3);
    assertLinesSumToTotal(q);
  });

  test('an unknown extra is refused', () => {
    const r = quoteStay(cfg({ extras }), { ...base, extraIds: ['ghost'] });
    assert.equal(r.ok === false && r.reason, 'unknown_extra');
  });

  test('a mandatory extra with none chosen is refused', () => {
    const r = quoteStay(cfg({ extras: { ...extras, mandatory: true } }), { ...base, extraIds: [] });
    assert.equal(r.ok === false && r.reason, 'extra_required');
  });
});

describe('validateStayConfig', () => {
  const codes = (c: StayPricing) => validateStayConfig(c).map((i) => i.code);

  test('a coherent config reports nothing', () => {
    assert.deepEqual(codes(cfg()), []);
  });

  test('overlapping seasons are refused rather than resolved by row order', () => {
    assert.equal(
      codes(cfg({ seasonalRates: [{ from: '06-01', to: '08-31', rate: 1 }, { from: '08-01', to: '09-30', rate: 2 }] })).includes(
        'season_overlap',
      ),
      true,
    );
  });

  test('impossible night and occupancy ranges are caught', () => {
    assert.equal(codes(cfg({ minNights: 5, maxNights: 3 })).includes('nights_range'), true);
    assert.equal(codes(cfg({ baseOccupancy: 4, maxOccupancy: 2 })).includes('occupancy_range'), true);
  });

  test('an extra-guest charge nobody could ever pay is caught', () => {
    assert.equal(
      codes(cfg({ baseOccupancy: 2, maxOccupancy: 2, extraGuestPerNight: 25 })).includes('extra_guest_unreachable'),
      true,
    );
  });

  test('a child rate with children turned off is stale config, not a silent no-op', () => {
    assert.equal(codes(cfg({ childrenEnabled: false, childPerNight: 10 })).includes('child_rate_disabled'), true);
  });

  test('transport party-size brackets left on a stay are reported', () => {
    // Dead configuration nobody can see is dead — the same shape of bug the
    // transport engine already refuses.
    const stale = cfg({
      options: [
        {
          id: 'a',
          label: 'Suite',
          cost: 100,
          seasonal: [{ from: '06-01', to: '08-31', cost: 1, perPerson: true, brackets: [{ min: 1, max: 4, cost: 9 }] }],
        },
      ],
    });
    assert.equal(codes(stale).includes('brackets_on_stay'), true);
  });

  test('a bad config refuses the quote instead of guessing a price', () => {
    const r = quoteStay(cfg({ minNights: 5, maxNights: 3 }), { checkIn: '2026-08-14', checkOut: '2026-08-17' });
    assert.equal(r.ok === false && r.reason, 'invalid_config');
  });

  test('a duplicated option id is reported', () => {
    const dup = cfg({
      options: [
        { id: 'same', label: 'A', cost: 1 },
        { id: 'same', label: 'B', cost: 2 },
      ],
    });
    assert.equal(codes(dup).includes('resource_duplicate'), true);
  });
});

describe('readStayConfig', () => {
  test('an empty document yields a usable, on-request config', () => {
    const c = readStayConfig({}, [], NO_EXTRAS);
    assert.equal(c.nightlyRate, null);
    assert.equal(c.minNights, 1);
    assert.equal(c.baseOccupancy, 2);
    assert.deepEqual(validateStayConfig(c), []);
  });

  test('an empty rate string is "on request", not zero', () => {
    assert.equal(readStayConfig({ nightlyRate: '' }, [], NO_EXTRAS).nightlyRate, null);
  });

  test('fee rows keep their basis and get an id even when unsaved', () => {
    const c = readStayConfig({ fees: [{ label: 'Cleaning', amount: 60, basis: 'per_night' }] }, [], NO_EXTRAS);
    assert.equal(c.fees[0].basis, 'per_night');
    assert.equal(typeof c.fees[0].id, 'string');
    assert.notEqual(c.fees[0].id, '');
  });

  /* The fee name is `localized: true` inside a `shared: true` repeater, so it is
   * stored as a `{ locale: value }` map. Read as a plain string it came out
   * empty and every fee line said "Fee". */
  test('a localized fee name is resolved for the locale', () => {
    const fees = [{ id: 'clean', label: { el: 'Καθαριότητα', en: 'Cleaning' }, amount: 60, basis: 'per_stay' }];
    assert.equal(readStayConfig({ fees }, [], NO_EXTRAS, { locale: 'el' }).fees[0].label, 'Καθαριότητα');
    assert.equal(readStayConfig({ fees }, [], NO_EXTRAS, { locale: 'en' }).fees[0].label, 'Cleaning');
  });

  test('a fee translated into only one locale is still named, not blank', () => {
    const fees = [{ id: 'clean', label: { en: 'Cleaning' }, amount: 60, basis: 'per_stay' }];
    assert.equal(readStayConfig({ fees }, [], NO_EXTRAS, { locale: 'el' }).fees[0].label, 'Cleaning');
  });

  test('a seasonal minimum of zero is treated as unset', () => {
    const c = readStayConfig({ seasonalRates: [{ from: '08-01', to: '08-31', rate: 1, minNights: 0 }] }, [], NO_EXTRAS);
    assert.equal(c.seasonalRates[0].minNights, undefined);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Availability                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

const OPEN: DayState = { date: '', capacity: 1, held: 0, confirmed: 0, closed: false };
const openDay = (date: string): DayState => ({ ...OPEN, date });
const NOW = new Date('2026-06-01T09:00:00Z');

function rules(over: Partial<ReturnType<typeof readStayRules>> = {}) {
  return {
    window: null,
    leadTimeHours: 0,
    maxAdvanceDays: 0,
    weekdays: null,
    minNights: 1,
    maxNights: 0,
    checkInDays: null,
    checkOutDays: null,
    ...over,
  };
}

describe('stayStatus', () => {
  test('an open range comes back with exactly its nights', () => {
    const r = stayStatus('2026-08-14', '2026-08-17', rules(), openDay, 1, NOW, 'Europe/Athens');
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.nights, ['2026-08-14', '2026-08-15', '2026-08-16']);
  });

  test('arrival-day rules are checked, and name the day they are about', () => {
    // 2026-08-15 is a Saturday.
    const satOnly = rules({ checkInDays: [6] });
    assert.equal(stayStatus('2026-08-15', '2026-08-22', satOnly, openDay, 1, NOW, 'UTC').ok, true);
    const bad = stayStatus('2026-08-14', '2026-08-21', satOnly, openDay, 1, NOW, 'UTC');
    assert.equal(bad.ok === false && bad.status, 'bad_checkin_day');
    assert.equal(bad.ok === false && bad.date, '2026-08-14');
  });

  test('a Sat-to-Sat villa is not "only available on Saturdays"', () => {
    // The per-day weekday rule must not be applied to the nights in between,
    // or every stay longer than one night would be impossible.
    const satOnly = rules({ checkInDays: [6], checkOutDays: [6], weekdays: [6] });
    assert.equal(stayStatus('2026-08-15', '2026-08-22', satOnly, openDay, 1, NOW, 'UTC').ok, true);
  });

  test('a sold-out night is reported with its date', () => {
    const full = (date: string): DayState =>
      date === '2026-08-15' ? { ...openDay(date), confirmed: 1 } : openDay(date);
    const r = stayStatus('2026-08-14', '2026-08-17', rules(), full, 1, NOW, 'UTC');
    assert.equal(r.ok === false && r.status, 'full');
    assert.equal(r.ok === false && r.date, '2026-08-15');
  });

  test('the CHECK-OUT day being sold out does not block the stay', () => {
    // It is a departure, not an occupancy.
    const full = (date: string): DayState =>
      date === '2026-08-17' ? { ...openDay(date), confirmed: 1 } : openDay(date);
    assert.equal(stayStatus('2026-08-14', '2026-08-17', rules(), full, 1, NOW, 'UTC').ok, true);
  });

  test('the request is judged before the calendar', () => {
    // Telling someone a night is sold out when their real problem is a
    // three-night minimum sends them looking for dates that fail the same way.
    const full = () => ({ ...OPEN, confirmed: 1 });
    const r = stayStatus('2026-08-14', '2026-08-15', rules({ minNights: 3 }), full, 1, NOW, 'UTC');
    assert.equal(r.ok === false && r.status, 'min_nights');
  });

  test('out-of-season nights are caught anywhere in the range', () => {
    const r = stayStatus('2026-08-30', '2026-09-03', rules({ window: { from: '05-01', to: '08-31' } }), openDay, 1, NOW, 'UTC');
    assert.equal(r.ok === false && r.status, 'out_of_season');
    assert.equal(r.ok === false && r.date, '2026-09-01');
  });
});

describe('staySlotRequestsFor', () => {
  test('a chosen option is the unit, one seat per night', () => {
    const reqs = staySlotRequestsFor({
      bookingGroupId: 'exp-1',
      resourceGroupId: 'opt-a',
      resourceCapacityPerDay: 1,
      capacityPerDay: 5,
    });
    assert.deepEqual(reqs, [{ slotKey: 'res:opt-a', seats: 1, defaultCapacity: 1 }]);
  });

  test('with no options the experience itself is the unit', () => {
    // A single villa needs no picker.
    const reqs = staySlotRequestsFor({ bookingGroupId: 'exp-1', capacityPerDay: 1 });
    assert.deepEqual(reqs, [{ slotKey: 'exp:exp-1', seats: 1, defaultCapacity: 1 }]);
  });

  test('two rooms of one hotel do not contend on an experience-level counter', () => {
    // Holding the experience slot as well would stop the second room at
    // whatever the property's own capacity happened to be.
    const a = staySlotRequestsFor({ bookingGroupId: 'hotel', resourceGroupId: 'suite', capacityPerDay: 1 });
    const b = staySlotRequestsFor({ bookingGroupId: 'hotel', resourceGroupId: 'studio', capacityPerDay: 1 });
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.notEqual(a[0].slotKey, b[0].slotKey);
  });
});

describe('slotDatePairs — the lock order', () => {
  const reqs = [
    { slotKey: 'exp:a', seats: 1, defaultCapacity: 1 },
    { slotKey: 'res:b', seats: 1, defaultCapacity: 1 },
  ];

  test('pairs come out sorted by slot key, then date', () => {
    const pairs = slotDatePairs(reqs, ['2026-08-16', '2026-08-14', '2026-08-15']);
    assert.deepEqual(
      pairs.map((p) => `${p.request.slotKey}@${p.slotDate}`),
      ['exp:a@2026-08-14', 'exp:a@2026-08-15', 'exp:a@2026-08-16', 'res:b@2026-08-14', 'res:b@2026-08-15', 'res:b@2026-08-16'],
    );
  });

  test('two overlapping stays agree on the order of the nights they share', () => {
    // This is the whole point. Without a total order, one transaction could
    // lock the 15th while the other held the 16th and waited for the 15th —
    // and neither would ever proceed.
    const a = slotDatePairs(reqs.slice(1), ['2026-08-14', '2026-08-15', '2026-08-16']);
    const b = slotDatePairs(reqs.slice(1), ['2026-08-16', '2026-08-15']);
    const shared = (pairs: typeof a) =>
      pairs.map((p) => p.slotDate).filter((d) => d === '2026-08-15' || d === '2026-08-16');
    assert.deepEqual(shared(a), shared(b));
  });

  test('a bare date behaves exactly as it did before ranges existed', () => {
    assert.deepEqual(
      slotDatePairs(reqs, '2026-08-14').map((p) => p.request.slotKey),
      ['exp:a', 'res:b'],
    );
  });

  test('a repeated date is locked once, not twice', () => {
    // Locking the same row twice in one transaction is harmless but pointless;
    // it also means a caller passing sloppy input cannot inflate the hold.
    assert.equal(slotDatePairs(reqs.slice(0, 1), ['2026-08-14', '2026-08-14']).length, 1);
  });
});

describe('readStayRules', () => {
  test('reads nights and arrival days, and clears the per-day weekday rule', () => {
    const r = readStayRules(
      { minNights: 3, maxNights: 21, checkInDays: ['6'], checkOutDays: ['6'], weekdays: ['1', '2'] },
      { leadTimeHours: 0 },
    );
    assert.equal(r.minNights, 3);
    assert.equal(r.maxNights, 21);
    assert.deepEqual(r.checkInDays, [6]);
    assert.deepEqual(r.checkOutDays, [6]);
    assert.equal(r.weekdays, null);
  });

  test('unset values fall back to "no restriction"', () => {
    const r = readStayRules({}, { leadTimeHours: 4 });
    assert.equal(r.minNights, 1);
    assert.equal(r.maxNights, 0);
    assert.equal(r.checkInDays, null);
    assert.equal(r.leadTimeHours, 4);
  });
});
