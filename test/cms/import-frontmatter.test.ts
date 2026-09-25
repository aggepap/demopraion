import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  FrontmatterError,
  normalizeSource,
  parseFrontmatterBlock,
  splitFrontmatter,
} from '@/cms/core/import/frontmatter';

describe('splitFrontmatter', () => {
  test('separates the block from the body', () => {
    const { raw, body } = splitFrontmatter('---\nslug: a\n---\n\n## Heading\n');
    assert.equal(raw, 'slug: a');
    assert.equal(body, '## Heading\n');
  });

  test('a file with no block is all body', () => {
    const { raw, body } = splitFrontmatter('## Heading\n\nProse.\n');
    assert.equal(raw, null);
    assert.equal(body, '## Heading\n\nProse.\n');
  });

  test('CRLF is normalised so the delimiter still matches', () => {
    const { raw, body } = splitFrontmatter('---\r\nslug: a\r\n---\r\n\r\nProse.\r\n');
    assert.equal(raw, 'slug: a');
    assert.equal(body, 'Prose.\n');
  });

  test('a BOM before the opening delimiter does not hide the block', () => {
    // Without the BOM strip the first line is "\uFEFF---", the file reads as
    // body-only, and every setting silently goes missing.
    const { raw } = splitFrontmatter('\uFEFF---\nslug: a\n---\n\nProse.\n');
    assert.equal(raw, 'slug: a');
  });

  test('--- inside the body is a horizontal rule, not an opener', () => {
    const { raw, body } = splitFrontmatter('Prose.\n\n---\n\nMore prose.\n');
    assert.equal(raw, null);
    assert.match(body, /^Prose\./);
  });

  test('the first --- after the opener closes the block, later ones stay in the body', () => {
    const { raw, body } = splitFrontmatter('---\nslug: a\n---\n\nOne.\n\n---\n\nTwo.\n');
    assert.equal(raw, 'slug: a');
    assert.equal(body, 'One.\n\n---\n\nTwo.\n');
  });

  test('an unterminated block is refused rather than swallowing the whole file', () => {
    assert.throws(() => splitFrontmatter('---\nslug: a\n\nProse.\n'), FrontmatterError);
  });

  test('trailing whitespace on a delimiter is tolerated', () => {
    assert.equal(splitFrontmatter('--- \nslug: a\n---  \nProse.\n').raw, 'slug: a');
  });

  test('normalizeSource drops the BOM and folds CR', () => {
    assert.equal(normalizeSource('\uFEFFa\r\nb\rc'), 'a\nb\nc');
  });
});

describe('parseFrontmatterBlock', () => {
  test('parses nested blocks and lists', () => {
    assert.deepEqual(parseFrontmatterBlock('a:\n  b: 1\nc:\n  - x\n  - y\n'), {
      a: { b: 1 },
      c: ['x', 'y'],
    });
  });

  test('an empty block is an empty object, not a failure', () => {
    assert.deepEqual(parseFrontmatterBlock(''), {});
  });

  test('dates stay strings under the 1.2 core schema', () => {
    // Under YAML 1.1 this parses to a Date, so a value's type would depend on
    // whether the author happened to quote it. Coercion belongs in one place.
    const parsed = parseFrontmatterBlock('publishedAt: 2026-08-24\n');
    assert.equal(typeof parsed.publishedAt, 'string');
    assert.equal(parsed.publishedAt, '2026-08-24');
  });

  test('"no" is a string, not false', () => {
    assert.equal(parseFrontmatterBlock('eyebrow: no\n').eyebrow, 'no');
  });

  test('anchors and aliases are refused', () => {
    // The billion-laughs vector: a few lines that expand into gigabytes while
    // the request is still being parsed.
    assert.throws(() => parseFrontmatterBlock('a: &x hello\nb: *x\n'), FrontmatterError);
  });

  test('malformed YAML is refused instead of silently recovered', () => {
    // The parser repairs all of these rather than failing, and every repair is a
    // document quietly missing content — hence the explicit `doc.errors` check.
    assert.throws(() => parseFrontmatterBlock('a: [1, 2\n'), FrontmatterError);
    assert.throws(() => parseFrontmatterBlock('a: "unterminated\n'), FrontmatterError);
    assert.throws(() => parseFrontmatterBlock('a: 1\n a: 2\n'), FrontmatterError);
  });

  test('a tab-indented block is refused, not flattened', () => {
    // `{ a: null, b: 1 }` is what recovery produces: the nesting is gone and `b`
    // has been promoted to a top-level key the collection does not have.
    assert.throws(() => parseFrontmatterBlock('a:\n\tb: 1\n'), FrontmatterError);
  });

  test('a bare scalar or list is refused', () => {
    assert.throws(() => parseFrontmatterBlock('just a string\n'), FrontmatterError);
    assert.throws(() => parseFrontmatterBlock('- one\n- two\n'), FrontmatterError);
  });
});
