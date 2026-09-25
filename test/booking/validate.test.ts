import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { validatePricingConfig, type BookingPricing } from '@/cms/modules/booking/pricing';

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

/** The set of issue codes a config produces — order-independent. */
function codes(cfg: BookingPricing): string[] {
  return validatePricingConfig(cfg).map((i) => i.code).sort();
}

describe('validatePricingConfig — a coherent config produces nothing', () => {
  test('the minimal config is clean', () => {
    assert.deepEqual(validatePricingConfig(config()), []);
  });
  test('a fully-featured but coherent config is clean', () => {
    const cfg = config({
      hasPersons: true,
      minPersons: 2,
      maxPersons: 8,
      mode: 'group_threshold',
      includedPersons: 4,
      extraPerPerson: 30,
      seasonalPrices: [
        { from: '06-01', to: '08-31', price: 200 },
        { from: '09-01', to: '10-31', price: 150 },
      ],
      resources: [
        {
          id: 'y1',
          label: 'Yacht',
          cost: 1000,
          seasonal: [
            {
              from: '07-01',
              to: '08-31',
              cost: 1400,
              perPerson: true,
              brackets: [
                { min: 2, max: 4, cost: 1200 },
                { min: 5, max: 8, cost: 1600 },
              ],
            },
          ],
        },
      ],
      extras: {
        enabled: true,
        multiplyPerPerson: true,
        mandatory: true,
        options: [{ id: 'e1', name: 'Lunch', price: 15 }],
      },
    });
    assert.deepEqual(validatePricingConfig(cfg), []);
  });
});

describe('validatePricingConfig — seasons', () => {
  test('flags a malformed date', () => {
    assert.ok(codes(config({ seasonalPrices: [{ from: '31-12', to: '01-01', price: 1 }] })).includes('season_malformed'));
  });
  test('flags two seasons covering the same day', () => {
    const cfg = config({
      seasonalPrices: [
        { from: '06-01', to: '08-31', price: 200 },
        { from: '08-31', to: '09-30', price: 300 },
      ],
    });
    assert.ok(codes(cfg).includes('season_overlap'));
  });
  test('flags an overlap that only exists because one season wraps the year', () => {
    const cfg = config({
      seasonalPrices: [
        { from: '11-01', to: '02-28', price: 200 },
        { from: '01-10', to: '01-20', price: 300 },
      ],
    });
    assert.ok(codes(cfg).includes('season_overlap'));
  });
  test('back-to-back seasons are not an overlap', () => {
    const cfg = config({
      seasonalPrices: [
        { from: '06-01', to: '06-30', price: 200 },
        { from: '07-01', to: '07-31', price: 300 },
      ],
    });
    assert.deepEqual(validatePricingConfig(cfg), []);
  });
  test('names both offending rows so the editor can find them', () => {
    const cfg = config({
      seasonalPrices: [
        { from: '06-01', to: '08-31', price: 200 },
        { from: '08-01', to: '09-30', price: 300 },
      ],
    });
    const overlap = validatePricingConfig(cfg).find((i) => i.code === 'season_overlap');
    assert.equal(overlap?.path, 'seasonalPrices.1');
    assert.match(overlap?.message ?? '', /overlaps season 1/);
  });
});

describe('validatePricingConfig — persons', () => {
  test('flags a maximum below the minimum', () => {
    assert.ok(codes(config({ hasPersons: true, minPersons: 8, maxPersons: 2 })).includes('persons_range'));
  });
  test('flags a count outside 1…999', () => {
    assert.ok(codes(config({ hasPersons: true, minPersons: 0, maxPersons: 4 })).includes('persons_range'));
    assert.ok(codes(config({ hasPersons: true, minPersons: 1, maxPersons: 1000 })).includes('persons_range'));
  });
  /*
   * Person settings left behind after the switch is turned off are no longer an
   * error: `readPricingConfig` neutralises them, so nothing downstream can read
   * them, and the fields are hidden by the same switch — complaining about
   * values the editor cannot see was a dead end.
   */
  test('settings left behind after switching the feature off are not an error', () => {
    assert.deepEqual(validatePricingConfig(config({ hasPersons: false, minPersons: 1, maxPersons: 8 })), []);
    assert.deepEqual(
      validatePricingConfig(config({ hasPersons: false, tiers: [{ min: 2, max: 2, total: 100 }] })),
      [],
    );
  });
});

