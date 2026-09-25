import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { localeOrDefault, localePrefix } from '@/cms/core/paths';

/**
 * Which locale is the unprefixed one is the SITE's choice (`defaultLocale` in
 * site.config.ts), not a fact about the core.
 *
 * `localePrefix` used to hardcode Greek, so on a site whose main language is
 * English every emailed order-return and booking-payment link pointed at
 * `/booking/pay/…` for Greek visitors and at nothing sensible for English ones.
 * These pin the rule on both kinds of site.
 */

describe('localePrefix', () => {
  test('the default locale is unprefixed, whichever it is', () => {
    assert.equal(localePrefix('el', 'el'), '');
    assert.equal(localePrefix('en', 'en'), '');
  });

  test('any other locale is prefixed', () => {
    assert.equal(localePrefix('en', 'el'), '/en');
    assert.equal(localePrefix('el', 'en'), '/el');
  });

  test('a missing locale means the default, so it is unprefixed', () => {
    for (const missing of [null, undefined, '']) {
      assert.equal(localePrefix(missing, 'en'), '', JSON.stringify(missing));
    }
  });
});

describe('localeOrDefault', () => {
  test('a given locale is kept', () => {
    assert.equal(localeOrDefault('el', 'en'), 'el');
    assert.equal(localeOrDefault('en', 'el'), 'en');
  });

  test('a missing or blank locale becomes the site default', () => {
    for (const missing of [null, undefined, '', '   ']) {
      assert.equal(localeOrDefault(missing, 'en'), 'en', JSON.stringify(missing));
    }
  });
});
