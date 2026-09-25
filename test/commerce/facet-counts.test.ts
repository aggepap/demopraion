import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildFacetCounts, type ProductSummary } from '@/cms/modules/commerce/read';

/**
 * Counts beside each filter value, as the Kitty design shows them.
 *
 * The counts are DISJUNCTIVE: a value's count ignores the other choices made
 * within its own attribute, but honours every other filter. Without that rule,
 * picking "Red" would show every other colour as "(0)" — the list would tell a
 * shopper that the shop has nothing else in stock, when it is only their own
 * choice narrowing the view. Across attributes the filters do still apply, so
 * "Red (3)" under Size=S means three red products that also come in small.
 */

const prod = (over: Partial<ProductSummary> = {}): ProductSummary => ({
  id: 1,
  slug: 's',
  title: 'T',
  price: 10,
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

const color = (value: string, over: Record<string, unknown> = {}) => ({
  name: 'Color',
  display: 'swatches' as const,
  values: [{ label: value, color: value === 'Red' ? '#f00' : '#00f', ...over }],
});
const size = (value: string) => ({
  name: 'Size',
  display: 'list' as const,
  values: [{ label: value }],
});

const products = [
  prod({ slug: 'a', price: 10, facets: [color('Red'), size('S')] }),
  prod({ slug: 'b', price: 20, facets: [color('Red'), size('M')] }),
  prod({ slug: 'c', price: 30, facets: [color('Blue'), size('S')] }),
  prod({ slug: 'd', price: 40, facets: [color('Green'), size('L')] }),
];

const counts = (facets: ReturnType<typeof buildFacetCounts>, name: string) =>
  Object.fromEntries(
    (facets.find((f) => f.name === name)?.values ?? []).map((v) => [v.label, v.count])
  );

describe('buildFacetCounts', () => {
  test('with nothing selected, every value counts its products', () => {
    const out = buildFacetCounts(products, {});
    assert.deepEqual(counts(out, 'Color'), { Blue: 1, Green: 1, Red: 2 });
    assert.deepEqual(counts(out, 'Size'), { L: 1, M: 1, S: 2 });
  });

  test('a choice does not collapse the counts of its own attribute', () => {
    const out = buildFacetCounts(products, { attrs: { Color: ['Red'] } });
    assert.deepEqual(counts(out, 'Color'), { Blue: 1, Green: 1, Red: 2 });
  });

  test('but it does narrow every other attribute', () => {
    const out = buildFacetCounts(products, { attrs: { Color: ['Red'] } });
    assert.deepEqual(counts(out, 'Size'), { L: 0, M: 1, S: 1 });
  });

  test('a value nothing matches is kept, at zero, rather than disappearing', () => {
    // Removing it would make the list jump around as choices change, and hide
    // that the shop stocks the colour at all.
    const out = buildFacetCounts(products, { attrs: { Size: ['S'] } });
    assert.equal(counts(out, 'Color').Green, 0);
  });

  test('other filters count too — price, keyword and tags', () => {
    assert.deepEqual(counts(buildFacetCounts(products, { maxPrice: 20 }), 'Color'), {
      Blue: 0,
      Green: 0,
      Red: 2,
    });
  });

  test('values and attributes are ordered the same way the old filter listed them', () => {
    const out = buildFacetCounts(products, {});
    assert.deepEqual(
      out.map((f) => f.name),
      ['Color', 'Size']
    );
    assert.deepEqual(
      out[0].values.map((v) => v.label),
      ['Blue', 'Green', 'Red']
    );
  });

  test('carries the swatch colour and image through for the UI', () => {
    const withImage = [
      prod({
        facets: [
          { name: 'Finish', display: 'swatches', values: [{ label: 'Oak', image: '/oak.webp' }] },
        ],
      }),
    ];
    const out = buildFacetCounts(withImage, {});
    assert.deepEqual(out[0].values[0], { label: 'Oak', image: '/oak.webp', count: 1 });
  });

  test('an attribute is displayed as its products declare', () => {
    const out = buildFacetCounts(products, {});
    assert.equal(out.find((f) => f.name === 'Color')?.display, 'swatches');
    assert.equal(out.find((f) => f.name === 'Size')?.display, 'list');
  });

  test('no products means no facets', () => {
    assert.deepEqual(buildFacetCounts([], {}), []);
  });
});

describe('counting past one page', () => {
  test('counts the whole list, not just the first page of it', () => {
    // `applyProductQuery` pages at 48. Counting through it silently capped
    // every count at a page — on a real shop, "Red (48)" for 300 red products.
    const many = Array.from({ length: 120 }, (_, i) =>
      prod({ slug: `p${i}`, facets: [color('Red')] }),
    );
    assert.deepEqual(counts(buildFacetCounts(many, {}), 'Color'), { Red: 120 });
  });

  test('and still applies the other filters while doing it', () => {
    const many = [
      ...Array.from({ length: 60 }, (_, i) => prod({ slug: `a${i}`, price: 10, facets: [color('Red')] })),
      ...Array.from({ length: 60 }, (_, i) => prod({ slug: `b${i}`, price: 90, facets: [color('Red')] })),
    ];
    assert.deepEqual(counts(buildFacetCounts(many, { maxPrice: 50 }), 'Color'), { Red: 60 });
  });
});
