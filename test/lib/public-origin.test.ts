import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isAllowedPublicOrigin } from '@/lib/public-origin';

/**
 * The same-origin belt on the public form endpoints (`/api/contact`).
 *
 * It used to compare against the literal `praion.gr` pair, which meant any other
 * site built from this code refused every enquiry in production with a 403 — a
 * contact form that silently never works. The allowed origins now come from the
 * site's own URL.
 */

const SITE = 'https://acme.test';

describe('isAllowedPublicOrigin', () => {
  test('outside production every origin passes, so local dev keeps working', () => {
    assert.equal(isAllowedPublicOrigin('http://localhost:3002', SITE, false), true);
  });

  test('a request without an Origin header passes (non-browser client)', () => {
    assert.equal(isAllowedPublicOrigin(null, SITE, true), true);
  });

  test('the site’s own origin passes', () => {
    assert.equal(isAllowedPublicOrigin('https://acme.test', SITE, true), true);
  });

  test('the www twin of the site passes', () => {
    assert.equal(isAllowedPublicOrigin('https://www.acme.test', SITE, true), true);
  });

  test('the apex twin passes when the site itself is the www host', () => {
    assert.equal(isAllowedPublicOrigin('https://acme.test', 'https://www.acme.test', true), true);
  });

  test('a trailing slash on the site URL changes nothing', () => {
    assert.equal(isAllowedPublicOrigin('https://acme.test', 'https://acme.test/', true), true);
  });

  test('another site is refused', () => {
    assert.equal(isAllowedPublicOrigin('https://praion.gr', SITE, true), false);
  });

  test('a lookalike host is refused', () => {
    assert.equal(isAllowedPublicOrigin('https://acme.test.evil.example', SITE, true), false);
  });

  test('http is not the same origin as https', () => {
    assert.equal(isAllowedPublicOrigin('http://acme.test', SITE, true), false);
  });

  test('a malformed Origin is refused', () => {
    assert.equal(isAllowedPublicOrigin('not a url', SITE, true), false);
  });
});
