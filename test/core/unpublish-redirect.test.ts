import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveCollection } from '@/cms/config';
import { planUnpublishRedirect, termRedirectPath, type UnpublishRedirectInput } from '@/cms/core/seo/unpublish-redirect';

/**
 * When a published post is taken down, its URL should not fall through to the
 * page-not-found screen: it redirects to the category page it belonged to, or to
 * the collection's category overview when it has no live category. A draft is
 * temporary (302); an archived post is gone for good (301). Putting it live
 * again removes the rule, or the rule would shadow the live page forever.
 */

const spec = { taxonomyField: 'categories', fallbackPath: '/blog/categories' };

function input(over: Partial<UnpublishRedirectInput> = {}): UnpublishRedirectInput {
  return {
    spec,
    doc: { status: 'draft', publishedAt: new Date('2026-01-01'), locale: 'el', ...over.doc },
    sourcePath: '/blog/hello',
    categoryPaths: ['/blog/categories/tips'],
    defaultLocale: 'el',
    otherRules: [],
    ...over,
  };
}

describe('planUnpublishRedirect', () => {
  test('a published post moved to draft redirects temporarily to its first live category', () => {
    assert.deepEqual(planUnpublishRedirect(input()), {
      kind: 'upsert',
      source: '/blog/hello',
      target: '/blog/categories/tips',
      statusCode: 302,
    });
  });

  test('an archived post redirects permanently', () => {
    const plan = planUnpublishRedirect(input({ doc: { status: 'archived', publishedAt: new Date(), locale: 'el' } }));
    assert.equal(plan.kind, 'upsert');
    assert.equal(plan.kind === 'upsert' && plan.statusCode, 301);
  });

  test('the first category in order wins when there are several', () => {
    const plan = planUnpublishRedirect(input({ categoryPaths: ['/blog/categories/a', '/blog/categories/b'] }));
    assert.equal(plan.kind === 'upsert' && plan.target, '/blog/categories/a');
  });

  test('a post with no live category falls back to the category overview', () => {
    const plan = planUnpublishRedirect(input({ categoryPaths: [] }));
    assert.equal(plan.kind === 'upsert' && plan.target, '/blog/categories');
  });

  test('the fallback is prefixed with the post locale when it is not the default', () => {
    const plan = planUnpublishRedirect(
      input({
        doc: { status: 'draft', publishedAt: new Date(), locale: 'en' },
        sourcePath: '/en/blog/hello',
        categoryPaths: [],
      }),
    );
    assert.deepEqual(plan, { kind: 'upsert', source: '/en/blog/hello', target: '/en/blog/categories', statusCode: 302 });
  });

  test('putting the post live again removes the rule', () => {
    assert.deepEqual(planUnpublishRedirect(input({ doc: { status: 'published', publishedAt: new Date(), locale: 'el' } })), {
      kind: 'remove',
    });
    assert.deepEqual(planUnpublishRedirect(input({ doc: { status: 'scheduled', publishedAt: new Date(), locale: 'el' } })), {
      kind: 'remove',
    });
  });

  test('a post that was never published has no public URL to redirect', () => {
    assert.deepEqual(planUnpublishRedirect(input({ doc: { status: 'draft', publishedAt: null, locale: 'el' } })), {
      kind: 'none',
    });
  });

  test('a collection without an unpublish redirect is left alone', () => {
    assert.deepEqual(planUnpublishRedirect(input({ spec: undefined })), { kind: 'none' });
    assert.deepEqual(
      planUnpublishRedirect(input({ spec: undefined, doc: { status: 'published', publishedAt: new Date(), locale: 'el' } })),
      { kind: 'none' },
    );
  });

  test('a document with no public path produces nothing', () => {
    assert.deepEqual(planUnpublishRedirect(input({ sourcePath: null })), { kind: 'none' });
  });

  test('unsafe sources and targets are refused, never written', () => {
    assert.deepEqual(planUnpublishRedirect(input({ sourcePath: '//evil.example/x' })), { kind: 'none' });
    assert.deepEqual(planUnpublishRedirect(input({ sourcePath: 'blog/hello' })), { kind: 'none' });
    // An unsafe category path is skipped in favour of the next candidate.
    const plan = planUnpublishRedirect(input({ categoryPaths: ['//evil.example', 'https://evil.example'] }));
    assert.equal(plan.kind === 'upsert' && plan.target, '/blog/categories');
    // And an unsafe fallback with no category leaves nothing to redirect to.
    assert.deepEqual(
      planUnpublishRedirect(input({ categoryPaths: [], spec: { taxonomyField: 'categories', fallbackPath: '//evil' } })),
      { kind: 'none' },
    );
  });

  test('a target equal to the source is skipped rather than written as a loop', () => {
    const plan = planUnpublishRedirect(input({ sourcePath: '/blog/categories/tips/', categoryPaths: ['/blog/categories/tips'] }));
    assert.equal(plan.kind === 'upsert' && plan.target, '/blog/categories');
  });

  test('a target that another rule sends back to the source is skipped', () => {
    const plan = planUnpublishRedirect(
      input({ otherRules: [{ source: '/blog/categories/tips', kind: 'literal', target: '/blog/hello' }] }),
    );
    assert.equal(plan.kind === 'upsert' && plan.target, '/blog/categories');
  });

  test('a rule someone else already wrote for the source wins', () => {
    assert.deepEqual(
      planUnpublishRedirect(input({ otherRules: [{ source: '/blog/hello', kind: 'literal', target: '/elsewhere' }] })),
      { kind: 'none' },
    );
    assert.deepEqual(
      planUnpublishRedirect(input({ otherRules: [{ source: '/blog/*', kind: 'wildcard', target: '/news' }] })),
      { kind: 'none' },
    );
  });

  test('a disabled rule on the same URL still wins, rather than colliding with it on save', () => {
    // `seo_redirects` is unique on (source, kind): writing next to it would fail the post's save.
    assert.deepEqual(
      planUnpublishRedirect(input({ otherRules: [{ source: '/blog/hello', kind: 'literal', target: '/x', active: false }] })),
      { kind: 'none' },
    );
  });

  test('a disabled rule neither shadows the URL nor counts towards a loop', () => {
    const plan = planUnpublishRedirect(
      input({
        otherRules: [
          { source: '/blog/*', kind: 'wildcard', target: '/news', active: false },
          { source: '/blog/categories/tips', kind: 'literal', target: '/blog/hello', active: false },
        ],
      }),
    );
    assert.equal(plan.kind === 'upsert' && plan.target, '/blog/categories/tips');
  });

  test('the source follows the current path, so a renamed draft moves its rule', () => {
    const plan = planUnpublishRedirect(input({ sourcePath: '/blog/renamed' }));
    assert.equal(plan.kind === 'upsert' && plan.source, '/blog/renamed');
  });

  test('a filtered listing with a query string is a valid target', () => {
    const plan = planUnpublishRedirect(
      input({ spec: { taxonomyField: 'categories', fallbackPath: '/booking' }, sourcePath: '/booking/boat-trip', categoryPaths: ['/booking?category=cruises'] }),
    );
    assert.deepEqual(plan, { kind: 'upsert', source: '/booking/boat-trip', target: '/booking?category=cruises', statusCode: 302 });
  });

  test('a document whose module is switched off gets no rule, and loses the one it had', () => {
    // Its pages 404 on purpose; a redirect would only send visitors to another 404.
    assert.deepEqual(planUnpublishRedirect(input({ moduleEnabled: false })), { kind: 'remove' });
    assert.deepEqual(
      planUnpublishRedirect(input({ moduleEnabled: false, doc: { status: 'published', publishedAt: new Date(), locale: 'el' } })),
      { kind: 'remove' },
    );
  });
});