describe('validatePricingConfig — modes', () => {
  test('group_threshold needs an included-persons count', () => {
    assert.ok(codes(config({ mode: 'group_threshold', includedPersons: 0 })).includes('threshold_missing'));
  });
  test('tiered needs at least one tier', () => {
    assert.ok(codes(config({ mode: 'tiered', tiers: [] })).includes('tier_missing'));
  });
  test('tiered rejects two bands covering the same party size', () => {
    const cfg = config({
      hasPersons: true,
      minPersons: 2,
      maxPersons: 6,
      mode: 'tiered',
      tiers: [
        { min: 2, max: 4, total: 100 },
        { min: 4, max: 6, total: 200 },
      ],
    });
    assert.ok(codes(cfg).includes('tier_overlap'));
  });
  test('tiered rejects a band whose last size is below its first', () => {
    const cfg = config({
      hasPersons: true,
      minPersons: 1,
      maxPersons: 6,
      mode: 'tiered',
      tiers: [{ min: 6, max: 1, total: 100 }],
    });
    assert.ok(codes(cfg).includes('tier_range'));
  });
  test('tiered rejects a party size no band covers', () => {
    const cfg = config({
      hasPersons: true,
      minPersons: 1,
      maxPersons: 12,
      mode: 'tiered',
      tiers: [
        { min: 1, max: 5, total: 100 },
        { min: 9, max: 12, total: 300 },
      ],
    });
    const gap = validatePricingConfig(cfg).find((i) => i.code === 'tier_gap');
    assert.ok(gap, 'expected a tier_gap');
    // The message has to name the sizes: "there is a gap" sends the editor
    // hunting through their own table for it.
    assert.match(gap.message, /6, 7, 8/);
    assert.equal(gap.path, 'tiers');
  });
  test('tiered rejects a band that can never apply', () => {
    // 20–30 people on a boat that takes 4–12: the form will never offer a party
    // this row could price.
    const cfg = config({
      hasPersons: true,
      minPersons: 4,
      maxPersons: 12,
      mode: 'tiered',
      tiers: [{ min: 4, max: 12, total: 100 }, { min: 20, max: 30, total: 900 }],
    });
    assert.ok(codes(cfg).includes('tier_bounds'));
    assert.match(
      validatePricingConfig(cfg).find((i) => i.code === 'tier_bounds')!.message,
      /4–12/,
    );
  });
  /* WAS: any row crossing an edge was refused, so a bracket written 1–20 for a
   * 5–15 experience — which prices every size the form can actually offer —
   * failed the whole config and the live page said "price on request". */
  test('a band that overshoots the range but covers it is accepted', () => {
    const cfg = config({
      hasPersons: true,
      minPersons: 5,
      maxPersons: 15,
      mode: 'tiered',
      tiers: [{ min: 1, max: 20, total: 100 }],
    });
    assert.deepEqual(validatePricingConfig(cfg), []);
  });
  /* Two bands over a 1…999 range is the exact setup that used to be refused —
   * one row per head count — and it is now the normal way to price a boat. */
  test('a few bands covering the whole range are clean', () => {
    const cfg = config({
      hasPersons: true,
      minPersons: 1,
      maxPersons: 999,
      mode: 'tiered',
      tiers: [
        { min: 1, max: 10, total: 1000 },
        { min: 11, max: 999, total: 1400 },
      ],
    });
    assert.deepEqual(validatePricingConfig(cfg), []);
  });
});

