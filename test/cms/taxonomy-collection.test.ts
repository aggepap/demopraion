import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defineConfig, f, isReservedSlug, resolveCollection, taxonomyCollection } from '@/cms/config';
import type { Field, RelationField } from '@/cms/config';

/** Categories for post collections: ordinary collections built by one helper. */

const byKey = (fields: Field[], key: string) => fields.find((x) => x.key === key);

describe('taxonomyCollection', () => {
  test('a nested taxonomy has a localized title and description and a parent self-relation', () => {
    const c = taxonomyCollection({
      key: 'article_category',
      label: 'Category',
      labelPlural: 'Categories',
      pathTemplate: '/blog/categories/{slug}',
      hierarchical: true,
    });
    assert.equal(c.key, 'article_category');
    assert.equal(c.routing?.pathTemplate, '/blog/categories/{slug}');
    assert.equal(c.titlePath, 'title');
    assert.equal(c.module, undefined);
    assert.equal(resolveCollection(c).seo, true);
    assert.equal(byKey(c.fields, 'title')?.localized, true);
    assert.equal(byKey(c.fields, 'title')?.required, true);
    assert.equal(byKey(c.fields, 'description')?.localized, true);
    const parent = byKey(c.fields, 'parent') as RelationField;
    assert.equal(parent.kind, 'relation');
    assert.equal(parent.to, 'article_category');
    assert.equal(parent.picker, 'categoryTree');
    assert.equal(parent.shared, true);
  });

  test('a flat taxonomy has no parent', () => {
    const c = taxonomyCollection({ key: 'tagset', label: 'Tag', labelPlural: 'Tags', pathTemplate: '/t/{slug}' });
    assert.equal(byKey(c.fields, 'parent'), undefined);
  });
});

describe('unpublishRedirect config validation', () => {
  const base = { locales: ['el', 'en'], defaultLocale: 'el' };
  const category = taxonomyCollection({
    key: 'article_category',
    label: 'Category',
    labelPlural: 'Categories',
    pathTemplate: '/blog/categories/{slug}',
    hierarchical: true,
  });
  const article = (over: Record<string, unknown> = {}) => ({
    key: 'article',
    routing: { pathTemplate: '/blog/{slug}' },
    fields: [f.text('title'), f.relation('categories', { to: 'article_category', many: true })],
    unpublishRedirect: { taxonomyField: 'categories', fallbackPath: '/blog/categories' },
    ...over,
  });

  test('accepts a top-level relation field and a safe internal fallback', () => {
    assert.doesNotThrow(() => defineConfig({ ...base, collections: [category, article()] }));
  });

  test('rejects a taxonomy field that is missing or not a relation', () => {
    assert.throws(
      () =>
        defineConfig({
          ...base,
          collections: [category, article({ unpublishRedirect: { taxonomyField: 'ghost', fallbackPath: '/blog/categories' } })],
        }),
      /unpublishRedirect/,
    );
    assert.throws(
      () =>
        defineConfig({
          ...base,
          collections: [category, article({ unpublishRedirect: { taxonomyField: 'title', fallbackPath: '/blog/categories' } })],
        }),
      /unpublishRedirect/,
    );
  });

  test('rejects a fallback that is not a single-slash internal path', () => {
    for (const fallbackPath of ['blog/categories', '//evil.example', 'https://evil.example', '']) {
      assert.throws(
        () =>
          defineConfig({
            ...base,
            collections: [category, article({ unpublishRedirect: { taxonomyField: 'categories', fallbackPath } })],
          }),
        /unpublishRedirect/,
        fallbackPath,
      );
    }
  });

  test('rejects a termPathTemplate that is not internal or has no {slug}', () => {
    for (const termPathTemplate of ['//evil/{slug}', 'https://evil/{slug}', '/blog/categories']) {
      assert.throws(
        () =>
          defineConfig({
            ...base,
            collections: [
              category,
              article({ unpublishRedirect: { taxonomyField: 'categories', fallbackPath: '/blog', termPathTemplate } }),
            ],
          }),
        /unpublishRedirect/,
        termPathTemplate,
      );
    }
    assert.doesNotThrow(() =>
      defineConfig({
        ...base,
        collections: [
          category,
          article({ unpublishRedirect: { taxonomyField: 'categories', fallbackPath: '/blog', termPathTemplate: '/blog?category={slug}' } }),
        ],
      }),
    );
  });

  test('rejects a collection with no public route', () => {
    assert.throws(
      () => defineConfig({ ...base, collections: [category, article({ routing: {} })] }),
      /unpublishRedirect/,
    );
  });
});

describe('reserved slugs', () => {
  const c = resolveCollection({ key: 'article', fields: [], routing: { pathTemplate: '/blog/{slug}', reservedSlugs: ['categories'] } });

  test('a reserved slug is refused, case- and whitespace-insensitively', () => {
    assert.equal(isReservedSlug(c, 'categories'), true);
    assert.equal(isReservedSlug(c, ' Categories '), true);
  });

  test('any other slug, or a collection that reserves nothing, is allowed', () => {
    assert.equal(isReservedSlug(c, 'categories-guide'), false);
    assert.equal(isReservedSlug(resolveCollection({ key: 'page', fields: [] }), 'categories'), false);
  });
});
