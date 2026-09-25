import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ANALYTICS_CATEGORY_KEY, DEFAULT_COOKIE_CATEGORIES } from '@/cms/core/cookies/defaults';
import { pendingCategories } from '@/cms/db/seeds/cookies';

/**
 * A fresh install had an empty `cookie_categories` table and nothing to fill it:
 * the banner offered no categories, `/legal/cookies` rendered no declaration, and
 * the only way to get one was for an admin to know to go and type it. These pin
 * the defaults themselves and the one decision the seeder makes — the DB write is
 * the same `insert` it always was.
 */

describe('DEFAULT_COOKIE_CATEGORIES', () => {
  test('declares necessary, analytics and marketing, in that order', () => {
    assert.deepEqual(
      DEFAULT_COOKIE_CATEGORIES.map((c) => c.key),
      ['necessary', ANALYTICS_CATEGORY_KEY, 'marketing'],
    );
    assert.deepEqual(
      DEFAULT_COOKIE_CATEGORIES.map((c) => c.sortOrder),
      [0, 1, 2],
    );
  });

  test('only the necessary category is required', () => {
    // A required category is not a choice — anything a visitor may refuse must
    // not be marked required, or the banner records consent nobody gave.
    assert.deepEqual(
      DEFAULT_COOKIE_CATEGORIES.filter((c) => c.required).map((c) => c.key),
      ['necessary'],
    );
  });

  test('every default is written in both site locales', () => {
    for (const c of DEFAULT_COOKIE_CATEGORIES) {
      assert.ok(c.name.el?.trim() && c.name.en?.trim(), `${c.key} name`);
      assert.ok(c.description?.el?.trim() && c.description?.en?.trim(), `${c.key} description`);
      for (const s of c.services) {
        assert.ok(s.purpose?.el?.trim() && s.purpose?.en?.trim(), `${c.key}/${s.name} purpose`);
      }
    }
  });

  test('keys are machine-slugs within the column width', () => {
    for (const c of DEFAULT_COOKIE_CATEGORIES) {
      assert.match(c.key, /^[a-z0-9-]{1,64}$/);
      for (const s of c.services) assert.ok(s.name.length <= 128, s.name);
    }
  });
});

describe('pendingCategories', () => {
  test('an empty catalogue gets every default', () => {
    assert.deepEqual(pendingCategories([]).map((c) => c.key), ['necessary', ANALYTICS_CATEGORY_KEY, 'marketing']);
  });

  test('a second run creates nothing', () => {
    const first = pendingCategories([]);
    assert.deepEqual(pendingCategories(first.map((c) => c.key)), []);
  });

  test('an existing key is skipped, never rewritten', () => {
    // The admin owns this table once it exists. A seeder that updates in place
    // would silently revert their wording on the next deploy.
    const pending = pendingCategories(['necessary']);
    assert.deepEqual(pending.map((c) => c.key), [ANALYTICS_CATEGORY_KEY, 'marketing']);
  });

  test('a category that already exists contributes no services to the run', () => {
    // Services ride along with the category the run creates. Attaching them to a
    // category that was already there would re-add rows an admin had removed.
    const services = pendingCategories(['necessary']).flatMap((c) => c.services);
    assert.deepEqual(services, []);
    assert.equal(pendingCategories([]).flatMap((c) => c.services).length, 1);
  });

  test('keys already present are matched exactly, not loosely', () => {
    assert.deepEqual(pendingCategories(['Necessary', 'analytics-2']).map((c) => c.key), [
      'necessary',
      ANALYTICS_CATEGORY_KEY,
      'marketing',
    ]);
  });
});
