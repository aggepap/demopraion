import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyProductQuery, priceBounds, type ProductSummary } from '@/cms/modules/commerce/read';

/**
 * The slider's ends, and what the price filter actually compares against.
 *
 * A product with variations has a price RANGE ("from €20"), and the filter only
 * ever compared the base price. So a chair listed at €100 whose small version
 * costs €20 was missing from "up to €50" — the shop appeared not to sell
 * anything a shopper could afford. With a slider the same bug is worse: the
 * ends come from the same numbers, so the handle could sit on a value that
 * returns nothing.
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

describe('priceBounds', () => {
  test('spans the cheapest and dearest product', () => {
    assert.deepEqual(priceBounds([prod({ price: 12.4 }), prod({ price: 80 })]), {
      min: 12,
      max: 80,
    });
  });

  test('rounds outwards, so nothing sits outside the slider', () => {
    assert.deepEqual(priceBounds([prod({ price: 12.4 }), prod({ price: 79.2 })]), {
      min: 12,
      max: 80,
    });
  });

  test('uses a variation range, not the base price', () => {
    const chair = prod({ price: 100, priceRange: { min: 20, max: 100 } });
    assert.deepEqual(priceBounds([chair]), { min: 20, max: 100 });
  });

  test('an empty list has no bounds', () => {
    assert.equal(priceBounds([]), null);
  });

  test('one product still gives a usable range', () => {
    assert.deepEqual(priceBounds([prod({ price: 30 })]), { min: 30, max: 30 });
  });

  test('ignores prices that are not numbers', () => {
    const broken = prod({ price: Number.NaN });
    assert.deepEqual(priceBounds([broken, prod({ price: 15 })]), { min: 15, max: 15 });
  });
});

describe('price filtering', () => {
  const chair = prod({ slug: 'chair', price: 100, priceRange: { min: 20, max: 100 } });
  const lamp = prod({ slug: 'lamp', price: 50 });

  const slugs = (opts: Parameters<typeof applyProductQuery>[1]) =>
    applyProductQuery([chair, lamp], opts).items.map((p) => p.slug);

  test('a product qualifies when any of its variations is in range', () => {
    assert.deepEqual(slugs({ maxPrice: 30 }), ['chair']);
  });

  test('and when the range only overlaps at the top', () => {
    assert.deepEqual(slugs({ minPrice: 90 }), ['chair']);
  });

  test('a range entirely outside the filter is excluded', () => {
    assert.deepEqual(slugs({ minPrice: 200 }), []);
    assert.deepEqual(slugs({ maxPrice: 10 }), []);
  });

  test('a plain product still compares on its single price', () => {
    // The chair's variations reach into 40–60 as well, so both qualify; what
    // this pins is the plain product, in and then out by its one price.
    assert.deepEqual(slugs({ minPrice: 40, maxPrice: 60 }), ['chair', 'lamp']);
    assert.deepEqual(slugs({ minPrice: 51, maxPrice: 60 }), ['chair']);
  });

  test('no price filter returns everything', () => {
    assert.deepEqual(slugs({}), ['chair', 'lamp']);
  });
});
