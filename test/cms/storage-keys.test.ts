import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { defineConfig } from '@/cms/config/config';
import { alwaysPresent } from '@/cms/core/cookies/registry';
import { detectServices } from '@/cms/core/cookies/scan';
import { storageKeys } from '@/cms/core/cookies/storage-keys';
import { STORAGE_KEYS, STORAGE_PREFIX } from '@/lib/storage-keys';
import config from '@/site.config';

/**
 * What a site writes into a visitor's browser is named after the site.
 *
 * The keys used to be `praion-*` literals in two places at once — the core's
 * cookie registry, which publishes them on `/legal/cookies`, and the components
 * that actually write them — so every site built from this core would have told
 * its visitors it stores Praion's keys. The prefix is now one config value, and
 * both sides derive their names from it.
 */

const minimal = (extra: Partial<Parameters<typeof defineConfig>[0]> = {}) =>
  defineConfig({ locales: ['en'], defaultLocale: 'en', collections: [{ key: 'page', fields: [] }], ...extra });

describe('storageKeys', () => {
  test('names every browser key after the prefix', () => {
    assert.deepEqual(storageKeys('acme'), {
      cookieConsent: 'acme-cookie-consent',
      cookieCategories: 'acme-cookie-categories',
      visitorRef: 'acme-visitor-ref',
      consentEvent: 'acme-consent-changed',
      cart: 'acme-cart',
      compare: 'acme-compare',
      wishlist: 'acme-wishlist',
      recentlyViewed: 'acme-recently-viewed',
      popupSeen: 'acme-popup-seen',
    });
  });
});

describe('defineConfig storagePrefix', () => {
  test('defaults to a neutral prefix rather than another site’s name', () => {
    assert.equal(minimal().storagePrefix, 'site');
  });

  test('keeps an explicit prefix', () => {
    assert.equal(minimal({ storagePrefix: 'acme-shop' }).storagePrefix, 'acme-shop');
  });

  for (const bad of ['', 'Acme', 'acme shop', '-acme', 'acme_']) {
    test(`refuses the prefix ${JSON.stringify(bad)}`, () => {
      assert.throws(() => minimal({ storagePrefix: bad }), /storagePrefix/);
    });
  }
});

describe('the cookie declaration follows the prefix', () => {
  test('reports the site’s own storage keys and nobody else’s', () => {
    const keys = detectServices({ gaId: '', storagePrefix: 'acme' })
      .flatMap((s) => s.keys)
      .filter((k) => k.kind === 'storage')
      .map((k) => k.name);
    assert.ok(keys.length > 0);
    for (const name of keys) assert.ok(name.startsWith('acme-'), name);
    assert.ok(!keys.some((name) => name.includes('praion')), 'no key may carry another site’s name');
  });
});

describe('this site: registry and components agree', () => {
  test('the config and the components use one prefix', () => {
    assert.equal(STORAGE_PREFIX, config.storagePrefix);
  });

  test('the keys the components write are the keys the registry declares', () => {
    assert.deepEqual(STORAGE_KEYS, storageKeys(config.storagePrefix));
    const written = new Set(Object.values(STORAGE_KEYS));
    const declared = detectServices({ gaId: '', storagePrefix: config.storagePrefix })
      .flatMap((s) => s.keys)
      .filter((k) => k.kind === 'storage')
      .map((k) => k.name);
    for (const name of declared) assert.ok(written.has(name), `${name} is declared but nothing writes it`);
  });
});

describe('popup seen key', () => {
  // The runtime rebuilt the prefix by splitting the cart key on '-', so a
  // prefix with a dash in it (`acme-shop`) wrote `acme-popup-seen` — a key the
  // cookie declaration, which did not list it at all, could never match.
  test('keeps a dashed prefix whole', () => {
    assert.equal(storageKeys('acme-shop').popupSeen, 'acme-shop-popup-seen');
  });

  test('the runtime uses the shared name instead of re-deriving it', () => {
    const src = readFileSync('src/components/popups/PopupRuntime.tsx', 'utf8');
    assert.match(src, /STORAGE_KEYS\.popupSeen/);
    assert.doesNotMatch(src, /split\('-'\)/);
  });

  test('is declared in the cookie registry', () => {
    const names = alwaysPresent('acme-shop').flatMap((s) => s.keys.map((k) => k.name));
    assert.ok(names.includes('acme-shop-popup-seen'));
  });
});
