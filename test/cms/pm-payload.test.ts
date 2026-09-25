/**
 * The payload store's validators.
 *
 * These are the last checkpoint before operator-supplied JSON reaches
 * `dangerouslySetInnerHTML` on a public page, so they are tested as security
 * controls rather than as input tidying.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { payloadHash } from '@/cms/modules/pm/payload';
import { safeJsonLd } from '@/cms/modules/pm/jsonld';

describe('payloadHash', () => {
  const base = { headMeta: { title: 'a' }, jsonld: [{ '@type': 'Article' }], alternates: null, seoOverride: false };

  test('is stable for identical input', () => {
    assert.equal(payloadHash(base), payloadHash({ ...base }));
  });

  test('ignores key order — a re-serialisation is not a change', () => {
    const reordered = {
      seoOverride: false,
      alternates: null,
      jsonld: [{ '@type': 'Article' }],
      headMeta: { title: 'a' },
    };
    assert.equal(payloadHash(base), payloadHash(reordered));
  });

  test('ignores nested key order too', () => {
    const a = { ...base, headMeta: { title: 'a', description: 'b' } };
    const b = { ...base, headMeta: { description: 'b', title: 'a' } };
    assert.equal(payloadHash(a), payloadHash(b));
  });

  test('changes when content changes', () => {
    assert.notEqual(payloadHash(base), payloadHash({ ...base, headMeta: { title: 'b' } }));
    assert.notEqual(payloadHash(base), payloadHash({ ...base, seoOverride: true }));
    assert.notEqual(payloadHash(base), payloadHash({ ...base, jsonld: [{ '@type': 'Product' }] }));
  });

  test('is a sha256 hex digest', () => {
    assert.match(payloadHash(base), /^[0-9a-f]{64}$/);
  });
});

describe('safeJsonLd — a </script> inside any string is an XSS breakout', () => {
  test('escapes the closing-tag sequence', () => {
    const out = safeJsonLd({ '@type': 'Article', headline: '</script><img onerror=alert(1)>' });
    assert.ok(!out.includes('</script'), 'no raw closing tag survives');
    assert.ok(!out.includes('<img'), 'no raw tag survives');
  });

  test('escapes angle brackets and ampersands everywhere, including nested values', () => {
    const out = safeJsonLd({ '@type': 'X', a: { b: ['<', '>', '&'] } });
    assert.ok(!out.includes('<'));
    assert.ok(!out.includes('>'));
    assert.ok(out.includes('\\u003c') || out.includes('\\u003C'));
  });

  test('escapes the U+2028/U+2029 line terminators that break a script block', () => {
    const out = safeJsonLd({ '@type': 'X', a: '\u2028\u2029' });
    assert.ok(!out.includes('\u2028'), 'no literal U+2028 survives');
    assert.ok(!out.includes('\u2029'), 'no literal U+2029 survives');
  });

  test('still produces JSON a parser round-trips to the original', () => {
    const value = { '@type': 'Article', headline: 'A < B & C > D' };
    assert.deepEqual(JSON.parse(safeJsonLd(value)), value);
  });

  test('handles arrays and null without throwing', () => {
    assert.equal(safeJsonLd(null), 'null');
    assert.deepEqual(JSON.parse(safeJsonLd([{ '@type': 'A' }])), [{ '@type': 'A' }]);
  });
});
