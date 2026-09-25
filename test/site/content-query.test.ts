import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CONTENT_PAGE_SIZE,
  applyContentQuery,
  hasActiveContentFilters,
  parseContentParams,
} from '@/lib/site/content-query';
import type { ContentEntry } from '@/lib/site/content';

/**
 * Searching and paging a content listing — /blog, /faq, /case-studies.
 *
 * The listings used to render every published document in one ungrouped wall,
 * which the read layer quietly cut off at 200: post 201 existed, was in the
 * sitemap, and could not be reached from the site.
 *
 * Filter state lives in the URL, so a filtered view can be linked and survives a
 * refresh, and every value is validated here once — no page has to defend
 * itself against a hand-edited query string.
 */

const entry = (over: Partial<ContentEntry> & { slug: string }): ContentEntry => ({
  title: over.slug,
  summary: '',
  body: null,
  publishedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

/** `n` entries named a1, a2, … in the order the read layer returns them. */
const many = (n: number): ContentEntry[] =>
  Array.from({ length: n }, (_, i) => entry({ slug: `a${i + 1}`, title: `Post ${i + 1}` }));

describe('parseContentParams', () => {
  test('an empty query is the first page with nothing filtered', () => {
    const parsed = parseContentParams({});
    assert.deepEqual(parsed, { q: '', category: '', page: 1 });
    assert.equal(hasActiveContentFilters(parsed), false);
  });

  test('reads a search term, a category and a page', () => {
    const parsed = parseContentParams({ q: ' seo ', category: 'How-To', page: '3' });
    assert.equal(parsed.q, 'seo');
    assert.equal(parsed.category, 'how-to');
    assert.equal(parsed.page, 3);
    assert.equal(hasActiveContentFilters(parsed), true);
  });

  test('a page that is not a sane number falls back to the first', () => {
    for (const page of ['0', '-5', 'abc', '1.5.2', '', 'NaN', 'Infinity']) {
      assert.equal(parseContentParams({ page }).page, 1, page);
    }
  });

  test('a category that is not a slug is ignored, not passed on', () => {
    // It is handed to a document lookup, so anything but a slug is dropped here
    // rather than somewhere further in.
    for (const category of ['../../etc/passwd', 'a b', 'Ημερολόγιο', "' OR 1=1", 'x'.repeat(200)]) {
      assert.equal(parseContentParams({ category }).category, '', category);
    }
  });

  test('a very long search term is cut to a sane length', () => {
    assert.equal(parseContentParams({ q: 'x'.repeat(5000) }).q.length, 100);
  });

  test('a repeated parameter takes its first value', () => {
    assert.equal(parseContentParams({ q: ['first', 'second'] }).q, 'first');
  });

  test('paging alone is not an active filter — it needs no "clear" button', () => {
    assert.equal(hasActiveContentFilters(parseContentParams({ page: '4' })), false);
  });
});

describe('applyContentQuery — paging', () => {
  test('an unfiltered first page holds one page of the newest entries', () => {
    const result = applyContentQuery(many(30), parseContentParams({}));
    assert.equal(result.items.length, CONTENT_PAGE_SIZE);
    assert.equal(result.items[0].slug, 'a1', 'the read layer already ordered them');
    assert.equal(result.total, 30);
    assert.equal(result.page, 1);
    assert.equal(result.pageCount, Math.ceil(30 / CONTENT_PAGE_SIZE));
  });

  test('the second page continues where the first stopped', () => {
    const result = applyContentQuery(many(30), parseContentParams({ page: '2' }));
    assert.equal(result.items[0].slug, `a${CONTENT_PAGE_SIZE + 1}`);
    assert.equal(result.items.length, CONTENT_PAGE_SIZE);
  });

  test('the last page holds the remainder', () => {
    const result = applyContentQuery(many(25), parseContentParams({ page: '3' }));
    assert.equal(result.items.length, 25 - 2 * CONTENT_PAGE_SIZE);
    assert.equal(result.pageCount, 3);
  });

  test('a page past the end shows the last page, not a blank screen', () => {
    // A hand-typed ?page=900 that rendered nothing would be an empty page
    // returning 200 — a soft 404 for anything that crawls it.
    const result = applyContentQuery(many(25), parseContentParams({ page: '900' }));
    assert.equal(result.page, 3, 'clamped to the last page');
    assert.equal(result.items.length, 25 - 2 * CONTENT_PAGE_SIZE);
    assert.equal(result.total, 25);
    assert.equal(result.pageCount, 3);
  });

  test('an empty collection has one page, not zero', () => {
    const result = applyContentQuery([], parseContentParams({}));
    assert.deepEqual([result.total, result.pageCount, result.items.length], [0, 1, 0]);
  });

  test('a collection far past the old 200 cut-off is fully reachable by paging', () => {
    const all = many(250);
    const seen = new Set<string>();
    const pageCount = applyContentQuery(all, parseContentParams({})).pageCount;
    for (let p = 1; p <= pageCount; p += 1) {
      for (const item of applyContentQuery(all, parseContentParams({ page: String(p) })).items) {
        seen.add(item.slug);
      }
    }
    assert.equal(seen.size, 250, 'every entry appears on exactly one page');
  });
});

describe('applyContentQuery — search', () => {
  const library = [
    entry({ slug: 'seo-basics', title: 'SEO basics', summary: 'Getting found on Google.' }),
    entry({ slug: 'summer', title: 'Καλοκαίρι στην Πάρο', summary: 'Οδηγός για το νησί.' }),
    entry({ slug: 'case', title: 'A rebrand', summary: 'For a client.', eyebrow: 'Hospitality' }),
  ];

  test('matches the title, whatever the case', () => {
    const result = applyContentQuery(library, parseContentParams({ q: 'seo BASICS' }));
    assert.deepEqual(
      result.items.map((e) => e.slug),
      ['seo-basics'],
    );
    assert.equal(result.total, 1);
  });

  test('matches the summary too', () => {
    const result = applyContentQuery(library, parseContentParams({ q: 'google' }));
    assert.deepEqual(
      result.items.map((e) => e.slug),
      ['seo-basics'],
    );
  });

  test('matches the eyebrow — a case study is findable by its industry', () => {
    const result = applyContentQuery(library, parseContentParams({ q: 'hospitality' }));
    assert.deepEqual(
      result.items.map((e) => e.slug),
      ['case'],
    );
  });

  test('Greek accents and case do not have to be typed', () => {
    // An editor titles a post Καλοκαίρι; a visitor types καλοκαιρι, with no
    // accent, because that is what a phone keyboard gives them.
    for (const q of ['καλοκαιρι', 'ΚΑΛΟΚΑΙΡΙ', 'Καλοκαίρι', 'παρο']) {
      const result = applyContentQuery(library, parseContentParams({ q }));
      assert.deepEqual(
        result.items.map((e) => e.slug),
        ['summer'],
        q,
      );
    }
  });

  test('a term that matches nothing is an empty result, not the whole library', () => {
    const result = applyContentQuery(library, parseContentParams({ q: 'nothing here' }));
    assert.equal(result.items.length, 0);
    assert.equal(result.total, 0);
  });

  test('search counts the matches, so the pager follows the search', () => {
    const posts = [...many(40), entry({ slug: 'odd', title: 'Findable' })];
    const result = applyContentQuery(posts, parseContentParams({ q: 'findable' }));
    assert.equal(result.total, 1);
    assert.equal(result.pageCount, 1);
  });

  test('an entry with no summary or eyebrow does not break the search', () => {
    const result = applyContentQuery([entry({ slug: 'bare', title: 'Bare' })], parseContentParams({ q: 'bare' }));
    assert.equal(result.items.length, 1);
  });
});
