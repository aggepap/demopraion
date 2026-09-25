import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  clampPersons,
  dateToMonthDay,
  findBracket,
  findSeason,
  inSeason,
  monthDayToInt,
  quoteBooking,
  readPricingConfig,
  seasonSegments,
  seasonsOverlap,
  surchargeAmount,
  toMinor,
  type BookingPricing,
  type Quote,
} from '@/cms/modules/booking/pricing';

/** A minimal valid config; each test overrides only what it exercises. */
function config(over: Partial<BookingPricing> = {}): BookingPricing {
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
    extras: { enabled: false, multiplyPerPerson: false, mandatory: false, options: [] },
    ...over,
  };
}

/** Assert a quote succeeded and hand back the narrowed type. */
function ok(result: ReturnType<typeof quoteBooking>): Quote {
  assert.equal(result.ok, true, `expected a quote, got ${JSON.stringify(result)}`);
  return result as Quote;
}

describe('month-day parsing', () => {
  test('parses a valid mm-dd into a sortable integer', () => {
    assert.equal(monthDayToInt('11-15'), 1115);
    assert.equal(monthDayToInt('01-01'), 101);
  });
  test('accepts 29 February — a season has no year', () => {
    assert.equal(monthDayToInt('02-29'), 229);
  });
  test('rejects impossible dates', () => {
    assert.equal(monthDayToInt('02-30'), null);
    assert.equal(monthDayToInt('04-31'), null);
    assert.equal(monthDayToInt('13-01'), null);
    assert.equal(monthDayToInt('1-1'), null);
    assert.equal(monthDayToInt(''), null);
    assert.equal(monthDayToInt(undefined), null);
  });
  test('extracts mm-dd from an ISO date', () => {
    assert.equal(dateToMonthDay('2026-11-15'), 1115);
    assert.equal(dateToMonthDay('not-a-date'), null);
    assert.equal(dateToMonthDay(null), null);
  });
});

describe('seasonSegments', () => {
  test('a normal window is one segment', () => {
    assert.deepEqual(seasonSegments({ from: '06-01', to: '09-30' }), [[601, 930]]);
  });
  test('a wrapping window splits at the year boundary', () => {
    assert.deepEqual(seasonSegments({ from: '11-01', to: '02-28' }), [
      [1101, 1231],
      [101, 228],
    ]);
  });
  test('the whole year is one segment', () => {
    assert.deepEqual(seasonSegments({ from: '01-01', to: '12-31' }), [[101, 1231]]);
  });
  test('a single-day window is a degenerate segment, not empty', () => {
    assert.deepEqual(seasonSegments({ from: '07-04', to: '07-04' }), [[704, 704]]);
  });
  test('a malformed window yields no segments and therefore never matches', () => {
    assert.deepEqual(seasonSegments({ from: 'nope', to: '09-30' }), []);
    assert.equal(inSeason(701, { from: 'nope', to: '09-30' }), false);
  });
});

describe('inSeason', () => {
  const summer = { from: '06-01', to: '09-30' };
  const winter = { from: '11-01', to: '02-28' };

  test('inclusive at both ends', () => {
    assert.equal(inSeason(601, summer), true);
    assert.equal(inSeason(930, summer), true);
  });
  test('outside is outside', () => {
    assert.equal(inSeason(531, summer), false);
    assert.equal(inSeason(1001, summer), false);
  });
  test('a wrapping season matches on both sides of new year', () => {
    assert.equal(inSeason(1215, winter), true);
    assert.equal(inSeason(115, winter), true);
    assert.equal(inSeason(1101, winter), true);
    assert.equal(inSeason(228, winter), true);
  });
  test('a wrapping season does not match the gap', () => {
    assert.equal(inSeason(301, winter), false);
    assert.equal(inSeason(701, winter), false);
    assert.equal(inSeason(1031, winter), false);
  });
});

