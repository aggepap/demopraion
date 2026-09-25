/**
 * The bridge's pure translation layer.
 *
 * Several of these are security controls rather than conveniences — the
 * off-origin canonical rejection, the robots vocabulary and the
 * prototype-pollution guard — so they are tested as such.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

process.env.NEXT_PUBLIC_SITE_URL = 'https://praion.gr';

import { decodeRef, encodeRef, encodeRemoteId, PmRefError } from '@/cms/modules/pm/identity';
import {
  flattenTitle,
  formatRobots,
  getAtPath,
  isGroupTitle,
  isSafePath,
  mediaUuidFromUrl,
  parseRobots,
  setAtPath,
  toPmStatus,
  toSameOriginPath,
} from '@/cms/modules/pm/mapping';

describe('identity', () => {
  test('encodes a document as doc:<id>', () => {
    assert.equal(encodeRemoteId({ id: 42 }), 'doc:42');
  });

  test('decodes doc:42, a bare 42, and round-trips', () => {
    assert.deepEqual(decodeRef('wp_post', 'doc:42'), { kind: 'document', id: 42 });
    assert.deepEqual(decodeRef('wp_post', '42'), { kind: 'document', id: 42 });
    assert.equal(encodeRef(decodeRef('wp_post', 'doc:42')), 'doc:42');
  });

  test('tolerates surrounding whitespace', () => {
    assert.deepEqual(decodeRef('wp_post', ' doc:42 '), { kind: 'document', id: 42 });
  });

  test('decodes an archive by ref or by type', () => {
    assert.deepEqual(decodeRef('archive_home', 'archive_home'), {
      kind: 'archive',
      type: 'archive_home',
    });
    assert.deepEqual(decodeRef('archive_shop', ''), { kind: 'archive', type: 'archive_shop' });
    assert.equal(encodeRef(decodeRef('archive_404', 'archive_404')), 'archive_404');
  });

  test('rejects nonsense refs rather than guessing', () => {
    for (const bad of ['', 'abc', 'doc:', 'doc:abc', '-1', '0', '1.5', 'doc:1e3']) {
      assert.throws(() => decodeRef('wp_post', bad), PmRefError, `should reject ${JSON.stringify(bad)}`);
    }
  });

  test('does not treat a huge id as valid', () => {
    assert.throws(() => decodeRef('wp_post', '9'.repeat(30)), PmRefError);
  });
});

describe('status mapping', () => {
  test('published and scheduled are publish; draft and archived are draft', () => {
    assert.equal(toPmStatus('published'), 'publish');
    assert.equal(toPmStatus('scheduled'), 'publish');
    assert.equal(toPmStatus('draft'), 'draft');
    assert.equal(toPmStatus('archived'), 'draft');
  });
});

describe('robots parsing — a deindex is one bad push away', () => {
  test('accepts the four storable values', () => {
    assert.deepEqual(parseRobots('index, follow'), { noindex: false, nofollow: false });
    assert.deepEqual(parseRobots('noindex, follow'), { noindex: true, nofollow: false });
    assert.deepEqual(parseRobots('index, nofollow'), { noindex: false, nofollow: true });
    assert.deepEqual(parseRobots('noindex, nofollow'), { noindex: true, nofollow: true });
  });

  test('accepts the space-less and upper-case spellings', () => {
    assert.deepEqual(parseRobots('noindex,nofollow'), { noindex: true, nofollow: true });
    assert.deepEqual(parseRobots('NOINDEX, FOLLOW'), { noindex: true, nofollow: false });
  });

  test('accepts a half-specified value, defaulting the other half permissively', () => {
    assert.deepEqual(parseRobots('noindex'), { noindex: true, nofollow: false });
    assert.deepEqual(parseRobots('nofollow'), { noindex: false, nofollow: true });
  });

  test('refuses directives praion cannot store rather than dropping them', () => {
    for (const bad of ['noarchive', 'noindex, noarchive', 'max-snippet:-1', 'index, max-snippet:50']) {
      assert.equal(parseRobots(bad), null, bad);
    }
  });

  test('refuses garbage and contradictions', () => {
    for (const bad of ['noindex, <garbage>', '', '   ', 'index, index', 'a, b, c', 'follow, follow']) {
      assert.equal(parseRobots(bad), null, JSON.stringify(bad));
    }
  });

  test('refuses non-strings', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      assert.equal(parseRobots(bad), null);
    }
  });

  test('formats back to the canonical spelling', () => {
    assert.equal(formatRobots({ noindex: false, nofollow: false }), 'index, follow');
    assert.equal(formatRobots({ noindex: true, nofollow: true }), 'noindex, nofollow');
  });

  test('round-trips every storable value', () => {
    for (const v of ['index, follow', 'noindex, follow', 'index, nofollow', 'noindex, nofollow']) {
      assert.equal(formatRobots(parseRobots(v)!), v);
    }
  });
});

describe('off-origin rejection — the SEO-hijack class', () => {
  test('reduces an absolute URL on our origin to a path', () => {
    assert.equal(toSameOriginPath('https://praion.gr/shop/foo'), '/shop/foo');
    assert.equal(toSameOriginPath('https://PRAION.GR/shop/foo'), '/shop/foo');
    assert.equal(toSameOriginPath('https://praion.gr/shop?x=1'), '/shop?x=1');
  });

  test('accepts an already-relative path', () => {
    assert.equal(toSameOriginPath('/shop/foo'), '/shop/foo');
  });

  test('REFUSES an external origin', () => {
    assert.equal(toSameOriginPath('https://evil.example/x'), null);
    assert.equal(toSameOriginPath('https://praion.gr.evil.example/x'), null);
    assert.equal(toSameOriginPath('https://notpraion.gr/x'), null);
  });

  test('REFUSES a protocol-relative URL — the browser reads it as another origin', () => {
    assert.equal(toSameOriginPath('//evil.example/x'), null);
  });

  test('refuses a scheme downgrade and a different port', () => {
    assert.equal(toSameOriginPath('http://praion.gr/x'), null);
    assert.equal(toSameOriginPath('https://praion.gr:8443/x'), null);
  });

  test('refuses junk and empty input', () => {
    assert.equal(toSameOriginPath('not a url'), null);
    assert.equal(toSameOriginPath('   '), null);
  });

  test('extracts a media uuid only from our own media route', () => {
    const uuid = '5c1e0a3e-1111-4222-8333-444455556666';
    assert.equal(mediaUuidFromUrl(`https://praion.gr/api/cms/media/file/${uuid}`), uuid);
    assert.equal(mediaUuidFromUrl(`https://evil.example/api/cms/media/file/${uuid}`), null);
    assert.equal(mediaUuidFromUrl('https://praion.gr/api/cms/media/file/not-a-uuid'), null);
    assert.equal(mediaUuidFromUrl('https://praion.gr/somewhere/else'), null);
  });
});

describe('dot paths — prototype pollution', () => {
  test('refuses the three dangerous segments', () => {
    for (const bad of ['__proto__', 'a.__proto__', 'a.__proto__.b', 'constructor', 'a.prototype.b']) {
      assert.equal(isSafePath(bad), false, bad);
      assert.throws(() => setAtPath({}, bad, 'x'), /unsafe path/);
    }
  });

  test('a __proto__ write does not pollute Object.prototype', () => {
    assert.throws(() => setAtPath({}, '__proto__.polluted', 'yes'), /unsafe path/);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test('refuses empty and malformed paths', () => {
    for (const bad of ['', '.', 'a..b', 'a.']) {
      assert.equal(isSafePath(bad), false, JSON.stringify(bad));
    }
  });

  test('writes a top-level value without mutating the source', () => {
    const source = { a: 1 };
    const next = setAtPath(source, 'b', 2);
    assert.deepEqual(next, { a: 1, b: 2 });
    assert.deepEqual(source, { a: 1 }, 'the original is untouched');
  });

  test('writes a nested value, copying rather than mutating the branch', () => {
    const source = { header: { h1: { before: 'a' }, eyebrow: 'k' } };
    const next = setAtPath(source, 'header.h1.before', 'z');
    assert.equal((next.header as { h1: { before: string } }).h1.before, 'z');
    assert.equal(source.header.h1.before, 'a');
    assert.equal((next.header as { eyebrow: string }).eyebrow, 'k', 'siblings survive');
  });

  test('creates intermediate objects that do not exist', () => {
    assert.deepEqual(setAtPath({}, 'seo.ogTitle', 'x'), { seo: { ogTitle: 'x' } });
  });

  test('replaces a non-object on the way through rather than throwing', () => {
    assert.deepEqual(setAtPath({ seo: 'oops' }, 'seo.ogTitle', 'x'), { seo: { ogTitle: 'x' } });
  });

  test('preserves arrays — a repeater row is addressed as gallery.0.alt', () => {
    const source = { gallery: [{ image: 'a', alt: '' }, { image: 'b', alt: 'keep' }] };
    const next = setAtPath(source, 'gallery.0.alt', 'a boat at sunset');
    assert.ok(Array.isArray(next.gallery), 'the gallery is still an array');
    assert.equal((next.gallery as { alt: string }[])[0].alt, 'a boat at sunset');
    assert.equal((next.gallery as { alt: string }[])[1].alt, 'keep', 'siblings survive');
    assert.equal((next.gallery as { image: string }[])[0].image, 'a', 'the row keeps its image');
    assert.equal(source.gallery[0].alt, '', 'the original is untouched');
  });

  test('builds a list when the next segment is numeric', () => {
    const next = setAtPath({}, 'rows.0.value', 'x');
    assert.ok(Array.isArray(next.rows));
  });

  test('reads back what it wrote', () => {
    const next = setAtPath({}, 'a.b.c', 42);
    assert.equal(getAtPath(next, 'a.b.c'), 42);
    assert.equal(getAtPath(next, 'a.b.missing'), undefined);
    assert.equal(getAtPath(next, 'nope.nope'), undefined);
  });

  test('getAtPath refuses an unsafe path too', () => {
    assert.equal(getAtPath({}, '__proto__'), undefined);
  });
});

describe('titles that are groups', () => {
  test('joins the parts of an accent headline in field order', () => {
    assert.equal(
      flattenTitle({ before: 'Why', accent: 'SEO', after: 'matters' }),
      'Why SEO matters',
    );
  });

  test('collapses whitespace and skips empty parts', () => {
    assert.equal(flattenTitle({ before: ' Why  ', accent: '', after: 'now' }), 'Why now');
  });

  test('passes a plain string straight through', () => {
    assert.equal(flattenTitle('A scenario'), 'A scenario');
  });

  test('is null when there is nothing to show', () => {
    assert.equal(flattenTitle({ before: '', accent: '' }), null);
    assert.equal(flattenTitle(''), null);
    assert.equal(flattenTitle(null), null);
    assert.equal(flattenTitle(['a']), null);
  });

  test('recognises a group so the writer can refuse it', () => {
    assert.equal(isGroupTitle({ before: 'a' }), true);
    assert.equal(isGroupTitle('a plain string'), false);
    assert.equal(isGroupTitle(null), false);
    assert.equal(isGroupTitle(['a']), false);
  });
});
