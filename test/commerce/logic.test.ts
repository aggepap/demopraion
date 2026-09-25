import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyProductQuery,
  buildFacets,
  buildTagFacet,
  computeDiscount,
  computeShipping,
  normaliseCoupon,
  filterByVisibility,
  findPickupLocation,
  groupedTotal,
  normalisePickup,
  parseMoneyMajor,
  pickupAvailable,
  toBadges,
  validateCoupon,
  type Coupon,
  type ProductSummary,
  type ShippingConfig,
} from '@/cms/modules/commerce';
import { lineWeight } from '@/cms/modules/commerce/shipping';

// ── Shipping ──────────────────────────────────────────────────────────────────

const baseShip: ShippingConfig = {
  method: 'flat',
  baseCharge: 3,
  freeThreshold: 100,
  weightTiers: [
    { minWeight: 2, charge: 2 },
    { minWeight: 5, charge: 5 },
  ],
  zones: [{ name: 'GR', countries: ['Greece'], charge: 3 }],
  paymentSurcharges: [{ provider: 'manual', charge: 1.5 }],
  pickup: { enabled: false, charge: 0, locations: [] },
};
const ctx = (over: Partial<Parameters<typeof computeShipping>[1]> = {}) => ({
  subtotalCents: 4000,
  totalWeight: 0,
  country: 'Greece',
  providerKey: 'manual',
  ...over,
});

describe('computeShipping', () => {
  test('flat: base charge + payment surcharge (cents)', () => {
    assert.deepEqual(computeShipping({ ...baseShip, method: 'flat' }, ctx()), {
      shipping: 300,
      surcharge: 150,
    });
  });

  test('weight: base + highest matching tier', () => {
    assert.equal(computeShipping({ ...baseShip, method: 'weight' }, ctx({ totalWeight: 6 })).shipping, 800);
    assert.equal(computeShipping({ ...baseShip, method: 'weight' }, ctx({ totalWeight: 3 })).shipping, 500);
    assert.equal(computeShipping({ ...baseShip, method: 'weight' }, ctx({ totalWeight: 1 })).shipping, 300);
  });

  test('zone: charge by country (case-insensitive), else base', () => {
    assert.equal(computeShipping({ ...baseShip, method: 'zone' }, ctx({ country: 'greece' })).shipping, 300);
    assert.equal(computeShipping({ ...baseShip, method: 'zone' }, ctx({ country: 'Spain' })).shipping, 300); // base fallback
  });

  test('free-shipping threshold zeros shipping but keeps the surcharge', () => {
    assert.deepEqual(computeShipping(baseShip, ctx({ subtotalCents: 12000 })), { shipping: 0, surcharge: 150 });
  });

  test('surcharge only for the matching provider', () => {
    assert.equal(computeShipping(baseShip, ctx({ providerKey: 'other' })).surcharge, 0);
  });
});

// ── Store pickup (§8) ─────────────────────────────────────────────────────────

const pickupShip: ShippingConfig = {
  ...baseShip,
  pickup: {
    enabled: true,
    charge: 2,
    locations: [
      { id: 'athens', name: 'Athens store', address: 'Ermou 1' },
      { id: 'patras', name: 'Patras store' },
    ],
  },
};

describe('computeShipping — store pickup', () => {
  test('pickup charges the pickup fee instead of shipping, keeping the surcharge', () => {
    assert.deepEqual(computeShipping(pickupShip, ctx({ delivery: 'pickup' })), {
      shipping: 200,
      surcharge: 150,
    });
  });

  test('pickup ignores zones, weight tiers and the free-shipping threshold', () => {
    const zoned = { ...pickupShip, method: 'zone' as const };
    assert.equal(computeShipping(zoned, ctx({ delivery: 'pickup', country: 'Greece' })).shipping, 200);
    const heavy = { ...pickupShip, method: 'weight' as const };
    assert.equal(computeShipping(heavy, ctx({ delivery: 'pickup', totalWeight: 9 })).shipping, 200);
    // Above the free threshold the pickup fee still stands (it's a handling fee).
    assert.equal(computeShipping(pickupShip, ctx({ delivery: 'pickup', subtotalCents: 12000 })).shipping, 200);
  });

  test('a free pickup costs nothing', () => {
    const free = { ...pickupShip, pickup: { ...pickupShip.pickup, charge: 0 } };
    assert.equal(computeShipping(free, ctx({ delivery: 'pickup' })).shipping, 0);
  });

  test('pickup on a config with it disabled falls back to normal shipping', () => {
    assert.equal(computeShipping(baseShip, ctx({ delivery: 'pickup' })).shipping, 300);
  });

  test('an absent delivery method is shipping, unchanged', () => {
    assert.deepEqual(computeShipping(pickupShip, ctx()), computeShipping(baseShip, ctx()));
  });
});