describe('findSeason', () => {
  test('returns the FIRST match, not the last', () => {
    // The legacy engine let the last overlapping rule win, silently.
    const rules = [
      { from: '06-01', to: '09-30', price: 100 },
      { from: '07-01', to: '07-31', price: 999 },
    ];
    assert.equal(findSeason(rules, 715), 0);
  });
  test('-1 when nothing matches or the list is absent', () => {
    assert.equal(findSeason([{ from: '06-01', to: '09-30', price: 1 }], 101), -1);
    assert.equal(findSeason(undefined, 101), -1);
  });
});

describe('seasonsOverlap', () => {
  test('detects a plain overlap', () => {
    assert.equal(seasonsOverlap({ from: '06-01', to: '08-31' }, { from: '08-01', to: '09-30' }), true);
  });
  test('adjacent-but-not-touching windows do not overlap', () => {
    assert.equal(seasonsOverlap({ from: '06-01', to: '06-30' }, { from: '07-01', to: '07-31' }), false);
  });
  test('detects an overlap that only exists because one window wraps', () => {
    assert.equal(seasonsOverlap({ from: '11-01', to: '02-28' }, { from: '01-15', to: '01-20' }), true);
  });
  test('two wrapping windows overlapping at the far end', () => {
    assert.equal(seasonsOverlap({ from: '12-01', to: '01-15' }, { from: '11-01', to: '12-05' }), true);
  });
  test('a malformed window cannot overlap anything', () => {
    assert.equal(seasonsOverlap({ from: 'x', to: 'y' }, { from: '01-01', to: '12-31' }), false);
  });
});

describe('clampPersons', () => {
  test('always 1 when the item is not priced per person', () => {
    assert.equal(clampPersons({ hasPersons: false, minPersons: 4, maxPersons: 10 }, 7), 1);
  });
  test('clamps into range rather than rejecting', () => {
    const cfg = { hasPersons: true, minPersons: 2, maxPersons: 8 };
    assert.equal(clampPersons(cfg, 1), 2);
    assert.equal(clampPersons(cfg, 99), 8);
    assert.equal(clampPersons(cfg, 5), 5);
  });
  test('a max below min collapses to min rather than inverting', () => {
    assert.equal(clampPersons({ hasPersons: true, minPersons: 6, maxPersons: 2 }, 4), 6);
  });
  test('junk falls back to the minimum', () => {
    assert.equal(clampPersons({ hasPersons: true, minPersons: 3, maxPersons: 9 }, Number.NaN), 3);
  });
});

describe('toMinor', () => {
  test('converts major units to integer cents', () => {
    assert.equal(toMinor(49.99), 4999);
    assert.equal(toMinor(100), 10000);
    assert.equal(toMinor(0), 0);
  });
  test('rounds a half cent up and never returns a float', () => {
    assert.equal(toMinor(0.005), 1);
    assert.equal(toMinor(33.333), 3333);
    assert.equal(Number.isInteger(toMinor(1 / 3)), true);
  });
  test('junk is zero, not NaN', () => {
    assert.equal(toMinor(Number.NaN), 0);
  });
});

describe('findBracket', () => {
  const brackets = [
    { min: 1, max: 4, cost: 400 },
    { min: 5, max: 10, cost: 700 },
  ];
  test('finds the containing bracket, inclusive at both edges', () => {
    assert.equal(findBracket(brackets, 1), 0);
    assert.equal(findBracket(brackets, 4), 0);
    assert.equal(findBracket(brackets, 5), 1);
    assert.equal(findBracket(brackets, 10), 1);
  });
  test('-1 outside every bracket', () => {
    assert.equal(findBracket(brackets, 11), -1);
    assert.equal(findBracket(undefined, 3), -1);
  });
});

describe('surchargeAmount', () => {
  test('applies basis points and rounds to a whole cent', () => {
    assert.equal(surchargeAmount(10000, 400), 400); // 4% of €100
    assert.equal(surchargeAmount(123456, 525), 6481); // 5.25%
  });
  test('zero or negative basis points add nothing', () => {
    assert.equal(surchargeAmount(10000, 0), 0);
    assert.equal(surchargeAmount(10000, -500), 0);
  });
});

