import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultLocale, locales } from '@/lib/i18n/config';
import { STORAGE_PREFIX } from '@/lib/storage-keys';
import { brand } from '@/site.brand';
import config from '@/site.config';

/** The site's own wiring: config, router, brand and storage keys agree. */

test('the CMS serves the same locales as the router', () => {
  assert.deepEqual([...config.locales], [...locales]);
  assert.equal(config.defaultLocale, defaultLocale);
});

test('the site is named and addressed from the brand file', () => {
  assert.equal(config.name, brand.name);
  assert.equal(config.productionOrigin, brand.url);
  assert.equal(config.storagePrefix, STORAGE_PREFIX);
});

test('module defaults match the site type (ecommerce)', () => {
  assert.equal(config.modules.commerce, true);
  assert.equal(config.modules.booking, false);
  assert.equal(config.modules.newsletter, true);
  // The Product Manager bridge grants write access to every page: opt-in only.
  assert.equal(config.modules.pm, false);
});

test('every collection the front end renders is registered', () => {
  const keys = new Set(config.collections.map((c) => c.key));
  for (const key of ['page', 'product', 'category', 'booking', ...["author","article_category","article","answer_category","answer","scenario_category","scenario"]]) {
    assert.ok(keys.has(key), `missing collection "${key}"`);
  }
});

test('each post collection is categorised, and redirects to its categories when unpublished', () => {
  for (const key of ["author","article_category","article","answer_category","answer","scenario_category","scenario"].filter((k) => config.collectionByKey.has(`${k}_category`))) {
    const collection = config.collectionByKey.get(key);
    const field = collection?.fields.find((x) => x.key === 'categories');
    assert.equal(field?.kind, 'relation', `${key}.categories`);
    assert.equal(field?.kind === 'relation' && field.to, `${key}_category`);
    assert.equal(field?.kind === 'relation' && field.many, true);
    assert.equal(collection?.unpublishRedirect?.taxonomyField, 'categories');
    const segment = collection?.routing.pathTemplate?.replace('/{slug}', '');
    assert.equal(collection?.unpublishRedirect?.fallbackPath, `${segment}/categories`);
    assert.deepEqual(collection?.routing.reservedSlugs, ['categories']);
  }
});
