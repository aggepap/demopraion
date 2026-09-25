import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EXTRA_MANAGED_KEYS } from '@/cms/core/settings/schema';
import { checkStructuredSetting } from '@/cms/core/settings/structured';
import {
  SCHEMA_CATEGORIES,
  SCHEMA_POLICY_KEY,
  availableSchemaCategories,
  categoriesForCollection,
  categoryForCollection,
  parseSchemaPolicy,
  partsFor,
  resolveSchemaChoice,
} from '@/cms/core/structured-data/policy';

/**
 * Settings → Structured data. Each kind of content says what it is to search
 * engines, chosen from the types that make sense for it — an article can be a
 * BlogPosting or a NewsArticle, never a Product.
 */

const check = (value: unknown) => checkStructuredSetting(SCHEMA_POLICY_KEY, value)!;

describe('structured data — write boundary', () => {
  test('the policy may be written through the settings API', () => {
    assert.ok(EXTRA_MANAGED_KEYS.includes(SCHEMA_POLICY_KEY));
  });

  test('a well-formed policy is accepted', () => {
    const res = check({
      business: { type: 'TravelAgency', priceRange: '€€' },
      categories: {
        articles: { type: 'NewsArticle', breadcrumbs: false, appendFaq: true, parts: { author: false } },
        bookingStay: { type: 'Apartment' },
      },
    });
    assert.equal(res.ok, true);
  });

  test('a type from another category is refused, naming the field', () => {
    const res = check({ categories: { articles: { type: 'Product' } } });
    assert.equal(res.ok, false);
    assert.ok(!res.ok && res.message.startsWith('Structured data'));
  });

  test('an unknown category, part or business type is refused', () => {
    assert.equal(check({ categories: { recipes: { type: 'Recipe' } } }).ok, false);
    assert.equal(check({ categories: { pages: { parts: { author: true } } } }).ok, false);
    assert.equal(check({ business: { type: 'Spaceport' } }).ok, false);
    // Speakable is offered where content is read aloud, not on plain pages.
    assert.equal(check({ categories: { pages: { parts: { speakable: false } } } }).ok, false);
    assert.equal(check({ categories: { caseStudies: { parts: { speakable: false } } } }).ok, true);
  });
});

describe('structured data — reading a stored policy', () => {
  test('nothing stored gives each category its first type, everything on', () => {
    const policy = parseSchemaPolicy(null);
    for (const c of SCHEMA_CATEGORIES) {
      const p = policy.categories[c.key];
      assert.equal(p.type, c.types[0], c.key);
      assert.equal(p.breadcrumbs, true);
      assert.equal(p.appendFaq, true);
      for (const part of c.parts) assert.equal(p.parts[part], true, `${c.key}.${part}`);
    }
    assert.equal(policy.categories.articles.type, 'BlogPosting');
    assert.equal(policy.categories.answers.type, 'FAQPage');
    assert.equal(policy.business.type, 'Organization');
  });

  test('one bad value falls back on its own, the rest are kept', () => {
    const policy = parseSchemaPolicy({
      categories: {
        articles: { type: 'Product', breadcrumbs: false },
        pages: { type: 'AboutPage' },
        answers: 'garbage',
      },
    });
    assert.equal(policy.categories.articles.type, 'BlogPosting');
    assert.equal(policy.categories.articles.breadcrumbs, false);
    assert.equal(policy.categories.pages.type, 'AboutPage');
    assert.equal(policy.categories.answers.type, 'FAQPage');
  });

  test('the business type defaults from what the site sells', () => {
    assert.equal(parseSchemaPolicy(null, { moduleFlags: { commerce: true } }).business.type, 'OnlineStore');
    assert.equal(
      parseSchemaPolicy(null, { moduleFlags: { booking: true }, bookingKinds: ['stay'] }).business.type,
      'LodgingBusiness',
    );
    assert.equal(
      parseSchemaPolicy(null, { moduleFlags: { booking: true }, bookingKinds: ['transport', 'stay'] }).business
        .type,
      'TravelAgency',
    );
    // A stored choice beats the hint.
    assert.equal(
      parseSchemaPolicy({ business: { type: 'Store' } }, { moduleFlags: { commerce: true } }).business.type,
      'Store',
    );
  });
});

