/**
 * The availability calendar's "Price override".
 *
 * It was stored, shown on the calendar cell — and read by nothing that prices a
 * booking, so a date marked €300 still quoted the season's €200. These pin what
 * it now means: for transport it replaces the base price on that date (or the
 * option's price when the exception is on an option); for a stay it replaces the
 * nightly rate for that night.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { priceOverrideHelp } from '@/cms/admin/AvailabilityCalendar';
import { quoteBooking, type BookingPricing, type Quote } from '@/cms/modules/booking/pricing';
import { overrideDatesFor, quoteForSelection } from '@/cms/modules/booking/quote-selection';
import { quoteStay, type StayPricing, type StayQuote } from '@/cms/modules/booking/stay';

const NO_EXTRAS = { enabled: false, multiplyPerPerson: false, mandatory: false, options: [] };

function transport(over: Partial<BookingPricing> = {}): BookingPricing {
  return {
    basePrice: 100,
    currency: 'EUR',
    hasPersons: false,
    minPersons: 1,
    maxPersons: 1,
    mode: 'multiply',
    includedPersons: 0,
    extraPerPerson: 0,
    tiers: [],
    seasonalPrices: [],
    resources: [],
    extras: NO_EXTRAS,
    ...over,
  };
}

function stay(over: Partial<StayPricing> = {}): StayPricing {
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

const okQ = (r: ReturnType<typeof quoteBooking>): Quote => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as Quote;
};
const okS = (r: ReturnType<typeof quoteStay>): StayQuote => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as StayQuote;
};

describe('transport: an override on the experience replaces the base price for that date', () => {
  test('flat price', () => {
    const q = okQ(quoteBooking(transport(), { date: '2026-08-01', dateOverrides: { base: 25000 } }));
    assert.equal(q.total, 25000);
    assert.equal(q.unitAmount, 25000);
  });

  test('beats the season covering the date', () => {
    const cfg = transport({ seasonalPrices: [{ from: '07-01', to: '08-31', price: 200 }] });
    assert.equal(okQ(quoteBooking(cfg, { date: '2026-08-01' })).total, 20000);
    assert.equal(okQ(quoteBooking(cfg, { date: '2026-08-01', dateOverrides: { base: 30000 } })).total, 30000);
  });

  test('is still the per-person price when pricing is per person', () => {
    const cfg = transport({ hasPersons: true, minPersons: 1, maxPersons: 10 });
    const q = okQ(quoteBooking(cfg, { date: '2026-08-01', persons: 3, dateOverrides: { base: 5000 } }));
    assert.equal(q.total, 15000);
  });

  test('no override leaves the price exactly as before', () => {
    const cfg = transport();
    assert.deepEqual(
      quoteBooking(cfg, { date: '2026-08-01', dateOverrides: { base: null } }),
      quoteBooking(cfg, { date: '2026-08-01' }),
    );
  });

  test('a chosen option with its own price still replaces the base, as it always has', () => {
    const cfg = transport({ resources: [{ id: 'opt', label: 'Big boat', cost: 400 }] });
    const q = okQ(quoteBooking(cfg, { date: '2026-08-01', resourceId: 'opt', dateOverrides: { base: 25000 } }));
    assert.equal(q.total, 40000);
  });
});

describe('transport: an override on an option replaces that option’s price for that date', () => {
  const cfg = transport({
    resources: [
      { id: 'opt', label: 'Big boat', cost: 400, seasonal: [{ from: '08-01', to: '08-31', cost: 500 }] },
    ],
  });

  test('beats the option’s own seasonal cost', () => {
    const q = okQ(quoteBooking(cfg, { date: '2026-08-10', resourceId: 'opt', dateOverrides: { option: 45000 } }));
    assert.equal(q.total, 45000);
    assert.equal(q.lines[0].label, 'Big boat');
  });

  test('does not touch a booking that did not choose the option', () => {
    assert.equal(okQ(quoteBooking(cfg, { date: '2026-08-10', dateOverrides: { option: 45000 } })).total, 10000);
  });
});

describe('stay: an override replaces the nightly rate for that night', () => {
  test('only the overridden night changes, and the breakdown says so', () => {
    const q = okS(
      quoteStay(stay(), {
        checkIn: '2026-08-01',
        checkOut: '2026-08-04',
        nightOverrides: { nightly: { '2026-08-02': 30000 } },
      }),
    );
    assert.equal(q.total, 10000 + 30000 + 10000);
    assert.equal(q.lines.length, 3, 'three segments: 100, 300, 100');
  });

  test('beats a seasonal rate', () => {
    const cfg = stay({ seasonalRates: [{ from: '08-01', to: '08-31', rate: 200 }] });
    const q = okS(
      quoteStay(cfg, { checkIn: '2026-08-01', checkOut: '2026-08-03', nightOverrides: { nightly: { '2026-08-01': 5000 } } }),
    );
    assert.equal(q.total, 5000 + 20000);
  });

  test('on an option, the option’s own override is the one that applies', () => {
    const cfg = stay({ options: [{ id: 'room', label: 'Sea room', cost: 150 }] });
    const q = okS(
      quoteStay(cfg, {
        checkIn: '2026-08-01',
        checkOut: '2026-08-03',
        optionId: 'room',
        nightOverrides: { option: { '2026-08-01': 20000 }, nightly: { '2026-08-02': 99900 } },
      }),
    );
    // Night 1: the room's override. Night 2: the room's own price — an override
    // on the experience does not replace a price the option sets itself.
    assert.equal(q.total, 20000 + 15000);
  });

  test('extra-guest charges and fees still apply on top', () => {
    const cfg = stay({ extraGuestPerNight: 20, fees: [{ id: 'c', label: 'Cleaning', amount: 50, basis: 'per_stay' }] });
    const q = okS(
      quoteStay(cfg, {
        checkIn: '2026-08-01',
        checkOut: '2026-08-02',
        adults: 3,
        nightOverrides: { nightly: { '2026-08-01': 30000 } },
      }),
    );
    assert.equal(q.total, 30000 + 2000 + 5000);
  });
});

describe('quoteForSelection — one entry point for the quote, the request and the drift check', () => {
  const engine = (kind: 'transport' | 'stay') => ({ kind, pricing: transport(), stay: stay() });

  test('a transport selection is priced by the transport engine with its date override', () => {
    const q = quoteForSelection(engine('transport'), { date: '2026-08-01' }, { base: { '2026-08-01': 7000 }, option: {} });
    assert.equal(q.ok && q.total, 7000);
  });

  test('a stay selection is priced by the STAY engine — the drift warning used the transport one', () => {
    const q = quoteForSelection(engine('stay'), { date: '2026-08-01', endDate: '2026-08-04', adults: 2 });
    assert.equal(q.ok && q.total, 30000);
    assert.equal(q.ok && 'nights' in q && q.nights, 3);
  });

  test('the dates whose overrides matter: one for transport, every night for a stay', () => {
    assert.deepEqual(overrideDatesFor('transport', { date: '2026-08-01' }), ['2026-08-01']);
    assert.deepEqual(overrideDatesFor('stay', { date: '2026-08-01', endDate: '2026-08-03' }), [
      '2026-08-01',
      '2026-08-02',
    ]);
    assert.deepEqual(overrideDatesFor('transport', {}), []);
  });
});

describe('the calendar tells the operator what the override does', () => {
  test('transport, on the experience', () => {
    assert.match(priceOverrideHelp({ kind: 'transport', isOption: false }), /replaces the base price/i);
  });
  test('transport, on an option', () => {
    assert.match(priceOverrideHelp({ kind: 'transport', isOption: true }), /replaces this option’s price/i);
  });
  test('stay', () => {
    assert.match(priceOverrideHelp({ kind: 'stay', isOption: false }), /nightly rate for this night/i);
    assert.match(priceOverrideHelp({ kind: 'stay', isOption: true }), /nightly rate for this night/i);
  });
});