describe('termRedirectPath', () => {
  const category = resolveCollection({ key: 'category', fields: [], routing: { pathTemplate: '/shop/category/{slug}' } });
  const unrouted = resolveCollection({ key: 'booking_category', fields: [] });

  test("uses the term collection's own page by default, prefixed for the post's locale", () => {
    const spec = { taxonomyField: 'categories', fallbackPath: '/shop' };
    assert.equal(termRedirectPath(spec, category, 'shoes', 'el', 'el'), '/shop/category/shoes');
    assert.equal(termRedirectPath(spec, category, 'shoes', 'en', 'el'), '/en/shop/category/shoes');
  });

  test('a termPathTemplate overrides it — a filtered listing instead of a term page', () => {
    const spec = { taxonomyField: 'categories', fallbackPath: '/booking', termPathTemplate: '/booking?category={slug}' };
    assert.equal(termRedirectPath(spec, category, 'cruises', 'el', 'el'), '/booking?category=cruises');
    assert.equal(termRedirectPath(spec, unrouted, 'cruises', 'en', 'el'), '/en/booking?category=cruises');
  });

  test('the slug is URL-encoded into a query string', () => {
    const spec = { taxonomyField: 'categories', fallbackPath: '/booking', termPathTemplate: '/booking?category={slug}' };
    assert.equal(termRedirectPath(spec, unrouted, 'a&b c', 'el', 'el'), '/booking?category=a%26b%20c');
  });

  test('a term collection with no page and no template has no path', () => {
    assert.equal(termRedirectPath({ taxonomyField: 'categories', fallbackPath: '/booking' }, unrouted, 'x', 'el', 'el'), null);
  });
});