describe('quoteBooking — the basics', () => {
  test('no base price means price on request', () => {
    const r = quoteBooking(config({ basePrice: null }), {});
    assert.deepEqual(r, { ok: false, reason: 'price_on_request' });
  });
  test('a zero total is price on request, not free', () => {
    const r = quoteBooking(config({ basePrice: 0 }), {});
    assert.deepEqual(r, { ok: false, reason: 'price_on_request' });
  });
  test('a flat price with no date and no persons', () => {
    const q = ok(quoteBooking(config(), {}));
    assert.equal(q.total, 10000);
    assert.equal(q.lines.length, 1);
    assert.equal(q.lines[0].code, 'base');
  });
  test('the breakdown lines always sum to the total', () => {
    const q = ok(
      quoteBooking(
        config({
          hasPersons: true,
          minPersons: 1,
          maxPersons: 10,
          mode: 'group_threshold',
          includedPersons: 2,
          extraPerPerson: 33.33,
          extras: {
            enabled: true,
            multiplyPerPerson: true,
            mandatory: false,
            options: [{ id: 'e1', name: 'Lunch', price: 12.5 }],
          },
        }),
        { persons: 5, extraIds: ['e1'] },
      ),
    );
    const sum = q.lines.reduce((acc, l) => acc + l.amount, 0);
    assert.equal(sum, q.total);
  });
});

describe('quoteBooking — seasons', () => {
  const cfg = config({
    basePrice: 100,
    seasonalPrices: [{ id: 's1', from: '06-01', to: '09-30', price: 250 }],
  });

  test('a date inside the season replaces the base price', () => {
    const q = ok(quoteBooking(cfg, { date: '2026-07-15' }));
    assert.equal(q.total, 25000);
    assert.equal(q.applied.seasonalIndex, 0);
  });
  test('a date outside the season keeps the base price', () => {
    const q = ok(quoteBooking(cfg, { date: '2026-03-15' }));
    assert.equal(q.total, 10000);
    assert.equal(q.applied.seasonalIndex, null);
  });
  test('no date means no season can apply', () => {
    const q = ok(quoteBooking(cfg, {}));
    assert.equal(q.total, 10000);
  });
  test('a wrapping season applies on both sides of new year', () => {
    const winter = config({
      basePrice: 100,
      seasonalPrices: [{ id: 'w', from: '11-01', to: '02-28', price: 300 }],
    });
    assert.equal(ok(quoteBooking(winter, { date: '2026-12-20' })).total, 30000);
    assert.equal(ok(quoteBooking(winter, { date: '2026-01-10' })).total, 30000);
    assert.equal(ok(quoteBooking(winter, { date: '2026-05-10' })).total, 10000);
  });
});

