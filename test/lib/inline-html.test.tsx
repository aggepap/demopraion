/**
 * `faq.questionHtml` reached `dangerouslySetInnerHTML` directly from an
 * unrestricted `f.text` field, so a `<script>` in an FAQ question executed for
 * every visitor (the site's CSP allows inline script for its own JSON-LD, so it
 * was no help). `renderInlineHtml` replaces that sink.
 *
 * Two things are asserted: the emphasis markup the stored content actually
 * carries still renders as elements, and everything else comes out as text.
 * "Comes out as text" is the security property — React escapes strings, so a
 * rule this parser fails to recognise shows up on screen instead of executing.
 */
import './../setup/react-global';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { renderInlineHtml } from '@/lib/cms/inline-html';

const html = (input: string): string =>
  renderToStaticMarkup(<>{renderInlineHtml(input)}</>);

describe('renderInlineHtml — keeps the markup the content uses', () => {
  test('the accent <em> the static FAQ questions carry', () => {
    // Exactly what `src/seeds/articles.ts` stores, via renderToStaticMarkup of
    // `<em className="italic font-display">` in src/content/approach.tsx.
    assert.equal(
      html('Τι ακριβώς είναι το <em class="italic font-display">AEO</em>;'),
      'Τι ακριβώς είναι το <em class="italic font-display">AEO</em>;',
    );
  });

  test('the other inline tags, with and without a class', () => {
    assert.equal(html('<strong>bold</strong>'), '<strong>bold</strong>');
    assert.equal(html('<b>b</b> and <i>i</i>'), '<b>b</b> and <i>i</i>');
    assert.equal(html('<span class="x">s</span>'), '<span class="x">s</span>');
  });

  test('a line break', () => {
    assert.equal(html('one<br>two'), 'one<br/>two');
    assert.equal(html('one<br />two'), 'one<br/>two');
  });

  test('nesting', () => {
    assert.equal(
      html('a <strong>b <em>c</em></strong> d'),
      'a <strong>b <em>c</em></strong> d',
    );
  });

  test('plain text passes through', () => {
    assert.equal(html('Just a question?'), 'Just a question?');
  });

  test('empty input', () => {
    assert.equal(html(''), '');
  });
});

describe('renderInlineHtml — everything else becomes text', () => {
  test('a script tag never becomes a script tag', () => {
    const out = html('<script>alert(1)</script>');
    assert.ok(!out.includes('<script>'), `script survived: ${out}`);
    assert.equal(out, '&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('an image with an event handler', () => {
    const out = html('<img src=x onerror="alert(1)">');
    assert.ok(!out.includes('<img'), `img survived: ${out}`);
  });

  test('an iframe', () => {
    assert.ok(!html('<iframe src="http://evil"></iframe>').includes('<iframe'));
  });

  test('an anchor — no javascript: URL can be reached because href is dropped', () => {
    const out = html('<a href="javascript:alert(1)">x</a>');
    assert.ok(!out.includes('<a'), `anchor survived: ${out}`);
    assert.ok(!out.includes('javascript:alert(1)"'), 'href rendered as an attribute');
  });

  test('an event handler on an ALLOWED tag is dropped, the tag is kept', () => {
    // The tag is fine; the attribute is not on the list.
    const out = html('<span onmouseover="alert(1)" class="ok">x</span>');
    assert.equal(out, '<span class="ok">x</span>');
  });

  test('a style attribute is dropped', () => {
    assert.equal(html('<em style="position:fixed;inset:0">x</em>'), '<em>x</em>');
  });

  test('uppercase and mixed-case tags are treated the same', () => {
    assert.ok(!html('<SCRIPT>alert(1)</SCRIPT>').includes('<SCRIPT'));
    assert.equal(html('<EM class="a">x</EM>'), '<em class="a">x</em>');
  });

  test('a bare < is text, not the start of a tag', () => {
    assert.equal(html('5 < 6 and 7 > 6'), '5 &lt; 6 and 7 &gt; 6');
  });

  test('a comment is text', () => {
    assert.ok(!html('<!-- <script>alert(1)</script> -->').includes('<script>'));
  });
});

describe('renderInlineHtml — malformed input still renders its text', () => {
  test('an unclosed tag closes at the end', () => {
    assert.equal(html('<em>dangling'), '<em>dangling</em>');
  });

  test('an unmatched closing tag is ignored', () => {
    assert.equal(html('text</em>'), 'text');
  });

  test('crossed tags recover innermost-first', () => {
    // A browser does the same; the point is that nothing is lost or escapes.
    const out = html('<em>a<strong>b</em>c</strong>');
    assert.ok(out.includes('a'), out);
    assert.ok(out.includes('b'), out);
    assert.ok(out.includes('c'), out);
    assert.ok(!out.includes('&lt;strong&gt;'), out);
  });

  test('entities are decoded once, then re-escaped by React', () => {
    assert.equal(html('a &amp; b'), 'a &amp; b');
    assert.equal(html('&lt;script&gt;'), '&lt;script&gt;');
  });

  test('a double-encoded script stays inert', () => {
    // `&amp;lt;` decodes to `&lt;`, which React escapes to `&amp;lt;` — never a tag.
    const out = html('&amp;lt;script&amp;gt;');
    assert.ok(!out.includes('<script'), out);
  });
});