describe('validatePricingConfig — resources', () => {
  test('flags the same resource listed twice', () => {
    const cfg = config({
      resources: [
        { id: 'y1', label: 'Yacht', cost: 100 },
        { id: 'y1', label: 'Yacht again', cost: 200 },
      ],
    });
    assert.ok(codes(cfg).includes('resource_duplicate'));
  });
  test('flags two seasonal costs on one resource covering the same date', () => {
    const cfg = config({
      resources: [
        {
          id: 'y1',
          label: 'Yacht',
          cost: 100,
          seasonal: [
            { from: '06-01', to: '08-31', cost: 200 },
            { from: '08-15', to: '09-30', cost: 300 },
          ],
        },
      ],
    });
    assert.ok(codes(cfg).includes('resource_season_overlap'));
  });
  test('flags overlapping group brackets', () => {
    const cfg = config({
      hasPersons: true,
      minPersons: 1,
      maxPersons: 8,
      resources: [
        {
          id: 'y1',
          label: 'Yacht',
          cost: 100,
          seasonal: [
            {
              from: '06-01',
              to: '08-31',
              cost: 200,
              perPerson: true,
              brackets: [
                { min: 1, max: 5, cost: 300 },
                { min: 4, max: 8, cost: 400 },
              ],
            },
          ],
        },
      ],
    });
    assert.ok(codes(cfg).includes('bracket_overlap'));
  });
  test('flags a bracket whose maximum is below its minimum', () => {
    const cfg = config({
      hasPersons: true,
      minPersons: 1,
      maxPersons: 8,
      resources: [
        {
          id: 'y1',
          label: 'Yacht',
          cost: 100,
          seasonal: [
            { from: '06-01', to: '08-31', cost: 200, perPerson: true, brackets: [{ min: 6, max: 2, cost: 300 }] },
          ],
        },
      ],
    });
    assert.ok(codes(cfg).includes('bracket_range'));
  });
  test('flags a party size no bracket covers', () => {
    const cfg = config({
      hasPersons: true,
      minPersons: 1,
      maxPersons: 8,
      resources: [
        {
          id: 'y1',
          label: 'Yacht',
          cost: 100,
          seasonal: [
            { from: '06-01', to: '08-31', cost: 200, perPerson: true, brackets: [{ min: 1, max: 4, cost: 300 }] },
          ],
        },
      ],
    });
    assert.ok(codes(cfg).includes('bracket_gap'));
  });
  test('a non-per-person rule needs no brackets at all', () => {
    const cfg = config({
      hasPersons: true,
      minPersons: 1,
      maxPersons: 8,
      resources: [{ id: 'y1', label: 'Yacht', cost: 100, seasonal: [{ from: '06-01', to: '08-31', cost: 200 }] }],
    });
    assert.deepEqual(validatePricingConfig(cfg), []);
  });
});

describe('validatePricingConfig — extras', () => {
  test('flags the same extra listed twice', () => {
    const cfg = config({
      extras: {
        enabled: true,
        multiplyPerPerson: false,
        mandatory: false,
        options: [
          { id: 'e1', name: 'Lunch', price: 10 },
          { id: 'e1', name: 'Lunch', price: 20 },
        ],
      },
    });
    assert.ok(codes(cfg).includes('extra_duplicate'));
  });
  test('flags a required extras group with nothing to choose', () => {
    const cfg = config({
      extras: { enabled: true, multiplyPerPerson: false, mandatory: true, options: [] },
    });
    assert.ok(codes(cfg).includes('extra_required_empty'));
  });
  test('a disabled extras group is never validated', () => {
    const cfg = config({
      extras: {
        enabled: false,
        multiplyPerPerson: false,
        mandatory: true,
        options: [
          { id: 'e1', name: 'A', price: 1 },
          { id: 'e1', name: 'B', price: 2 },
        ],
      },
    });
    assert.deepEqual(validatePricingConfig(cfg), []);
  });
});

describe('validatePricingConfig — reports every problem at once', () => {
  test('an editor sees all of them, not just the first', () => {
    const cfg = config({
      hasPersons: true,
      minPersons: 8,
      maxPersons: 2,
      mode: 'tiered',
      tiers: [],
      seasonalPrices: [
        { from: '06-01', to: '08-31', price: 200 },
        { from: '08-01', to: '09-30', price: 300 },
      ],
      extras: { enabled: true, multiplyPerPerson: false, mandatory: true, options: [] },
    });
    const found = codes(cfg);
    assert.ok(found.includes('persons_range'));
    assert.ok(found.includes('tier_missing'));
    assert.ok(found.includes('season_overlap'));
    assert.ok(found.includes('extra_required_empty'));
  });
});
