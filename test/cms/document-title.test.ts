import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { deriveDocumentTitle } from '@/cms/core/documents/service';

/**
 * The name a document is known by, in three places that must agree: the list
 * column, the search box, and the heading of the editor itself. The editor used
 * to show the slug instead — the one part of a document an editor rarely chose
 * and never says out loud — so a renamed experience was unrecognisable on the
 * screen it had just been renamed on.
 */
describe('deriveDocumentTitle', () => {
  test('reads the path the collection declared', () => {
    assert.equal(deriveDocumentTitle({ title: 'New Transport Experience' }, 'title'), 'New Transport Experience');
  });

  test('a blank or absent title is null, so the caller can say "Untitled"', () => {
    // A draft is allowed to have no name yet; that is not an error state.
    assert.equal(deriveDocumentTitle({ title: '   ' }, 'title'), null);
    assert.equal(deriveDocumentTitle({}, 'title'), null);
    assert.equal(deriveDocumentTitle(null, 'title'), null);
    assert.equal(deriveDocumentTitle('not an object', 'title'), null);
  });

  test('falls back to the usual keys when no path is declared', () => {
    assert.equal(deriveDocumentTitle({ name: 'By name' }), 'By name');
    assert.equal(deriveDocumentTitle({ question: 'By question' }), 'By question');
  });

  test('a declared path wins over the fallback keys', () => {
    assert.equal(deriveDocumentTitle({ headline: 'Declared', title: 'Guessed' }, 'headline'), 'Declared');
  });

  test('a title split across a group reads as one line', () => {
    // An accent headline is `{ before, accent, after }`; the reader sees one
    // sentence, so the heading has to as well.
    assert.equal(
      deriveDocumentTitle({ header: { before: 'Sail', accent: 'the', after: 'Aegean' } }, 'header'),
      'Sail the Aegean',
    );
  });

  /*
   * The order the group came back from the database in, not the order it was written in.
   *
   * MySQL normalises JSON object keys — by length, then lexicographically — so a
   * headline stored as `{before, accent, after}` is read back as
   * `{after, accent, before}`. Joining the values in the object's own order printed
   * every grouped headline backwards ("report Zephyrine The"), in the list column,
   * the search box and the editor heading alike. The declared order is passed in
   * because it is the only place the author's intent still exists.
   */
  test('a group read back in MySQL key order still reads in declared order', () => {
    const asStored = { after: ' report', accent: 'Zephyrine', before: 'The ' };
    assert.equal(
      deriveDocumentTitle({ header: asStored }, 'header', ['before', 'accent', 'after']),
      'The Zephyrine report',
    );
  });

  test('without the declared order it falls back to the stored order', () => {
    // Documented, not desirable: callers that have a collection must pass the order.
    assert.equal(
      deriveDocumentTitle({ header: { after: 'c', accent: 'b', before: 'a' } }, 'header'),
      'c b a',
    );
  });

  test('a part the declared order does not mention is still shown, last', () => {
    // A field renamed or added since must not vanish from the title.
    assert.equal(
      deriveDocumentTitle(
        { header: { before: 'The', accent: 'new', extra: 'part' } },
        'header',
        ['before', 'accent', 'after'],
      ),
      'The new part',
    );
  });
});
