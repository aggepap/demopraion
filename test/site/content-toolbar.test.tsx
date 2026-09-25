import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';

import { ContentToolbar } from '@/components/site/ContentToolbar';
import type { ContentTerm } from '@/lib/site/content';

/**
 * The search-and-filter bar above a content listing.
 *
 * It is a plain GET form on purpose: it works with JavaScript switched off, it
 * is operable from the keyboard, and the resulting URL is the state — so a
 * filtered listing can be bookmarked, linked and shared.
 */

const messages = {
  blog: {
    search: 'Search',
    searchPlaceholder: 'Search articles…',
    searchSubmit: 'Search',
    filterByCategory: 'Category',
    allCategories: 'All categories',
    clear: 'Clear',
    results: '{count} results',
  },
};

const term = (slug: string, title: string): ContentTerm => ({
  id: slug.length,
  slug,
  title,
  description: '',
  parentId: null,
});

const categories = [term('how-to', 'How-to'), term('news', 'News')];

const render = (props: Partial<Parameters<typeof ContentToolbar>[0]> = {}) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ContentToolbar
        namespace="blog"
        basePath="/blog"
        q=""
        category=""
        categories={categories}
        total={0}
        {...props}
      />
    </NextIntlClientProvider>,
  );

describe('ContentToolbar', () => {
  test('is a GET form, so the filters end up in the URL', () => {
    const html = render();
    assert.match(html, /<form[^>]+method="get"/);
  });

  test('the search box is labelled, not just a placeholder', () => {
    const html = render();
    // A placeholder disappears as soon as someone types; a label does not, and
    // is what a screen reader announces.
    assert.match(html, /<label[^>]+for="content-search"/);
    assert.match(html, /<input[^>]+id="content-search"/);
    assert.match(html, /name="q"/);
  });

  test('offers every category plus an "all" option', () => {
    const html = render();
    assert.match(html, /name="category"/);
    assert.match(html, /All categories/);
    for (const c of categories) assert.ok(html.includes(c.title), c.title);
  });

  test('shows the current search term and category as the form values', () => {
    const html = render({ q: 'seo', category: 'news' });
    assert.match(html, /value="seo"/);
    // The selected option is the one the URL asked for.
    assert.match(html, /<option[^>]+value="news"[^>]+selected/);
  });

  test('paging is not carried into a new search', () => {
    // A hidden page field would pin someone to page 4 of results that no longer
    // have four pages.
    assert.doesNotMatch(render({ q: 'seo' }), /name="page"/);
  });

  test('offers a way back to the unfiltered list only when something is filtered', () => {
    assert.doesNotMatch(render(), /Clear/);
    assert.match(render({ q: 'seo' }), /Clear/);
    assert.match(render({ category: 'news' }), /Clear/);
  });

  test('a collection with no categories yet shows no category control', () => {
    const html = render({ categories: [] });
    assert.doesNotMatch(html, /name="category"/);
    // The search box still works on its own.
    assert.match(html, /name="q"/);
  });

  test('states how many results the current view has', () => {
    assert.match(render({ q: 'seo', total: 3 }), /3 results/);
  });
});