describe('pickupAvailable / findPickupLocation', () => {
  test('availability follows the enabled flag', () => {
    assert.equal(pickupAvailable(pickupShip), true);
    assert.equal(pickupAvailable(baseShip), false);
  });

  test('resolves a configured location by id; unknown ids resolve to nothing', () => {
    assert.equal(findPickupLocation(pickupShip, 'patras')?.name, 'Patras store');
    assert.equal(findPickupLocation(pickupShip, 'nope'), undefined);
    assert.equal(findPickupLocation(pickupShip, undefined), undefined);
  });

  test('with no locations configured there is nothing to resolve (single implicit store)', () => {
    const single = { ...pickupShip, pickup: { ...pickupShip.pickup, locations: [] } };
    assert.equal(findPickupLocation(single, 'anything'), undefined);
  });
});

describe('normalisePickup', () => {
  test('defaults a missing/garbage block to disabled', () => {
    assert.deepEqual(normalisePickup(undefined), { enabled: false, charge: 0, locations: [] });
    assert.deepEqual(normalisePickup('nope'), { enabled: false, charge: 0, locations: [] });
  });

  test('drops nameless locations, trims, and backfills a missing id', () => {
    assert.deepEqual(
      normalisePickup({
        enabled: true,
        charge: '2.5',
        locations: [
          { name: '  Athens  ', address: ' Ermou 1 ', hours: '' },
          { id: 'p', name: 'Patras' },
          { name: '   ' },
        ],
      }),
      {
        enabled: true,
        charge: 2.5,
        locations: [
          { id: 'loc-1', name: 'Athens', address: 'Ermou 1', hours: undefined },
          { id: 'p', name: 'Patras', address: undefined, hours: undefined },
        ],
      },
    );
  });
});

describe('lineWeight', () => {
  test('variation weight overrides product weight', () => {
    const data = { weight: 1, variations: [{ id: 'v1', weight: 3 }] };
    assert.equal(lineWeight(data, 'v1'), 3);
    assert.equal(lineWeight(data, undefined), 1);
    assert.equal(lineWeight({}, undefined), 0);
  });
});

// ── Coupons ───────────────────────────────────────────────────────────────────

const coupon = (over: Partial<Coupon>): Coupon => ({
  code: 'X',
  type: 'percent',
  value: 10,
  minSubtotal: 0,
  expiresAt: '',
  usageLimit: 0,
  perCustomerLimit: 0,
  active: true,
  ...over,
});

describe('normaliseCoupon', () => {
  // F-039: the percent had no upper bound anywhere, though the contract said 0-100.
  test('a percentage is bounded to 0-100 on the way in', () => {
    // Structured settings keys are not validated when written, so this read-time
    // normaliser is the only place the stored list is made to mean anything.
    // `value` was documented as "Percent (0-100)" and nothing enforced it: 15
    // mistyped as 150 was stored, shown back as 150, and discounted the entire
    // subtotal — free, rather than visibly wrong. Now the admin sees 100, which
    // is what would actually happen.
    assert.equal(normaliseCoupon({ code: 'X', type: 'percent', value: 150 }).value, 100);
    assert.equal(normaliseCoupon({ code: 'X', type: 'percent', value: -5 }).value, 0);
    assert.equal(normaliseCoupon({ code: 'X', type: 'percent', value: 15 }).value, 15);
    // A fixed amount is money, not a proportion, so only the floor applies.
    assert.equal(normaliseCoupon({ code: 'X', type: 'fixed', value: 5000 }).value, 5000);
    assert.equal(normaliseCoupon({ code: 'X', type: 'fixed', value: -1 }).value, 0);
  });

  test('junk degrades to a usable coupon rather than throwing', () => {
    const c = normaliseCoupon({ code: 42, type: 'nonsense', value: 'abc', active: false });
    assert.equal(c.code, '42');
    assert.equal(c.type, 'percent');
    assert.equal(c.value, 0);
    assert.equal(c.active, false);
  });
});