describe('structured data — choosing for one document', () => {
  const policy = parseSchemaPolicy({
    categories: { articles: { type: 'Article', parts: { author: false } } },
  });

  test('inherit uses the category setting', () => {
    const choice = resolveSchemaChoice(policy, 'articles', null);
    assert.equal(choice.type, 'Article');
    assert.equal(choice.family, 'article');
    assert.equal(choice.parts.author, false);
    assert.equal(choice.parts.dates, true);
  });

  test('an allowed override wins', () => {
    assert.equal(resolveSchemaChoice(policy, 'articles', 'NewsArticle').type, 'NewsArticle');
  });

  test('an override from another category is ignored', () => {
    assert.equal(resolveSchemaChoice(policy, 'articles', 'Product').type, 'Article');
    // The booking select lists both kinds; a day-trip type on a stay is ignored.
    assert.equal(resolveSchemaChoice(policy, 'bookingStay', 'TouristTrip').type, 'Accommodation');
  });

  test('parts that do not fit the type are off', () => {
    const page = resolveSchemaChoice(policy, 'articles', 'None');
    assert.equal(page.parts.author, false);
    assert.equal(page.parts.dates, false);
    assert.equal(page.parts.speakable, false);
    assert.equal(page.breadcrumbs, false);
    assert.equal(page.appendFaq, false);
    // Accommodation types cannot carry offers.
    assert.equal(resolveSchemaChoice(policy, 'bookingStay', 'Apartment').parts.offers, false);
    assert.equal(resolveSchemaChoice(policy, 'bookingStay', 'Product').parts.offers, true);
  });

  test('the admin sees only the parts a type can carry', () => {
    assert.deepEqual(partsFor('articles', 'BlogPosting'), ['author', 'dates', 'image', 'speakable']);
    assert.deepEqual(partsFor('articles', 'None'), []);
    assert.deepEqual(partsFor('answers', 'FAQPage'), []);
    assert.deepEqual(partsFor('answers', 'Article'), ['dates', 'speakable']);
    assert.deepEqual(partsFor('caseStudies', 'CreativeWork'), ['author', 'dates', 'image', 'speakable']);
    assert.deepEqual(partsFor('caseStudies', 'WebPage'), []);
    assert.deepEqual(partsFor('bookingStay', 'Apartment'), ['image']);
  });
});

describe('structured data — which category a document is in', () => {
  test('collections map to their category; bookings by kind', () => {
    assert.equal(categoryForCollection('page'), 'pages');
    assert.equal(categoryForCollection('article'), 'articles');
    assert.equal(categoryForCollection('scenario'), 'caseStudies');
    assert.equal(categoryForCollection('booking', { kind: 'stay' }), 'bookingStay');
    assert.equal(categoryForCollection('booking', { kind: 'transport' }), 'bookingTransport');
    assert.equal(categoryForCollection('booking', {}), 'bookingTransport');
    assert.equal(categoryForCollection('testimonial'), null);
    assert.deepEqual(
      categoriesForCollection('booking').map((c) => c.key),
      ['bookingTransport', 'bookingStay'],
    );
  });

  test('only categories the site has are offered', () => {
    const keys = (input: Parameters<typeof availableSchemaCategories>[0]) =>
      availableSchemaCategories(input).map((c) => c.key);

    assert.deepEqual(keys({ collectionKeys: ['page', 'product', 'booking'], moduleFlags: {} }), ['pages']);
    assert.deepEqual(
      keys({
        collectionKeys: ['page', 'article', 'product', 'booking'],
        moduleFlags: { commerce: true, booking: true },
        bookingKinds: ['stay'],
      }),
      ['pages', 'articles', 'products', 'bookingStay'],
    );
  });
});
