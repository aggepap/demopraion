import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getRouteLastModified, SITEMAP_FAMILIES } from '@/app/sitemap';

/**
 * B2 (technical audit, 2026-09-12): routes with no document behind them —
 * services hubs, pricing, legal, contact, the tier pages — were stamped with
 * `new Date()`. The sitemap is `force-dynamic`, so every fetch reported 40 of
 * 64 URLs as changed that instant, and Google stops trusting `lastmod` for the
 * whole file, including the dates that are real.
 */
describe('getRouteLastModified', () => {
  test('a route with a document date gets that date at UTC noon', () => {
    const lastMod = new Map([['/insights/aeo', '2026-05-06']]);
    assert.deepEqual(
      getRouteLastModified('/insights/aeo', lastMod),
      new Date('2026-05-06T12:00:00Z'),
    );
  });

  test('a route with no known date gets no lastmod rather than an invented one', () => {
    assert.equal(getRouteLastModified('/pricing', new Map()), undefined);
  });
});

/**
 * Category archives are public pages: each post collection's category family is
 * listed, with the category overview as its index route.
 */
describe('SITEMAP_FAMILIES — categories', () => {
  for (const [type, prefix] of [
    ['article_category', '/blog/categories'],
    ['answer_category', '/faq/categories'],
    ['scenario_category', '/case-studies/categories'],
  ] as const) {
    test(`${type} is listed under ${prefix} with the overview as its index`, () => {
      const family = SITEMAP_FAMILIES.find((f) => f.type === type);
      assert.ok(family, `missing family ${type}`);
      assert.equal(family.prefix, prefix);
      assert.equal(family.index, prefix);
    });
  }
});