describe('computeDiscount', () => {
  test('percent of subtotal', () => {
    assert.equal(computeDiscount(coupon({ type: 'percent', value: 10 }), 4000), 400);
  });
  test('fixed amount, capped at the subtotal', () => {
    assert.equal(computeDiscount(coupon({ type: 'fixed', value: 5 }), 4000), 500);
    assert.equal(computeDiscount(coupon({ type: 'fixed', value: 5 }), 300), 300);
  });
  test('the cap at the subtotal is what stops an over-discount', () => {
    // Worth stating plainly: this was already safe. A percentage above 100 could
    // never take a total negative, because the discount is capped at the subtotal.
    assert.equal(computeDiscount(coupon({ type: 'percent', value: 150 }), 4000), 4000);
    assert.equal(computeDiscount(coupon({ type: 'percent', value: -20 }), 4000), 0);
  });
});

describe('validateCoupon', () => {
  const list = [
    coupon({ code: 'SAVE10', type: 'percent', value: 10 }),
    coupon({ code: 'FIVE', type: 'fixed', value: 5, minSubtotal: 30 }),
    coupon({ code: 'OLD', expiresAt: '2020-01-01' }),
    coupon({ code: 'OFF', active: false }),
  ];

  test('valid percent coupon (case-insensitive code)', () => {
    assert.deepEqual(validateCoupon(list, 'save10', 4000), { valid: true, code: 'SAVE10', discount: 400 });
  });
  test('min-subtotal not met', () => {
    assert.deepEqual(validateCoupon(list, 'FIVE', 2000), { valid: false, reason: 'min_subtotal' });
  });
  test('min-subtotal met', () => {
    assert.deepEqual(validateCoupon(list, 'FIVE', 4000), { valid: true, code: 'FIVE', discount: 500 });
  });
  test('expired / inactive / unknown', () => {
    assert.deepEqual(validateCoupon(list, 'OLD', 4000), { valid: false, reason: 'expired' });
    assert.deepEqual(validateCoupon(list, 'OFF', 4000), { valid: false, reason: 'inactive' });
    assert.deepEqual(validateCoupon(list, 'NOPE', 4000), { valid: false, reason: 'not_found' });
  });
});

// ── Product query + facets ────────────────────────────────────────────────────

const prod = (over: Partial<ProductSummary>): ProductSummary => ({
  id: 1,
  slug: 's',
  title: 'T',
  price: 0,
  currency: 'EUR',
  availability: 'in-stock',
  href: '/shop/s',
  facets: [],
  featured: false,
  visibility: 'visible',
  badges: [],
  productType: 'standard',
  menuOrder: null,
  tags: [],
  ...over,
});

const tag = (slug: string, title = slug.toUpperCase()) => ({ slug, title });

const catalog: ProductSummary[] = [
  prod({ slug: 'a', title: 'Alpha Chair', subtitle: 'wood', price: 50, facets: [
      { name: 'Color', display: 'swatches', values: [{ label: 'Red', color: '#f00' }] },
      { name: 'Size', display: 'list', values: [{ label: 'S' }, { label: 'M' }] },
    ], tags: [tag('sale'), tag('new')] }),
  prod({ slug: 'b', title: 'Beta Table', subtitle: 'oak', price: 30, facets: [{ name: 'Color', display: 'swatches', values: [{ label: 'Blue', color: '#00f' }] }], tags: [tag('new')] }),
  prod({ slug: 'c', title: 'Gamma Lamp', price: 80, facets: [] }),
  prod({ slug: 'd', title: 'Delta Chair', subtitle: 'metal', price: 20, facets: [{ name: 'Color', display: 'swatches', values: [{ label: 'Red', color: '#f00' }] }], tags: [tag('sale')] }),
];

