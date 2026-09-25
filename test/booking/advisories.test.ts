import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADVISORIES } from '@/cms/admin/advisories';

/**
 * The advisory channel exists so a pricing config that cannot be quoted says so
 * in the FORM, next to the field that is wrong — rather than reaching a visitor
 * as "price on request" with nothing in the admin to explain it.
 *
 * Which makes the addresses the point of these tests: a message keyed to a path
 * no control owns renders nowhere, and fails exactly as silently as having no
 * message at all.
 */
const check = ADVISORIES['booking-pricing'];

/** A transport experience whose own pricing is complete and coherent. */
function experience(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'transport',
    basePrice: 500,
    hasPersons: true,
    minPersons: 5,
    maxPersons: 15,
    pricingMode: 'tiered',
    tiers: [
      { min: 5, max: 8, total: 1000 },
      { min: 9, max: 15, total: 2500 },
    ],
    ...over,
  };
}

/** One option with a per-party-size seasonal cost. */
function option(id: string, brackets: Array<Record<string, number>>): Record<string, unknown> {
  return {
    id,
    name: { el: id },
    cost: 2000,
    seasonal: [{ id: `${id}-s1`, from: '02-01', to: '02-29', cost: 2000, perPerson: true, brackets }],
  };
}

describe('booking advisories — a coherent config says nothing', () => {
  test('complete party-size bands are clean', () => {
    assert.deepEqual(check(experience(), 'el'), {});
  });

  test('an option whose brackets cover the party range is clean', () => {
    const data = experience({
      optionsEnabled: true,
      options: [option('heli', [{ min: 5, max: 10, cost: 100 }, { min: 11, max: 15, cost: 200 }])],
    });
    assert.deepEqual(check(data, 'el'), {});
  });

  /*
   * WAS: any bracket crossing an edge of the party range was refused, so `1–20`
   * on a 5–15 experience — which prices every size the form can actually offer —
   * failed the whole config and the live page fell back to "price on request".
   */
  test('brackets wider than the party range are generous, not wrong', () => {
    const data = experience({
      optionsEnabled: true,
      options: [option('heli', [{ min: 1, max: 20, cost: 100 }])],
    });
    assert.deepEqual(check(data, 'el'), {});
  });
});

describe('booking advisories — messages reach the field they are about', () => {
  /*
   * The engine calls a bookable thing a `resource`; the editor's field is
   * `options`. Untranslated, every message about one addressed a path no
   * control owns and rendered nowhere.
   */
  test('a resource issue is addressed to the `options` field', () => {
    const data = experience({
      optionsEnabled: true,
      options: [option('heli', [{ min: 5, max: 10, cost: 100 }])],
    });
    const paths = Object.keys(check(data, 'el'));
    assert.deepEqual(paths, ['options.0.seasonal.0.brackets']);
    assert.match(check(data, 'el')['options.0.seasonal.0.brackets'][0], /11, 12, 13/);
  });

  test('the row index is the FORM’s, not the engine’s', () => {
    // `toResourcePricing` drops rows with no id, so the engine's resource 0 is
    // the form's option 1 here. Pointing at option 0 would blame the wrong row.
    const data = experience({
      optionsEnabled: true,
      options: [{ name: { el: 'no id yet' } }, option('heli', [{ min: 5, max: 10, cost: 100 }])],
    });
    assert.deepEqual(Object.keys(check(data, 'el')), ['options.1.seasonal.0.brackets']);
  });

  test('an extras issue is addressed to `extrasOptions`', () => {
    const data = experience({ extrasEnabled: true, extrasMandatory: true, extrasOptions: [] });
    assert.deepEqual(Object.keys(check(data, 'el')), ['extrasOptions']);
  });

  test('a whole-row issue folds onto the repeater, naming the row', () => {
    // `tiers.1` addresses neither a control nor the repeater's own banner, so it
    // is folded up one level with the row number moved into the text.
    const data = experience({
      tiers: [
        { min: 5, max: 10, total: 1000 },
        { min: 8, max: 15, total: 2500 },
      ],
    });
    const map = check(data, 'el');
    assert.deepEqual(Object.keys(map), ['tiers']);
    assert.match(map.tiers[0], /^Row 2: /);
  });
});

describe('booking advisories — a stay is checked by the stay engine', () => {
  test('a stay reads its own fields, not the transport ones', () => {
    // Missing tiers must not be reported for something sold by the night.
    const data = { kind: 'stay', nightlyRate: 180, minNights: 1 };
    assert.deepEqual(check(data, 'el'), {});
  });
});

describe('booking advisories — never take the editor down', () => {
  test('half-typed and malformed values do not throw', () => {
    for (const data of [
      {},
      { kind: 'transport', tiers: 'not an array' },
      { kind: 'transport', hasPersons: true, pricingMode: 'tiered', tiers: [null] },
      { kind: 'transport', optionsEnabled: true, options: [{ id: 'x', seasonal: 'nope' }] },
    ]) {
      assert.doesNotThrow(() => check(data as Record<string, unknown>, 'el'));
    }
  });
});
