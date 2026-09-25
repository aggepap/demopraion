/**
 * How a public contact-form POST becomes a `form_submissions` row: the page
 * slug derived from a browser-controlled header, capped to its column.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { locales } from '@/lib/i18n/config';
import { contactSubmissionRecord, pageSlugFromReferer } from '@/lib/contact-submission';

const headers = (init: Record<string, string> = {}) => new Headers(init);

/** A locale this site serves, used as a URL prefix (any served locale is stripped). */
const L = locales[locales.length - 1];

describe('pageSlugFromReferer', () => {
  test('strips a locale prefix so a slug is one value across locales', () => {
    assert.equal(pageSlugFromReferer(`https://example.com/${L}/about`), '/about');
  });

  test('leaves an unprefixed path alone', () => {
    assert.equal(pageSlugFromReferer('https://example.com/contact'), '/contact');
  });

  test('only strips a whole segment, never a prefix of one', () => {
    assert.equal(pageSlugFromReferer(`https://example.com/${L}ergy`), `/${L}ergy`);
  });

  test('a segment that is not a served locale is an ordinary path', () => {
    assert.equal(pageSlugFromReferer('https://example.com/xx/about'), '/xx/about');
  });

  test('reduces a bare locale root to the home path', () => {
    assert.equal(pageSlugFromReferer(`https://example.com/${L}`), '/');
    assert.equal(pageSlugFromReferer('https://example.com/'), '/');
  });

  test('drops the query string and the hash', () => {
    assert.equal(pageSlugFromReferer(`https://example.com/${L}/about?utm_source=x#form`), '/about');
  });

  test('is null when there is no usable referrer', () => {
    assert.equal(pageSlugFromReferer(null), null);
    assert.equal(pageSlugFromReferer(''), null);
    assert.equal(pageSlugFromReferer('not a url'), null);
  });

  test('truncates to the width of its column', () => {
    assert.equal(pageSlugFromReferer(`https://example.com/${'a'.repeat(400)}`)?.length, 191);
  });
});

describe('contactSubmissionRecord', () => {
  test('stores the form kind, page, locale and client details', () => {
    const rec = contactSubmissionRecord({
      kind: 'contact',
      email: 'a@b.co',
      locale: L,
      payload: { Name: 'Someone' },
      headers: headers({ referer: `https://example.com/${L}/contact`, 'user-agent': 'Mozilla/5.0' }),
    });
    assert.equal(rec.formType, 'contact');
    assert.equal(rec.email, 'a@b.co');
    assert.equal(rec.sourcePageSlug, '/contact');
    assert.equal(rec.sourceLocale, L);
    assert.deepEqual(rec.payload, { Name: 'Someone' });
    assert.equal(rec.referrerUrl, `https://example.com/${L}/contact`);
    assert.equal(rec.ua, 'Mozilla/5.0');
  });

  test('nulls what the request did not carry rather than guessing', () => {
    const rec = contactSubmissionRecord({ kind: 'contact', email: 'a@b.co', payload: {}, headers: headers() });
    assert.equal(rec.sourcePageSlug, null);
    assert.equal(rec.sourceLocale, null);
    assert.equal(rec.ua, null);
  });
});