describe('applyProductQuery', () => {
  test('keyword search over title + subtitle (case-insensitive)', () => {
    assert.deepEqual(applyProductQuery(catalog, { q: 'chair' }).items.map((p) => p.slug), ['a', 'd']);
    assert.deepEqual(applyProductQuery(catalog, { q: 'oak' }).items.map((p) => p.slug), ['b']);
  });

  test('sort by price and name', () => {
    assert.deepEqual(applyProductQuery(catalog, { sort: 'price-asc' }).items.map((p) => p.price), [20, 30, 50, 80]);
    assert.deepEqual(applyProductQuery(catalog, { sort: 'price-desc' }).items.map((p) => p.price), [80, 50, 30, 20]);
    assert.deepEqual(applyProductQuery(catalog, { sort: 'name' }).items.map((p) => p.title), [
      'Alpha Chair',
      'Beta Table',
      'Delta Chair',
      'Gamma Lamp',
    ]);
  });

  test('pagination reports total and slices', () => {
    const r = applyProductQuery(catalog, { pageSize: 2, page: 2 });
    assert.equal(r.total, 4);
    assert.equal(r.items.length, 2);
    assert.deepEqual(r.items.map((p) => p.slug), ['c', 'd']);
  });

  test('price range filter', () => {
    assert.deepEqual(applyProductQuery(catalog, { minPrice: 25, maxPrice: 55 }).items.map((p) => p.slug), ['a', 'b']);
  });

  test('attribute filter: OR within, AND across', () => {
    assert.deepEqual(applyProductQuery(catalog, { attrs: { Color: ['Red'] } }).items.map((p) => p.slug), ['a', 'd']);
    assert.deepEqual(applyProductQuery(catalog, { attrs: { Color: ['Red', 'Blue'] } }).items.map((p) => p.slug), ['a', 'b', 'd']);
    assert.deepEqual(applyProductQuery(catalog, { attrs: { Color: ['Red'], Size: ['M'] } }).items.map((p) => p.slug), ['a']);
  });

  test('tag filter: OR across the selected slugs; untagged products drop out', () => {
    assert.deepEqual(applyProductQuery(catalog, { tags: ['sale'] }).items.map((p) => p.slug), ['a', 'd']);
    assert.deepEqual(applyProductQuery(catalog, { tags: ['sale', 'new'] }).items.map((p) => p.slug), ['a', 'b', 'd']);
    assert.deepEqual(applyProductQuery(catalog, { tags: ['unknown'] }).items, []);
    // Empty / blank selections are a no-op, not a "match nothing".
    assert.equal(applyProductQuery(catalog, { tags: [] }).total, 4);
    assert.equal(applyProductQuery(catalog, { tags: [''] }).total, 4);
  });

  test('tag + attribute filters compose (AND)', () => {
    assert.deepEqual(
      applyProductQuery(catalog, { tags: ['new'], attrs: { Color: ['Blue'] } }).items.map((p) => p.slug),
      ['b'],
    );
  });
});

describe('buildFacets', () => {
  test('aggregates distinct attribute values, sorted, keeping each swatch', () => {
    assert.deepEqual(buildFacets(catalog), [
      {
        name: 'Color',
        display: 'swatches',
        values: [
          { label: 'Blue', color: '#00f' },
          { label: 'Red', color: '#f00' },
        ],
      },
      { name: 'Size', display: 'list', values: [{ label: 'M' }, { label: 'S' }] },
    ]);
  });
});

describe('buildTagFacet', () => {
  test('distinct tags across the set, deduped by slug and sorted by title', () => {
    assert.deepEqual(buildTagFacet(catalog), [
      { slug: 'new', title: 'NEW' },
      { slug: 'sale', title: 'SALE' },
    ]);
  });

  test('an untagged set has no tag filter', () => {
    assert.deepEqual(buildTagFacet([prod({ slug: 'x' })]), []);
  });
});

