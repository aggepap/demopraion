/**
 * Where a PM payload is stored, and where the page looks for it.
 *
 * The bridge stored a non-default-locale payload under the document's canonical
 * path — `/en/foo` — while every reader (`localizedMetadata`, `PmStructuredData`)
 * asks for the unprefixed path plus the locale: `/foo` + `en`. The two never met,
 * so PM's head data silently never reached any page outside the main language.
 * Storage is now unprefixed; lookup also accepts rows written the old way.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { localeKeyedPath, localeKeyedPathCandidates } from '@/cms/core/seo/locale-path';

describe('localeKeyedPath', () => {
  test('strips the locale prefix of a non-default locale', () => {
    assert.equal(localeKeyedPath('/en/foo', 'en', 'el'), '/foo');
    assert.equal(localeKeyedPath('/en/blog/post', 'en', 'el'), '/blog/post');
    assert.equal(localeKeyedPath('/en', 'en', 'el'), '/');
  });

  test('leaves the default locale and look-alike segments alone', () => {
    assert.equal(localeKeyedPath('/foo', 'el', 'el'), '/foo');
    assert.equal(localeKeyedPath('/foo', 'en', 'el'), '/foo');
    assert.equal(localeKeyedPath('/english', 'en', 'el'), '/english');
    // A default-locale page whose slug happens to be another locale's code.
    assert.equal(localeKeyedPath('/en/foo', 'el', 'el'), '/en/foo');
  });
});

describe('localeKeyedPathCandidates', () => {
  test('the unprefixed path first, then the prefixed form older rows used', () => {
    assert.deepEqual(localeKeyedPathCandidates('/foo', 'en'), ['/foo', '/en/foo']);
    assert.deepEqual(localeKeyedPathCandidates('/', 'en'), ['/', '/en']);
  });
});

describe('wiring', () => {
  test('the payload route stores under the locale-keyed path', () => {
    const src = readFileSync('src/cms/modules/pm/routes.ts', 'utf8');
    assert.match(src, /localeKeyedPath\(target\.path, target\.locale, config\.defaultLocale\)/);
  });

  test('the payload lookup accepts both forms', () => {
    const src = readFileSync('src/cms/core/seo/resolve.ts', 'utf8');
    assert.match(src, /inArray\(schema\.pmHeadPayloads\.path, localeKeyedPathCandidates\(path, locale\)\)/);
  });
});

describe('pm/write.ts', () => {
  const src = readFileSync('src/cms/modules/pm/write.ts', 'utf8');

  test("keys its meta patch like the readers, not by the document's public URL", () => {
    assert.match(src, /localeKeyedPath\(updated\.canonicalPath/);
  });

  // `updateDocument` already writes the slug-change 301 (`applySlugChangeRedirect`),
  // with the rules the rest of the CMS follows: only for a page visitors could
  // reach, and never over an admin's own rule for the old address. The bridge
  // wrote a second one on top that ignored both.
  test('leaves the slug-change redirect to updateDocument', () => {
    assert.doesNotMatch(src, /writeSlugRedirect|createRedirect|updateRedirect/);
  });
});
