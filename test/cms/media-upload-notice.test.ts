import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { duplicateNotice } from '@/cms/admin/media-upload-notice';

/**
 * What the editor is told when the file they just uploaded was already there.
 *
 * Silently handing back an existing file would be the confusing kind of clever:
 * they picked `logo-final-v2.png` and the library shows `logo.png`, with nothing
 * to explain why. The upload screens keep failures in one line already; this is
 * the same idea for duplicates, and it lives outside the components so it can be
 * tested without driving a browser.
 */

describe('duplicateNotice', () => {
  test('says nothing when every file was new', () => {
    assert.equal(duplicateNotice([]), null);
  });

  test('names the one file that was already there', () => {
    const notice = duplicateNotice(['logo.png']);
    assert.match(notice!, /logo\.png/);
    assert.match(notice!, /already in the library/i);
    // Singular: one file is not "1 files".
    assert.doesNotMatch(notice!, /files/i);
  });

  test('counts and names several', () => {
    const notice = duplicateNotice(['logo.png', 'hero.jpg', 'terms.pdf']);
    assert.match(notice!, /3 files/);
    for (const name of ['logo.png', 'hero.jpg', 'terms.pdf']) {
      assert.ok(notice!.includes(name), name);
    }
  });

  test('makes clear nothing was lost — the existing file is the one in use', () => {
    assert.match(duplicateNotice(['a.png'])!, /existing file/i);
  });
});
