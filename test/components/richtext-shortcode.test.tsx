import '../setup/react-global'; // must precede any component import

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { paragraphShortcode, RichText } from '@/components/cms/RichText';

/**
 * What a page body does with square brackets.
 *
 * The risk this pins is the opposite of the feature: content written years
 * before shortcodes existed must not be reinterpreted. A paragraph is a
 * shortcode only when it is ENTIRELY one, and `[[name]]` is how an author
 * writes about one.
 *
 * The rendering of an actual shortcode is asynchronous (it reads module flags
 * and may fetch), so it is not asserted here — `shortcode-registry.test.ts`
 * covers what may render at all.
 */

const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })),
});

const html = (value: unknown) => renderToStaticMarkup(<RichText value={value} />);

describe('RichText and square brackets', () => {
  test('prose that merely contains brackets is left alone', () => {
    const out = html(doc('See the note [1] and the other [see below].'));
    assert.match(out, /\[1\]/);
    assert.match(out, /\[see below\]/);
  });

  test('a bracketed phrase that is not a shortcode stays as text', () => {
    // A whole paragraph, but not the grammar: lowercase kebab-case only.
    assert.match(html(doc('[Not A Shortcode]')), /\[Not A Shortcode\]/);
  });

  test('an escaped shortcode renders as the literal text', () => {
    const out = html(doc('[[brands]]'));
    assert.match(out, /\[brands\]/);
    assert.doesNotMatch(out, /\[\[brands\]\]/);
  });

  test('a real shortcode paragraph is recognised as one', () => {
    // It becomes an async server component, which a static render cannot
    // execute — so the DECISION is asserted rather than the output.
    const paragraph = { content: [{ type: 'text', text: '[brands]' }] };
    assert.deepEqual(paragraphShortcode(paragraph), { name: 'brands', attrs: {} });
  });

  test('prose is not', () => {
    assert.equal(paragraphShortcode({ content: [{ type: 'text', text: 'See [1]' }] }), null);
    assert.equal(paragraphShortcode({ content: [{ type: 'text', text: '[[brands]]' }] }), null);
  });

  test('a paragraph with formatting is never treated as a shortcode', () => {
    // Bold inside the brackets means the author was writing, not inserting.
    const withMark = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '[brands]', marks: [{ type: 'bold' }] }],
        },
      ],
    };
    assert.match(html(withMark), /\[brands\]/);
    assert.equal(
      paragraphShortcode({
        content: [{ type: 'text', text: '[brands]', marks: [{ type: 'bold' }] }],
      }),
      null
    );
  });
});
