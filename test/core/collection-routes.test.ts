import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { ApiError } from '@/cms/core/errors';
import { normalizeDocumentSlug } from '@/cms/core/documents/slug-input';
import { collectionAvailable, listQuery } from '@/cms/core/routes/collections';

/**
 * The generic `/api/cms/:collection` routes.
 *
 * - `?grouped=false` was parsed by `z.coerce.boolean()`, i.e. `Boolean("false")`,
 *   which is `true`.
 * - A collection that belongs to a module answered with the module off.
 * - Slugs were trimmed and stored as typed — case, spaces, Greek and all.
 */

describe('list query — booleans', () => {
  const grouped = (v: string) => listQuery.parse({ grouped: v }).grouped;

  test('"false" and "0" are false', () => {
    assert.equal(grouped('false'), false);
    assert.equal(grouped('0'), false);
  });

  test('"true" and "1" are true, and an absent flag stays undefined', () => {
    assert.equal(grouped('true'), true);
    assert.equal(grouped('1'), true);
    assert.equal(listQuery.parse({}).grouped, undefined);
  });

  test('nonsense is refused rather than read as true', () => {
    assert.equal(listQuery.safeParse({ grouped: 'banana' }).success, false);
  });
});

describe('collectionAvailable — module flags', () => {
  test('a collection outside any module is always available', () => {
    assert.equal(collectionAvailable({}, {}), true);
  });

  test('a module collection follows its module', () => {
    assert.equal(collectionAvailable({ module: 'commerce' }, { commerce: true }), true);
    assert.equal(collectionAvailable({ module: 'commerce' }, { commerce: false }), false);
    assert.equal(collectionAvailable({ module: 'commerce' }, {}), false);
  });

  test('an unknown collection is not', () => {
    assert.equal(collectionAvailable(undefined, {}), false);
  });

  test('every generic collection route checks it, including import', () => {
    const src = readFileSync('src/cms/core/routes/collections.ts', 'utf8');
    const factories = src.split(/export function collection\w+Route/).slice(1);
    assert.equal(factories.length, 7);
    for (const body of factories) assert.match(body, /await assertCollection\(config, params\.collection\)/);
    assert.match(readFileSync('src/cms/core/routes/import.ts', 'utf8'), /await assertCollection\(config, key\)/);
  });
});

describe('normalizeDocumentSlug', () => {
  test('uses the shared slugify — lowercase, hyphens, Greek transliterated', () => {
    assert.equal(normalizeDocumentSlug('  My First Post! '), 'my-first-post');
    assert.equal(normalizeDocumentSlug('Νέα Άρθρα'), 'nea-arthra');
    assert.equal(normalizeDocumentSlug('already-clean'), 'already-clean');
  });

  test('a slug already stored for the document is kept exactly, never rewritten', () => {
    assert.equal(normalizeDocumentSlug('Legacy_Slug', ['Legacy_Slug']), 'Legacy_Slug');
    assert.equal(normalizeDocumentSlug(' Legacy_Slug ', ['Legacy_Slug']), 'Legacy_Slug');
    // …but a changed one is normalised.
    assert.equal(normalizeDocumentSlug('New_Slug', ['Legacy_Slug']), 'new-slug');
  });

  test('a slug with nothing sluggable in it is refused on the slug field', () => {
    assert.throws(
      () => normalizeDocumentSlug('!!!'),
      (err: unknown) => err instanceof ApiError && err.code === 'invalid_input',
    );
  });

  test('create and update both normalise', () => {
    const src = readFileSync('src/cms/core/routes/collections.ts', 'utf8');
    assert.match(src, /input\.slug = normalizeDocumentSlug\(\s*input\.slug,\s*input\.translationGroupId/);
    assert.match(src, /input\.slug = normalizeDocumentSlug\(input\.slug, \[before\.slug\]\)/);
  });
});
