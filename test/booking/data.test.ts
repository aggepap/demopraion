/**
 * Reading a booking document's `data`.
 *
 * These cover the option list (rows on the experience), the term vocabulary
 * behind the three filter dimensions (documents the experience points at), and
 * the filtering that runs on both.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { slugify, slugifyLocalized } from '@/cms/core/slug';
import { BOOKING_KIND_VALUES } from '@/cms/modules/booking/collection';
import {
  applyBookingQuery,
  countTermUsage,
  lowestPrice,
  readBookingKind,
  readItemCapacity,
  readOptions,
  termIdsBySlug,
  toResourcePricing,
  toSummary,
  type BookingSummary,
  type BookingTermIndex,
} from '@/cms/modules/booking/data';

const NO_TERMS: BookingTermIndex = { categories: new Map(), types: new Map(), departures: new Map() };

describe('slugify', () => {
  test('Greek is transliterated, not discarded', () => {
    // The site's DEFAULT locale is Greek. An ASCII-only slug would be empty for
    // every Greek term, collapsing the whole vocabulary onto one bogus key.
    assert.equal(slugify('Μύκονος'), 'mykonos');
    assert.equal(slugify('Πάρος'), 'paros');
    assert.equal(slugify('Θεσσαλονίκη'), 'thessaloniki');
    assert.equal(slugify('Παλιό Λιμάνι'), 'palio-limani');
  });

  test('digraphs read the way Greek does', () => {
    assert.equal(slugify('Λουτράκι'), 'loutraki');
    assert.equal(slugify('Ναύπλιο'), 'navplio');
  });

  test('Latin still behaves', () => {
    assert.equal(slugify('Mykonos Old Port'), 'mykonos-old-port');
    assert.equal(slugify('  Éclair & Co.  '), 'eclair-co');
    assert.equal(slugify(''), '');
    assert.equal(slugify(undefined), '');
  });

  test('a localized label picks a locale deterministically', () => {
    // Sorted keys, so the same row yields the same key on every page and in
    // every language — otherwise a filter URL would stop matching on a language
    // switch. `migrate-booking-facets` derives a term's slug the same way, which
    // is what keeps pre-migration `/booking?departure=…` URLs resolving.
    assert.equal(slugifyLocalized({ en: 'Mykonos', el: 'Μύκονος' }), 'mykonos');
    assert.equal(slugifyLocalized({ el: 'Μύκονος', en: 'Mykonos' }), 'mykonos');
    // 'el' sorts before 'en', so Greek is what decides when they differ.
    assert.equal(slugifyLocalized({ en: 'Old Port', el: 'Παλιό Λιμάνι' }), 'palio-limani');
    // …and an empty Greek value falls through to the next locale rather than
    // yielding nothing.
    assert.equal(slugifyLocalized({ el: '', en: 'Old Port' }), 'old-port');
  });
});

describe('readBookingKind', () => {
  test('every declared kind reads back as itself', () => {
    // Checked against the declared list, not tested for one value. The shorter
    // `kind === 'stay' ? 'stay' : 'transport'` worked for exactly two kinds and
    // would fail SILENTLY at three — a third kind priced by the transport
    // engine, answering 200 with a wrong number, and TypeScript unable to see it.
    for (const kind of BOOKING_KIND_VALUES) {
      assert.equal(readBookingKind({ kind }), kind);
    }
  });

  test('absent or unrecognised is transport', () => {
    // Every experience authored before the field existed.
    assert.equal(readBookingKind({}), 'transport');
    assert.equal(readBookingKind({ kind: 'nonsense' }), 'transport');
    assert.equal(readBookingKind({ kind: 42 }), 'transport');
    assert.equal(readBookingKind({ kind: '' }), 'transport');
  });
});

describe('readItemCapacity', () => {
  test('the experience\'s own figure wins over the site default', () => {
    assert.equal(readItemCapacity({ capacityPerDay: 1 }, 5), 1);
    assert.equal(readItemCapacity({ capacityPerDay: 12 }, 5), 12);
  });

  test('an unstated capacity falls back to the site default', () => {
    // Authored before the field existed, or deliberately left blank.
    assert.equal(readItemCapacity({}, 5), 5);
    assert.equal(readItemCapacity({ capacityPerDay: null }, 5), 5);
    assert.equal(readItemCapacity({ capacityPerDay: '' }, 5), 5);
  });

  test('a nonsense capacity falls back rather than overselling', () => {
    assert.equal(readItemCapacity({ capacityPerDay: 0 }, 5), 5);
    assert.equal(readItemCapacity({ capacityPerDay: -3 }, 5), 5);
    assert.equal(readItemCapacity({ capacityPerDay: 'lots' }, 5), 5);
    assert.equal(readItemCapacity({ capacityPerDay: Number.POSITIVE_INFINITY }, 5), 5);
  });

  test('a fractional capacity floors — half a place is no place', () => {
    assert.equal(readItemCapacity({ capacityPerDay: 2.9 }, 5), 2);
  });

  test('a numeric string is accepted, as the CMS may store one', () => {
    assert.equal(readItemCapacity({ capacityPerDay: '3' }, 5), 3);
  });
});

describe('readOptions', () => {
  const data = {
    options: [
      { id: 'opt-a', name: { en: 'Blue Pearl', el: 'Γαλάζιο Μαργαριτάρι' }, cost: 450, capacityPerDay: 1, seats: 8 },
      { id: 'opt-b', name: { en: 'Sea Ray' }, cost: 380, capacityPerDay: 3 },
    ],
  };

  test('rows come back in author order with their own ids', () => {
    const options = readOptions(data, 'en');
    assert.deepEqual(options.map((o) => o.groupId), ['opt-a', 'opt-b']);
    assert.deepEqual(options.map((o) => o.title), ['Blue Pearl', 'Sea Ray']);
  });

  test('titles resolve per locale', () => {
    assert.equal(readOptions(data, 'el')[0].title, 'Γαλάζιο Μαργαριτάρι');
  });

  test('capacity defaults to 1 and seats to 0', () => {
    const options = readOptions(data, 'en');
    assert.equal(options[0].capacityPerDay, 1);
    assert.equal(options[0].seats, 8);
    assert.equal(options[1].capacityPerDay, 3);
    assert.equal(options[1].seats, 0);
  });

  test('a row with no id is dropped', () => {
    // It could never be selected, priced or held — offering it would offer
    // something the customer can never book.
    assert.equal(readOptions({ options: [{ name: 'Nameless', cost: 100 }] }, 'en').length, 0);
    assert.equal(readOptions({ options: [{ id: '   ', cost: 100 }] }, 'en').length, 0);
  });

  test('a missing or malformed options key is an empty list, not a throw', () => {
    assert.deepEqual(readOptions({}, 'en'), []);
    assert.deepEqual(readOptions({ options: 'nope' }, 'en'), []);
  });
});

describe('toResourcePricing', () => {
  test('the row id becomes the engine id — no document lookup', () => {
    const cfg = toResourcePricing(
      { options: [{ id: 'opt-a', name: 'Blue Pearl', cost: 450, seats: 8 }] },
      'en',
    );
    assert.equal(cfg[0].id, 'opt-a');
    assert.equal(cfg[0].label, 'Blue Pearl');
    assert.equal(cfg[0].cost, 450);
    assert.equal(cfg[0].seats, 8);
  });

  test('two rows sharing an id keep it, so the duplicate can be reported', () => {
    const cfg = toResourcePricing(
      { options: [{ id: 'dup', name: 'A', cost: 1 }, { id: 'dup', name: 'B', cost: 2 }] },
      'en',
    );
    assert.deepEqual(cfg.map((r) => r.id), ['dup', 'dup']);
  });

  test('seasonal costs and brackets carry through', () => {
    const cfg = toResourcePricing(
      {
        options: [
          {
            id: 'opt-a',
            name: 'Blue Pearl',
            cost: 450,
            seasonal: [
              { id: 's1', from: '06-01', to: '09-30', cost: 600, perPerson: true, brackets: [{ min: 1, max: 4, cost: 500 }] },
            ],
          },
        ],
      },
      'en',
    );
    assert.equal(cfg[0].seasonal?.[0].cost, 600);
    assert.equal(cfg[0].seasonal?.[0].perPerson, true);
    assert.deepEqual(cfg[0].seasonal?.[0].brackets, [{ min: 1, max: 4, cost: 500 }]);
  });
});

describe('lowestPrice', () => {
  test('transport reads the base price and its seasons', () => {
    assert.equal(lowestPrice({ basePrice: 450, seasonalPrices: [{ price: 380 }] }), 380);
    assert.equal(lowestPrice({ basePrice: 450 }), 450);
  });

  test('a stay reads the nightly rate and its seasons instead', () => {
    assert.equal(lowestPrice({ kind: 'stay', nightlyRate: 180, seasonalRates: [{ rate: 140 }] }), 140);
    // …and must not be fooled by a leftover transport base price.
    assert.equal(lowestPrice({ kind: 'stay', nightlyRate: 180, basePrice: 9999 }), 180);
  });

  test('the cheapest option counts, because an option REPLACES the rate', () => {
    // Advertising "from 180" when the cheapest room is 140 would be a lie.
    assert.equal(
      lowestPrice({ kind: 'stay', nightlyRate: 180, options: [{ id: 'a', cost: 140 }, { id: 'b', cost: 260 }] }),
      140,
    );
  });

  test('nothing priced is null, which the card shows as "on request"', () => {
    assert.equal(lowestPrice({}), null);
    assert.equal(lowestPrice({ basePrice: '' }), null);
    assert.equal(lowestPrice({ basePrice: 0 }), null);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

function item(over: Partial<BookingSummary> = {}): BookingSummary {
  return {
    id: 1,
    slug: 'x',
    title: 'X',
    href: '/booking/x',
    kind: 'transport',
    fromPrice: null,
    quickInfo: [],
    categoryIds: [],
    typeIds: [],
    departureIds: [],
    ...over,
  };
}

const mykonos = { id: 10, slug: 'mykonos', title: 'Mykonos' };
const paros = { id: 11, slug: 'paros', title: 'Paros' };
const yacht = { id: 20, slug: 'yacht', title: 'Yacht' };

describe('countTermUsage', () => {
  test('one term document, counted across the experiences that point at it', () => {
    const terms = countTermUsage(
      [mykonos, paros],
      [item({ id: 1, departureIds: [10] }), item({ id: 2, departureIds: [10, 11] })],
      (i) => i.departureIds,
    );
    assert.deepEqual(terms, [
      { slug: 'mykonos', title: 'Mykonos', count: 2 },
      { slug: 'paros', title: 'Paros', count: 1 },
    ]);
  });

  test('one experience listing a term twice counts once', () => {
    // The facet answers "how many experiences", not "how many rows".
    const terms = countTermUsage([mykonos], [item({ departureIds: [10, 10] })], (i) => i.departureIds);
    assert.equal(terms[0].count, 1);
  });

  test('a term nobody uses is KEPT, with a count of zero', () => {
    // It used to be impossible: the vocabulary was derived from the experiences,
    // so an unused term did not exist. A curated vocabulary can hold one, and
    // `BookingFilters` is what hides it — it drops `count === 0` per term AND
    // drops a whole dimension where every term is zero, which is still what
    // makes a stay-only site show no Vessel type filter.
    assert.deepEqual(countTermUsage([yacht], [item({ kind: 'stay' })], (i) => i.typeIds), [
      { slug: 'yacht', title: 'Yacht', count: 0 },
    ]);
  });

  test('an id nothing in the vocabulary matches is ignored', () => {
    // A term deleted while an experience still referenced it: the stale id is
    // inert rather than a phantom filter entry.
    assert.deepEqual(countTermUsage([mykonos], [item({ departureIds: [999] })], (i) => i.departureIds), [
      { slug: 'mykonos', title: 'Mykonos', count: 0 },
    ]);
  });

  test('terms are sorted by title', () => {
    const terms = countTermUsage([paros, mykonos], [item({ departureIds: [10, 11] })], (i) => i.departureIds);
    assert.deepEqual(terms.map((t) => t.slug), ['mykonos', 'paros']);
  });
});

describe('termIdsBySlug', () => {
  test('maps the URL slug onto the term document id', () => {
    assert.deepEqual([...termIdsBySlug([mykonos, paros])], [
      ['mykonos', 10],
      ['paros', 11],
    ]);
  });
});

describe('applyBookingQuery', () => {
  const items = [
    item({ id: 1, title: 'Sunset Cruise', fromPrice: 450, departureIds: [10], typeIds: [20] }),
    item({ id: 2, title: 'Villa Nerea', kind: 'stay', fromPrice: 180 }),
    item({ id: 3, title: 'Island Hop', fromPrice: null, departureIds: [11] }),
  ];
  // The index the listing page builds from the loaded term documents.
  const TERMS: BookingTermIndex = {
    categories: new Map(),
    types: termIdsBySlug([yacht]),
    departures: termIdsBySlug([mykonos, paros]),
  };

  test('a departure filter resolves the URL slug onto a term id', () => {
    const out = applyBookingQuery(items, { departures: ['mykonos'] }, TERMS);
    assert.deepEqual(out.map((i) => i.id), [1]);
  });

  test('several slugs are an OR', () => {
    const out = applyBookingQuery(items, { departures: ['mykonos', 'paros'] }, TERMS);
    assert.deepEqual(out.map((i) => i.id).sort(), [1, 3]);
  });

  test('an unknown departure slug yields nothing rather than being ignored', () => {
    // Silently widening the set would show the visitor things they excluded.
    assert.deepEqual(applyBookingQuery(items, { departures: ['nowhere'] }, TERMS), []);
  });

  test('an unknown vessel-type slug is likewise empty, not ignored', () => {
    // All three dimensions go through one branch now, so this is the same rule
    // categories have always had rather than a happy accident of slug matching.
    assert.deepEqual(applyBookingQuery(items, { types: ['hovercraft'] }, TERMS), []);
  });

  test('an unknown category slug is likewise empty, not ignored', () => {
    assert.deepEqual(applyBookingQuery(items, { categories: ['ghost'] }, TERMS), []);
  });

  test('search matches title and subtitle', () => {
    assert.deepEqual(
      applyBookingQuery(items, { q: 'villa' }, NO_TERMS).map((i) => i.id),
      [2],
    );
  });

  test('unpriced items sort last in BOTH directions', () => {
    // "On request" is not cheapest, and it is not most expensive either.
    assert.deepEqual(
      applyBookingQuery(items, { sort: 'price-asc' }, NO_TERMS).map((i) => i.id),
      [2, 1, 3],
    );
    assert.equal(applyBookingQuery(items, { sort: 'price-desc' }, NO_TERMS).at(-1)?.id, 3);
  });

  test('filters compose', () => {
    const out = applyBookingQuery(items, { departures: ['mykonos'], types: ['yacht'] }, TERMS);
    assert.deepEqual(out.map((i) => i.id), [1]);
    assert.deepEqual(applyBookingQuery(items, { departures: ['paros'], types: ['yacht'] }, TERMS), []);
  });
});

describe('toSummary', () => {
  test('reads kind, facets and price off the raw document data', () => {
    const summary = toSummary(
      {
        id: 7,
        slug: 'villa-nerea',
        data: {
          kind: 'stay',
          title: { en: 'Villa Nerea', el: 'Βίλα Νηρέα' },
          nightlyRate: 180,
          departures: [42],
          gallery: [{ image: 'img-uuid' }],
        },
      },
      'el',
    );
    assert.equal(summary.kind, 'stay');
    assert.equal(summary.title, 'Βίλα Νηρέα');
    assert.equal(summary.fromPrice, 180);
    assert.equal(summary.image, 'img-uuid');
    assert.equal(summary.href, '/booking/villa-nerea');
    // Departures are read whatever the kind — the editor may have set them
    // before switching to a stay, and hiding a field never discards its value.
    assert.deepEqual(summary.departureIds, [42]);
  });

  test('a document still holding the pre-migration rows reads as no facets', () => {
    // `migrate-booking-facets` turns `[{id,label,slug}]` into `[id]`. Until it
    // runs, the READ path has to degrade rather than throw — the site keeps
    // rendering, just without those filters. (The document's next SAVE is what
    // fails: a `many` relation validates as `number[]`.)
    const summary = toSummary(
      { id: 8, slug: 'legacy', data: { departures: [{ id: 'd1', label: { en: 'Paros' } }], types: [{ id: 't1' }] } },
      'en',
    );
    assert.deepEqual(summary.departureIds, []);
    assert.deepEqual(summary.typeIds, []);
  });
});
