import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { resolveCollection } from '@/cms/config/collection';
import {
  isVersionConflictError,
  nextCanonicalPath,
  VERSION_CONFLICT_MESSAGE,
  versionConflict,
} from '@/cms/core/documents/service';

/**
 * Two things `updateDocument` got wrong, both invisible until they mattered.
 *
 * - A slug rename kept the old `canonical_path`. Create derives it from the
 *   slug, update only copied what the patch sent, and the admin form never sends
 *   one — so the stored routing index kept pointing at the old address.
 * - The optimistic-concurrency check ran before the transaction, unlocked, and
 *   the version number was max+1 unlocked too. Two saves racing both passed the
 *   check and then collided on `uniq_document_versions_doc_version`, which the
 *   editor saw as a generic "Already exists."
 *
 * The decisions are pure and tested here; the locking is pinned by reading the
 * source, like the other write-path suites — there is no database in tests.
 */

const DEFAULT = 'el';
const article = resolveCollection({
  key: 'article',
  fields: [],
  routing: { pathTemplate: '/blog/{slug}' },
});
const noSeo = resolveCollection({
  key: 'brand',
  fields: [],
  seo: false,
  routing: { pathTemplate: '/brands/{slug}' },
});
const stored = { slug: 'old', locale: 'el', canonicalPath: '/blog/old' };

describe('nextCanonicalPath — a slug rename moves the routing index', () => {
  test('a slug change without a canonicalPath re-derives it', () => {
    assert.equal(nextCanonicalPath(article, stored, { slug: 'new' }, DEFAULT), '/blog/new');
  });

  test('a non-default locale is prefixed, exactly as on create', () => {
    const en = { slug: 'old', locale: 'en', canonicalPath: '/en/blog/old' };
    assert.equal(nextCanonicalPath(article, en, { slug: 'new' }, DEFAULT), '/en/blog/new');
  });

  test('a locale change re-derives it too', () => {
    assert.equal(nextCanonicalPath(article, stored, { locale: 'en' }, DEFAULT), '/en/blog/old');
  });

  test('an explicit canonicalPath still wins (version restore, PM bridge)', () => {
    assert.equal(nextCanonicalPath(article, stored, { slug: 'new', canonicalPath: '/x' }, DEFAULT), '/x');
    assert.equal(nextCanonicalPath(article, stored, { slug: 'new', canonicalPath: null }, DEFAULT), null);
  });

  test('an unchanged slug keeps what is stored', () => {
    assert.equal(nextCanonicalPath(article, stored, {}, DEFAULT), '/blog/old');
    assert.equal(nextCanonicalPath(article, stored, { slug: 'old' }, DEFAULT), '/blog/old');
  });

  test('a collection without SEO follows the create rule and is left alone', () => {
    const row = { slug: 'old', locale: 'el', canonicalPath: null };
    assert.equal(nextCanonicalPath(noSeo, row, { slug: 'new' }, DEFAULT), null);
  });
});

describe('version conflicts', () => {
  const dup = (key: string) => {
    const inner = Object.assign(new Error(`Duplicate entry '5-3' for key '${key}'`), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    // drizzle wraps the driver error; only `cause` carries the real one.
    return Object.assign(new Error('Failed query: insert into `document_versions` …'), { cause: inner });
  };

  test('a duplicate version number is recognised through the drizzle wrapper', () => {
    assert.equal(isVersionConflictError(dup('uniq_document_versions_doc_version')), true);
  });

  test('other duplicate keys are not — a canonical-path clash is a different 409', () => {
    assert.equal(isVersionConflictError(dup('uniq_documents_canonical_path')), false);
    assert.equal(isVersionConflictError(new Error('boom')), false);
  });

  test('the mapped error is the same conflict the expectedVersion check returns', () => {
    const err = versionConflict();
    assert.equal(err.code, 'conflict');
    assert.equal(err.status, 409);
    assert.equal(err.message, VERSION_CONFLICT_MESSAGE);
  });
});

describe('updateDocument wiring', () => {
  const src = readFileSync('src/cms/core/documents/service.ts', 'utf8');
  const body = src.slice(src.indexOf('export async function updateDocument'), src.indexOf('export async function deleteDocument'));

  test('the version check happens inside the transaction, after a row lock', () => {
    const tx = body.indexOf('db.transaction(');
    const lock = body.indexOf(".for('update')");
    const check = body.indexOf('patch.expectedVersion !== undefined');
    assert.ok(tx > 0 && lock > tx, 'row lock inside the transaction');
    assert.ok(check > lock, 'expectedVersion checked after the lock');
    assert.equal(body.indexOf('documentVersionNumber('), -1, 'no unlocked pre-check');
  });

  test('a unique-key clash on the version number maps to the conflict error', () => {
    assert.match(body, /isVersionConflictError\(err\)\) throw versionConflict\(\)/);
  });

  test('canonical_path comes from nextCanonicalPath, not a copy of the stored one', () => {
    assert.match(body, /nextCanonicalPath\(collection, existing, patch, config\.defaultLocale\)/);
    assert.doesNotMatch(body, /canonicalPath: patch\.canonicalPath !== undefined/);
  });
});