describe('quoteBooking — pricing modes', () => {
  const base = {
    basePrice: 100,
    hasPersons: true,
    minPersons: 1,
    maxPersons: 10,
  };

  test('multiply: unit × persons', () => {
    const q = ok(quoteBooking(config({ ...base, mode: 'multiply' }), { persons: 4 }));
    assert.equal(q.total, 40000);
    assert.equal(q.lines[0].quantity, 4);
  });

  test('group_threshold: flat up to the included count', () => {
    const cfg = config({ ...base, mode: 'group_threshold', includedPersons: 4, extraPerPerson: 25 });
    assert.equal(ok(quoteBooking(cfg, { persons: 4 })).total, 10000);
    assert.equal(ok(quoteBooking(cfg, { persons: 1 })).total, 10000);
  });
  test('group_threshold: each person over the count adds the extra fee', () => {
    const cfg = config({ ...base, mode: 'group_threshold', includedPersons: 4, extraPerPerson: 25 });
    const q = ok(quoteBooking(cfg, { persons: 7 }));
    assert.equal(q.total, 10000 + 3 * 2500);
    assert.equal(q.lines[1].code, 'extra_persons');
    assert.equal(q.lines[1].quantity, 3);
  });

  test('tiered: the matching band sets the whole total, flat', () => {
    const cfg = config({
      ...base,
      minPersons: 5,
      maxPersons: 15,
      mode: 'tiered',
      tiers: [
        { min: 5, max: 10, total: 1000 },
        { min: 11, max: 15, total: 1400 },
      ],
    });
    // Every size inside a band pays the same — that is what "flat total for the
    // party" means, and it is the whole reason bands exist.
    assert.equal(ok(quoteBooking(cfg, { persons: 5 })).total, 100000);
    assert.equal(ok(quoteBooking(cfg, { persons: 8 })).total, 100000);
    assert.equal(ok(quoteBooking(cfg, { persons: 10 })).total, 100000);
    assert.equal(ok(quoteBooking(cfg, { persons: 11 })).total, 140000);
    assert.equal(ok(quoteBooking(cfg, { persons: 8 })).applied.tierPersons, 8);
  });
  test('tiered ignores the base price entirely', () => {
    const cfg = config({
      ...base,
      basePrice: 9999,
      minPersons: 2,
      maxPersons: 2,
      mode: 'tiered',
      tiers: [{ min: 2, max: 2, total: 50 }],
    });
    assert.equal(ok(quoteBooking(cfg, { persons: 2 })).total, 5000);
  });
  /* WAS: the base-price guard ran before the mode was consulted, so an
   * experience priced only by band quoted "price on request" over a field its
   * own mode never reads. */
  test('tiered quotes with no base price at all', () => {
    const cfg = config({
      ...base,
      basePrice: null,
      minPersons: 1,
      maxPersons: 10,
      mode: 'tiered',
      tiers: [{ min: 1, max: 10, total: 450 }],
    });
    const q = ok(quoteBooking(cfg, { persons: 4 }));
    assert.equal(q.total, 45000);
    // And the line does not claim to be a base price there is none of.
    assert.equal(q.lines[0].label, '4 persons');
  });
  test('a party size outside every band is a refused config, not a guess', () => {
    const cfg = config({
      ...base,
      minPersons: 1,
      maxPersons: 12,
      mode: 'tiered',
      tiers: [{ min: 1, max: 5, total: 100 }],
    });
    const r = quoteBooking(cfg, { persons: 9 });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'invalid_config');
  });
  /* A document saved before bands existed. It must keep pricing exactly as it
   * did, and — the part that actually bit — it must still be SAVEABLE: the
   * object schema is strict, so an undeclared `persons` key answered the first
   * save with a 422 an editor could do nothing about. */
  test('a legacy exact-count row prices as the band covering that one size', () => {
    const cfg = readPricingConfig(
      {
        basePrice: 100,
        hasPersons: true,
        minPersons: 6,
        maxPersons: 6,
        pricingMode: 'tiered',
        tiers: [{ persons: 6, total: 1000 }],
      },
      [],
    );
    assert.deepEqual(cfg.tiers, [{ min: 6, max: 6, total: 1000 }]);
    assert.equal(ok(quoteBooking(cfg, { persons: 6 })).total, 100000);
  });
  test('a row that has its own ends ignores a leftover exact count', () => {
    // Half-migrated: the editor widened the band, and the old key rode along in
    // `data` because a hidden value is kept, not cleared.
    const cfg = readPricingConfig(
      { basePrice: 100, hasPersons: true, pricingMode: 'tiered', tiers: [{ persons: 6, min: 5, max: 10, total: 1000 }] },
      [],
    );
    assert.deepEqual(cfg.tiers, [{ min: 5, max: 10, total: 1000 }]);
  });
  /* The person meta is neutralised on the way in, so a leftover tier table
   * cannot silently reprice a booking that is no longer sold by party size. */
  test('tiers left behind with per-person pricing off do not apply', () => {
    const cfg = readPricingConfig(
      { basePrice: 200, hasPersons: false, pricingMode: 'tiered', tiers: [{ min: 1, max: 9, total: 5 }] },
      [],
    );
    assert.deepEqual(cfg.tiers, []);
    assert.equal(cfg.mode, 'multiply');
    assert.equal(ok(quoteBooking(cfg, { persons: 4 })).total, 20000);
  });
});

