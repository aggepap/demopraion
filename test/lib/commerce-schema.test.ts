import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defaultLocale, type Locale } from '@/lib/i18n/config';
import { SITE_URL } from '@/lib/seo/schemas';
import {
  availabilityToOg,
  availabilityToSchema,
  conditionToSchema,
  itemListSchema,
  localeUrl,
  priceString,
  productSchema,
} from '@/lib/seo/commerce-schema';

/**
 * The other of Greek and English — always prefixed, whichever of the two is this
 * site's main language (Greek on Praion; either on a site built from it).
 */
const OTHER: Locale = defaultLocale === 'el' ? 'en' : 'el';

describe('enum mappings', () => {
  test('availability → schema.org ItemAvailability', () => {
    assert.equal(availabilityToSchema('in-stock'), 'https://schema.org/InStock');
    assert.equal(availabilityToSchema('out-of-stock'), 'https://schema.org/OutOfStock');
    assert.equal(availabilityToSchema('preorder'), 'https://schema.org/PreOrder');
    assert.equal(availabilityToSchema('made-to-order'), 'https://schema.org/PreOrder');
    assert.equal(availabilityToSchema('anything-else'), 'https://schema.org/InStock');
  });

  test('availability → Open Graph vocabulary', () => {
    assert.equal(availabilityToOg('in-stock'), 'in stock');
    assert.equal(availabilityToOg('out-of-stock'), 'out of stock');
    assert.equal(availabilityToOg('made-to-order'), 'available for order');
  });

  test('condition → schema.org OfferItemCondition (defaults to new)', () => {
    assert.equal(conditionToSchema('used'), 'https://schema.org/UsedCondition');
    assert.equal(conditionToSchema('refurbished'), 'https://schema.org/RefurbishedCondition');
    assert.equal(conditionToSchema(undefined), 'https://schema.org/NewCondition');
  });

  test('priceString is always 2 decimals', () => {
    assert.equal(priceString(49.9), '49.90');
    assert.equal(priceString(10), '10.00');
  });
});

describe('localeUrl', () => {
  test('the main language is unprefixed; the other is prefixed; trailing slash stripped', () => {
    assert.equal(localeUrl('/shop/x', defaultLocale), `${SITE_URL}/shop/x`);
    assert.equal(localeUrl('/shop/x', OTHER), `${SITE_URL}/${OTHER}/shop/x`);
    assert.equal(localeUrl('/shop/x/', OTHER), `${SITE_URL}/${OTHER}/shop/x`);
  });
});

describe('productSchema', () => {
  const base = {
    name: 'Oak Chair',
    path: '/shop/oak-chair',
    locale: defaultLocale,
    currency: 'EUR',
    availability: 'in-stock',
    price: 120,
  };

  test('single Offer with merchant identifiers and stable @id', () => {
    const s = productSchema({
      ...base,
      sku: 'OAK-1',
      gtin: '5201234567890',
      mpn: 'MPN-9',
      brand: 'Praion',
      condition: 'new',
      images: [`${SITE_URL}/api/cms/media/file/abc`],
      category: 'Chairs',
      description: 'A chair',
    });
    assert.equal(s['@type'], 'Product');
    assert.equal(s['@id'], `${SITE_URL}/shop/oak-chair#product`);
    assert.equal(s.sku, 'OAK-1');
    assert.equal(s.gtin, '5201234567890');
    assert.equal(s.mpn, 'MPN-9');
    assert.deepEqual(s.brand, { '@type': 'Brand', name: 'Praion' });
    assert.equal(s.category, 'Chairs');
    const offer = s.offers as Record<string, unknown>;
    assert.equal(offer['@type'], 'Offer');
    assert.equal(offer.price, '120.00');
    assert.equal(offer.priceCurrency, 'EUR');
    assert.equal(offer.availability, 'https://schema.org/InStock');
    assert.equal(offer.itemCondition, 'https://schema.org/NewCondition');
    assert.equal(offer.url, `${SITE_URL}/shop/oak-chair`);
  });

  test('two or more distinct variant prices become an AggregateOffer', () => {
    const s = productSchema({ ...base, variantPrices: [120, 150, 150] });
    const offer = s.offers as Record<string, unknown>;
    assert.equal(offer['@type'], 'AggregateOffer');
    assert.equal(offer.offerCount, 2);
    assert.equal(offer.lowPrice, '120.00');
    assert.equal(offer.highPrice, '150.00');
  });

  test('a single distinct variant price stays a plain Offer at that price', () => {
    const s = productSchema({ ...base, variantPrices: [99, 99] });
    const offer = s.offers as Record<string, unknown>;
    assert.equal(offer['@type'], 'Offer');
    assert.equal(offer.price, '99.00');
  });

  test('optional fields are omitted rather than emitted empty', () => {
    const s = productSchema(base);
    assert.equal('sku' in s, false);
    assert.equal('brand' in s, false);
    assert.equal('image' in s, false);
    assert.equal('aggregateRating' in s, false);
  });

  test('aggregateRating is emitted only when there is at least one review', () => {
    const s = productSchema({ ...base, aggregateRating: { ratingValue: 4.5, reviewCount: 12 } });
    assert.deepEqual(s.aggregateRating, {
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      reviewCount: 12,
      bestRating: 5,
      worstRating: 1,
    });
    // A zero-count aggregate must not emit (no inventing ratings).
    const empty = productSchema({ ...base, aggregateRating: { ratingValue: 0, reviewCount: 0 } });
    assert.equal('aggregateRating' in empty, false);
  });

  test('review nodes are emitted with author + rating', () => {
    const s = productSchema({
      ...base,
      reviews: [
        { author: 'Maria', ratingValue: 5, title: 'Great', body: 'Loved it', datePublished: '2026-07-01T00:00:00.000Z' },
      ],
    });
    const reviews = s.review as Record<string, unknown>[];
    assert.equal(reviews.length, 1);
    assert.deepEqual(reviews[0]['@type'], 'Review');
    assert.deepEqual(reviews[0].author, { '@type': 'Person', name: 'Maria' });
    assert.deepEqual(reviews[0].reviewRating, {
      '@type': 'Rating',
      ratingValue: 5,
      bestRating: 5,
      worstRating: 1,
    });
    assert.equal(reviews[0].name, 'Great');
    assert.equal(reviews[0].reviewBody, 'Loved it');
    assert.equal(reviews[0].datePublished, '2026-07-01T00:00:00.000Z');
  });

  test('no review key when there are no reviews', () => {
    assert.equal('review' in productSchema(base), false);
  });
});

describe('itemListSchema', () => {
  test('numbered ListItems with absolute, locale-prefixed urls', () => {
    const s = itemListSchema(
      [
        { name: 'A', path: '/shop/a' },
        { name: 'B', path: '/shop/b' },
      ],
      OTHER,
    );
    assert.equal(s['@type'], 'ItemList');
    assert.equal(s.numberOfItems, 2);
    assert.deepEqual((s.itemListElement as unknown[])[0], {
      '@type': 'ListItem',
      position: 1,
      name: 'A',
      url: `${SITE_URL}/${OTHER}/shop/a`,
    });
  });
});
