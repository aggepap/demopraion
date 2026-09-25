import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { previewTargetFor } from '@/cms/core/documents/preview-target';

/**
 * "Preview draft" has to open the language the editor is looking at.
 *
 * The edit screen is one URL per translation GROUP: the row id in the address
 * is whichever variant happened to be opened, and the language tabs move
 * `?locale=` rather than navigating to the sibling row. The preview link was
 * built from the opened row, so an editor on the English tab pressed Preview
 * and landed on the Greek article — the one whose id was in the URL.
 */

const row = (locale: string, canonicalPath: string | null, id = 1) => ({
  id,
  locale,
  canonicalPath,
});

const group = [row('el', '/insights/arthro', 1), row('en', '/en/insights/article', 2)];

describe('previewTargetFor', () => {
  test('follows the language tab the editor is on', () => {
    assert.deepEqual(previewTargetFor(group, 'en', group[0]), {
      path: '/en/insights/article',
      locale: 'en',
    });
  });

  test('the opened row is used when no language was asked for', () => {
    assert.deepEqual(previewTargetFor(group, null, group[0]), {
      path: '/insights/arthro',
      locale: 'el',
    });
  });

  test('a language with no saved variant has nothing to preview', () => {
    // Previewing it would show a different language's page, which is the bug.
    assert.equal(previewTargetFor(group, 'de', group[0]), null);
  });

  test('a variant that exists but has no public path has nothing to preview', () => {
    const hidden = [row('el', '/x', 1), row('en', null, 2)];
    assert.equal(previewTargetFor(hidden, 'en', hidden[0]), null);
  });

  test('a single-language document previews itself', () => {
    const only = [row('el', '/insights/arthro', 1)];
    assert.deepEqual(previewTargetFor(only, 'el', only[0]), {
      path: '/insights/arthro',
      locale: 'el',
    });
  });

  test('an unknown language in the URL is not silently the default one', () => {
    // `?locale=xx` is a typed URL; showing the Greek page for it is the bug.
    assert.equal(previewTargetFor(group, 'xx', group[0]), null);
  });
});