describe('quoteBooking — resources', () => {
  const cfg = config({
    basePrice: 100,
    hasPersons: true,
    minPersons: 1,
    maxPersons: 10,
    mode: 'multiply',
    seasonalPrices: [{ id: 's1', from: '06-01', to: '09-30', price: 250 }],
    resources: [
      {
        id: 'yacht-a',
        label: 'Sunseeker 68',
        cost: 1200,
        seasonal: [{ id: 'r1', from: '07-01', to: '08-31', cost: 1600 }],
      },
    ],
  });

  test('a resource REPLACES the base price rather than adding to it', () => {
    const q = ok(quoteBooking(cfg, { resourceId: 'yacht-a', persons: 1 }));
    assert.equal(q.total, 120000);
    assert.equal(q.lines[0].kind, 'resource');
  });
  test('a resource also replaces a seasonal price', () => {
    const q = ok(quoteBooking(cfg, { date: '2026-09-15', resourceId: 'yacht-a', persons: 1 }));
    assert.equal(q.total, 120000, 'the €250 September season must not win over the resource');
  });
  test("a resource's own season replaces its standard cost", () => {
    const q = ok(quoteBooking(cfg, { date: '2026-07-15', resourceId: 'yacht-a', persons: 1 }));
    assert.equal(q.total, 160000);
    assert.equal(q.applied.resourceRuleIndex, 0);
  });
  test('the multiply mode still applies to a resource price', () => {
    const q = ok(quoteBooking(cfg, { resourceId: 'yacht-a', persons: 3 }));
    assert.equal(q.total, 360000);
  });
  test('a zero-cost resource leaves the base price standing', () => {
    const free = config({
      basePrice: 100,
      resources: [{ id: 'r0', label: 'Standard boat', cost: 0 }],
    });
    assert.equal(ok(quoteBooking(free, { resourceId: 'r0' })).total, 10000);
  });
  test('an unknown resource id is refused, not ignored', () => {
    assert.deepEqual(quoteBooking(cfg, { resourceId: 'nope' }), { ok: false, reason: 'unknown_resource' });
  });
});

describe('quoteBooking — person brackets override everything', () => {
  const cfg = config({
    basePrice: 100,
    hasPersons: true,
    minPersons: 1,
    maxPersons: 8,
    mode: 'multiply',
    resources: [
      {
        id: 'yacht-a',
        label: 'Sunseeker 68',
        cost: 1200,
        seasonal: [
          {
            id: 'r1',
            from: '07-01',
            to: '08-31',
            cost: 1600,
            perPerson: true,
            brackets: [
              { min: 1, max: 4, cost: 1400 },
              { min: 5, max: 8, cost: 1800 },
            ],
          },
        ],
      },
    ],
  });

  test('a matching bracket is the TOTAL — multiplication is suppressed', () => {
    const q = ok(quoteBooking(cfg, { date: '2026-07-15', resourceId: 'yacht-a', persons: 4 }));
    assert.equal(q.total, 140000, 'not 1400 × 4');
    assert.equal(q.applied.groupOverride, true);
    assert.equal(q.applied.bracketIndex, 0);
    assert.equal(q.lines.length, 1);
  });
  test('the bracket for a larger party', () => {
    const q = ok(quoteBooking(cfg, { date: '2026-08-01', resourceId: 'yacht-a', persons: 6 }));
    assert.equal(q.total, 180000);
  });
  test('the group-threshold surcharge is suppressed too', () => {
    const withThreshold = config({
      ...cfg,
      mode: 'group_threshold',
      includedPersons: 2,
      extraPerPerson: 500,
    });
    const q = ok(quoteBooking(withThreshold, { date: '2026-07-15', resourceId: 'yacht-a', persons: 6 }));
    assert.equal(q.total, 180000, 'no per-extra-person charge on top of a bracket total');
  });
  test('outside the resource season the brackets do not apply', () => {
    const q = ok(quoteBooking(cfg, { date: '2026-10-15', resourceId: 'yacht-a', persons: 4 }));
    assert.equal(q.total, 480000, 'falls back to the standard cost × persons');
    assert.equal(q.applied.groupOverride, false);
  });
});

