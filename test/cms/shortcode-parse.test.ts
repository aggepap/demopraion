import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  parseShortcode,
  serializeShortcode,
  shortcodeFromParagraph,
} from '@/cms/core/shortcodes/parse';

/**
 * `[name attr="value"]` in the body of a page or an article.
 *
 * The grammar is deliberately narrow. Only a paragraph that is ENTIRELY one
 * shortcode becomes a component, so a sentence that happens to mention
 * "[see note]" is left as the words the author typed. `[[name]]` escapes to a
 * literal `[name]`, which is how an author writes about shortcodes at all.
 *
 * Nothing here decides whether a shortcode may render — that is the registry's
 * job, and it validates the attributes as well.
 */

describe('parseShortcode', () => {
  test('reads a bare name', () => {
    assert.deepEqual(parseShortcode('[brands]'), { name: 'brands', attrs: {} });
  });

  test('reads quoted attributes', () => {
    assert.deepEqual(parseShortcode('[google-reviews layout="carousel" limit="6"]'), {
      name: 'google-reviews',
      attrs: { layout: 'carousel', limit: '6' },
    });
  });

  test('tolerates the spacing people actually type', () => {
    assert.deepEqual(parseShortcode('  [brands   layout="grid"  ]  '), {
      name: 'brands',
      attrs: { layout: 'grid' },
    });
  });

  test('allows an escaped quote inside a value', () => {
    assert.deepEqual(parseShortcode('[popup title="He said \\"hi\\""]'), {
      name: 'popup',
      attrs: { title: 'He said "hi"' },
    });
  });

  test('refuses anything that is not exactly one shortcode', () => {
    for (const raw of [
      'Text before [brands]',
      '[brands] text after',
      '[brands][countdown]',
      '[Brands]', // names are lowercase
      '[bra nds]',
      '[brands layout=grid]', // unquoted values are not the syntax
      '[]',
      '[ ]',
      'brands',
      '',
    ]) {
      assert.equal(parseShortcode(raw), null, JSON.stringify(raw));
    }
  });

  test('an escaped shortcode is not a shortcode', () => {
    // How an author writes ABOUT a shortcode in a page.
    assert.equal(parseShortcode('[[brands]]'), null);
  });

  test('a duplicated attribute keeps the first, rather than being ambiguous', () => {
    assert.deepEqual(parseShortcode('[x a="1" a="2"]')?.attrs, { a: '1' });
  });

  test('refuses absurd input rather than working hard on it', () => {
    assert.equal(parseShortcode(`[x a="${'y'.repeat(5000)}"]`), null);
    assert.equal(parseShortcode(`[${'a'.repeat(200)}]`), null);
  });
});

describe('shortcodeFromParagraph', () => {
  test('a paragraph that is only a shortcode becomes one', () => {
    assert.deepEqual(shortcodeFromParagraph('[brands]'), { name: 'brands', attrs: {} });
  });

  test('a paragraph with anything else around it does not', () => {
    assert.equal(shortcodeFromParagraph('See [brands] for more'), null);
  });

  test('an escaped one unescapes to text, not to a component', () => {
    assert.equal(shortcodeFromParagraph('[[brands]]'), null);
  });
});

describe('serializeShortcode', () => {
  test('round-trips', () => {
    const text = serializeShortcode('google-reviews', { layout: 'grid', limit: '6' });
    assert.equal(text, '[google-reviews layout="grid" limit="6"]');
    assert.deepEqual(parseShortcode(text), {
      name: 'google-reviews',
      attrs: { layout: 'grid', limit: '6' },
    });
  });

  test('escapes a quote in a value, so the result still parses', () => {
    const text = serializeShortcode('popup', { title: 'He said "hi"' });
    assert.deepEqual(parseShortcode(text)?.attrs.title, 'He said "hi"');
  });

  test('drops empty attributes rather than writing noise', () => {
    assert.equal(serializeShortcode('brands', { layout: '', limit: '6' }), '[brands limit="6"]');
  });

  test('a bracket in a value cannot end the shortcode early', () => {
    const text = serializeShortcode('popup', { title: 'a] [b' });
    const parsed = parseShortcode(text);
    assert.equal(parsed?.name, 'popup');
    assert.equal(parsed?.attrs.title, 'a] [b');
  });
});