// ── Merchandising: visibility, featured, badges ───────────────────────────────

describe('filterByVisibility', () => {
  const mixed: ProductSummary[] = [
    prod({ slug: 'v', visibility: 'visible' }),
    prod({ slug: 'c', visibility: 'catalog' }),
    prod({ slug: 's', visibility: 'search' }),
    prod({ slug: 'h', visibility: 'hidden' }),
  ];

  test('catalog browsing drops search-only and hidden', () => {
    assert.deepEqual(filterByVisibility(mixed, 'catalog').map((p) => p.slug), ['v', 'c']);
  });

  test('search results drop catalog-only and hidden', () => {
    assert.deepEqual(filterByVisibility(mixed, 'search').map((p) => p.slug), ['v', 's']);
  });
});

describe('featured ordering', () => {
  const withFeatured: ProductSummary[] = [
    prod({ slug: 'a', price: 50 }),
    prod({ slug: 'b', price: 30, featured: true }),
    prod({ slug: 'c', price: 80 }),
    prod({ slug: 'd', price: 20, featured: true }),
  ];

  test('the default sort floats featured products, keeping source order within each group', () => {
    assert.deepEqual(applyProductQuery(withFeatured).items.map((p) => p.slug), ['b', 'd', 'a', 'c']);
  });

  test('an explicit sort is left alone', () => {
    assert.deepEqual(
      applyProductQuery(withFeatured, { sort: 'price-asc' }).items.map((p) => p.slug),
      ['d', 'b', 'a', 'c'],
    );
  });
});

describe('manual sort (menuOrder)', () => {
  const list = [
    prod({ slug: 'a', menuOrder: 2 }),
    prod({ slug: 'b', menuOrder: null }),
    prod({ slug: 'c', menuOrder: 1 }),
    prod({ slug: 'd', menuOrder: null }),
  ];
  test('lower menuOrder first; unset keeps source order at the tail', () => {
    assert.deepEqual(applyProductQuery(list, { sort: 'manual' }).items.map((p) => p.slug), ['c', 'a', 'b', 'd']);
  });
});

describe('parseMoneyMajor', () => {
  test('parses positive numbers/strings; junk and non-positive → 0', () => {
    assert.equal(parseMoneyMajor('3.50'), 3.5);
    assert.equal(parseMoneyMajor(2), 2);
    assert.equal(parseMoneyMajor('  4 '), 4);
    assert.equal(parseMoneyMajor(''), 0);
    assert.equal(parseMoneyMajor('abc'), 0);
    assert.equal(parseMoneyMajor('-5'), 0);
    assert.equal(parseMoneyMajor(null), 0);
  });
});

describe('groupedTotal', () => {
  test('sums price × quantity across components', () => {
    assert.equal(groupedTotal([{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }]), 25);
  });
  test('treats a missing/zero quantity as 1', () => {
    assert.equal(groupedTotal([{ price: 12, quantity: 0 }]), 12);
  });
  test('empty set is zero', () => {
    assert.equal(groupedTotal([]), 0);
  });
});

describe('toBadges', () => {
  test('derives Sale only when compare-at actually beats the price', () => {
    assert.deepEqual(toBadges({ price: 30, compareAtPrice: 50 }, 'el'), [{ kind: 'sale' }]);
    assert.deepEqual(toBadges({ price: 50, compareAtPrice: 50 }, 'el'), []);
    assert.deepEqual(toBadges({ price: 50, compareAtPrice: 30 }, 'el'), []);
  });

  test('stored badges follow the derived one; unknown values are ignored', () => {
    assert.deepEqual(toBadges({ price: 30, compareAtPrice: 50, badges: ['new', 'nope'] }, 'el'), [
      { kind: 'sale' },
      { kind: 'new' },
    ]);
  });

  test('a custom label resolves for the locale', () => {
    assert.deepEqual(
      toBadges({ price: 10, badgeLabel: { el: 'Περιορισμένη', en: 'Limited' } }, 'en'),
      [{ kind: 'custom', label: 'Limited' }],
    );
  });
});