describe('quoteBooking — breakdown labels', () => {
  const cfg = config({ basePrice: 100, hasPersons: true, minPersons: 1, maxPersons: 10, mode: 'multiply' });

  test('a per-person line names the party size it multiplies by', () => {
    const q = ok(quoteBooking(cfg, { persons: 4 }));
    assert.equal(q.lines[0].label, 'Base price — 4 persons');
    assert.equal(q.lines[0].unitAmount, 10000);
  });
  test('a party of one is not padded with a redundant count', () => {
    assert.equal(ok(quoteBooking(cfg, { persons: 1 })).lines[0].label, 'Base price');
  });
  test('the extra-persons line says how many are extra', () => {
    const group = config({
      basePrice: 400,
      hasPersons: true,
      minPersons: 1,
      maxPersons: 10,
      mode: 'group_threshold',
      includedPersons: 4,
      extraPerPerson: 30,
    });
    const q = ok(quoteBooking(group, { persons: 6 }));
    assert.equal(q.lines[1].label, 'Additional persons (over 4) — 2 persons');
  });
});

describe('quoteBooking — extras', () => {
  const cfg = config({
    basePrice: 100,
    hasPersons: true,
    minPersons: 1,
    maxPersons: 10,
    mode: 'multiply',
    extras: {
      enabled: true,
      multiplyPerPerson: false,
      mandatory: false,
      options: [
        { id: 'e1', name: 'Lunch', price: 20 },
        { id: 'e2', name: 'Photos', price: 50 },
      ],
    },
  });

  test('selected extras are added once each', () => {
    const q = ok(quoteBooking(cfg, { persons: 2, extraIds: ['e1', 'e2'] }));
    assert.equal(q.total, 20000 + 2000 + 5000);
  });
  test('per-person extras multiply by the party size', () => {
    const perPerson = config({ ...cfg, extras: { ...cfg.extras, multiplyPerPerson: true } });
    const q = ok(quoteBooking(perPerson, { persons: 3, extraIds: ['e1'] }));
    assert.equal(q.total, 30000 + 3 * 2000);
    assert.equal(q.lines[1].quantity, 3);
  });
  test('a per-person extra line says how many people it is counting', () => {
    const perPerson = config({ ...cfg, extras: { ...cfg.extras, multiplyPerPerson: true } });
    const q = ok(quoteBooking(perPerson, { persons: 3, extraIds: ['e1'] }));
    // "(per person)" left the multiplier out, and the breakdown shows the unit
    // price beside the label — so the row could not be checked against itself.
    assert.equal(q.lines[1].label, 'Lunch — 3 persons');
  });
  test('an unknown extra is refused', () => {
    assert.deepEqual(quoteBooking(cfg, { extraIds: ['nope'] }), { ok: false, reason: 'unknown_extra' });
  });
  test('a mandatory extras group refuses an empty selection', () => {
    const must = config({ ...cfg, extras: { ...cfg.extras, mandatory: true } });
    assert.deepEqual(quoteBooking(must, { persons: 1 }), { ok: false, reason: 'extra_required' });
  });
  test('extras are ignored entirely when the group is disabled', () => {
    const off = config({ ...cfg, extras: { ...cfg.extras, enabled: false } });
    assert.equal(ok(quoteBooking(off, { persons: 1, extraIds: ['e1'] })).total, 10000);
  });
});

describe('quoteBooking — an invalid config is refused, never guessed', () => {
  test('overlapping seasons refuse rather than picking one', () => {
    const cfg = config({
      seasonalPrices: [
        { from: '06-01', to: '08-31', price: 200 },
        { from: '08-01', to: '09-30', price: 300 },
      ],
    });
    const r = quoteBooking(cfg, { date: '2026-08-15' });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'invalid_config');
  });
  /* WAS: a refused quote, on the grounds that person settings were left behind
   * after the switch was turned off. `readPricingConfig` now discards them
   * instead, so there is nothing stale left to refuse — and the editor is no
   * longer blocked by fields that same switch had hidden from them. */
  test('person settings left behind by switching persons off do not block a quote', () => {
    const cfg = config({ hasPersons: false, minPersons: 1, maxPersons: 8 });
    assert.equal(ok(quoteBooking(cfg, {})).total, 10000);
  });
});

