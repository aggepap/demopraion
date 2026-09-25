import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defineConfig } from '@/cms/config/config';
import { isProductionHost } from '@/cms/core/paths';

/**
 * "Is this deploy the real site?" — asked by robots.txt (noindex everything
 * else) and by the Product Manager ping (`production_host`).
 *
 * It cannot be answered from `NEXT_PUBLIC_SITE_URL` alone, because staging sets
 * that too; it has to be compared against the one origin that IS production.
 * That origin used to be the literal `https://praion.gr` in both places, so a
 * second site built from this core could never be told it was live.
 */

const minimal = (extra: Partial<Parameters<typeof defineConfig>[0]> = {}) =>
  defineConfig({ locales: ['en'], defaultLocale: 'en', collections: [{ key: 'page', fields: [] }], ...extra });

describe('isProductionHost', () => {
  test('matches the configured production origin', () => {
    assert.equal(isProductionHost('https://acme.test', 'https://acme.test'), true);
  });

  test('ignores a trailing slash on the deploy origin', () => {
    assert.equal(isProductionHost('https://acme.test/', 'https://acme.test'), true);
  });

  test('a staging deploy is not production', () => {
    assert.equal(isProductionHost('https://staging.acme.test', 'https://acme.test'), false);
  });

  test('nothing is production when no production origin is configured', () => {
    assert.equal(isProductionHost('https://acme.test', null), false);
  });

  test('an unset deploy origin is not production', () => {
    assert.equal(isProductionHost('', 'https://acme.test'), false);
  });
});

describe('defineConfig productionOrigin', () => {
  test('is null unless a site declares it', () => {
    assert.equal(minimal().productionOrigin, null);
  });

  test('is stored without a trailing slash', () => {
    assert.equal(minimal({ productionOrigin: 'https://acme.test/' }).productionOrigin, 'https://acme.test');
  });

  for (const bad of ['acme.test', 'ftp://acme.test', 'https://acme.test/shop', 'not a url']) {
    test(`refuses ${JSON.stringify(bad)}, which is not a bare http(s) origin`, () => {
      assert.throws(() => minimal({ productionOrigin: bad }), /productionOrigin/);
    });
  }
});