describe('readPricingConfig', () => {
  test('an empty document yields a coherent, quotable-as-on-request config', () => {
    const cfg = readPricingConfig({}, []);
    assert.equal(cfg.basePrice, null);
    assert.equal(cfg.hasPersons, false);
    assert.equal(cfg.minPersons, 1);
    assert.equal(cfg.mode, 'multiply');
    assert.deepEqual(cfg.tiers, []);
    assert.equal(cfg.extras.enabled, false);
    assert.deepEqual(quoteBooking(cfg, {}), { ok: false, reason: 'price_on_request' });
  });
  test('an empty-string price is "on request", not zero', () => {
    assert.equal(readPricingConfig({ basePrice: '' }, []).basePrice, null);
  });
  test('reads the pricing block off a document', () => {
    const cfg = readPricingConfig(
      {
        basePrice: 450,
        hasPersons: true,
        minPersons: 2,
        maxPersons: 8,
        pricingMode: 'group_threshold',
        includedPersons: 4,
        extraPerPerson: 30,
        seasonalPrices: [{ id: 's1', from: '06-01', to: '09-30', price: 600 }],
        extrasEnabled: true,
        extrasMultiplyPerPerson: true,
        extrasMandatory: false,
        extrasOptions: [{ id: 'e1', name: 'Lunch', price: 15 }],
      },
      [{ id: 'g1', label: 'Yacht', cost: 1000 }],
      { currency: 'EUR' },
    );
    assert.equal(cfg.basePrice, 450);
    assert.equal(cfg.mode, 'group_threshold');
    assert.equal(cfg.seasonalPrices[0].price, 600);
    assert.equal(cfg.extras.options[0].name, 'Lunch');
    assert.equal(cfg.resources[0].id, 'g1');
  });
  /* An extra's name is `localized: true`, so it is stored as a `{ locale: value }`
   * map. Read as a plain string it came out empty — a nameless checkbox on the
   * form and a nameless line on the breakdown. */
  test('a localized extra name is resolved for the locale', () => {
    const data = {
      extrasEnabled: true,
      extrasOptions: [{ id: 'e1', name: { el: 'Γεύμα', en: 'Lunch' }, price: 15 }],
      extrasTitle: { el: 'Επιπλέον', en: 'Extras' },
    };
    assert.equal(readPricingConfig(data, [], { locale: 'el' }).extras.options[0].name, 'Γεύμα');
    assert.equal(readPricingConfig(data, [], { locale: 'en' }).extras.options[0].name, 'Lunch');
    assert.equal(readPricingConfig(data, [], { locale: 'el' }).extras.title, 'Επιπλέον');
    // An untranslated extra falls back to whatever locale has words, never blank.
    const half = { extrasEnabled: true, extrasOptions: [{ id: 'e1', name: { en: 'Lunch' }, price: 15 }] };
    assert.equal(readPricingConfig(half, [], { locale: 'el' }).extras.options[0].name, 'Lunch');
  });
  test('an unrecognised pricing mode falls back to multiply rather than throwing', () => {
    assert.equal(readPricingConfig({ pricingMode: 'nonsense' }, []).mode, 'multiply');
  });
  test('persons config is neutralised when the persons feature is off', () => {
    // Reading, not saving, is where the legacy "stale meta" bug did its damage.
    const cfg = readPricingConfig({ hasPersons: false, minPersons: 4, maxPersons: 12 }, []);
    assert.equal(cfg.minPersons, 1);
    assert.equal(cfg.maxPersons, 1);
    assert.deepEqual(validateIsClean(cfg), true);
  });
});

/** The stale-config check should pass for anything `readPricingConfig` produces. */
function validateIsClean(cfg: BookingPricing): boolean {
  const r = quoteBooking({ ...cfg, basePrice: cfg.basePrice ?? 100 }, {});
  return r.ok === true || r.reason !== 'invalid_config';
}
