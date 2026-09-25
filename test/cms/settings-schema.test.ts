import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BRAND_IDENTITY_KEY, BRAND_PALETTE_KEY } from '@/cms/core/brand/policy';
import {
  CUSTOM_FIELDS_KEY,
  ECOMMERCE_COUPONS_KEY,
  ECOMMERCE_CURRENCY_KEY,
  ECOMMERCE_SHIPPING_KEY,
  ECOMMERCE_WISHLIST_KEY,
  ECOMMERCE_GIFTCARDS_KEY,
  EXTRA_MANAGED_KEYS,
  GOOGLE_REVIEWS_KEY,
  formatMultiValue,
  MANAGED_SETTING_KEYS,
  MANAGED_SETTINGS,
  parseMultiValue,
  moduleSettingKey,
  resolveLocaleSet,
  SEO_FIELDS_KEY,
} from '@/cms/core/settings/schema';
import { checkStructuredSetting } from '@/cms/core/settings/structured';
import { SCHEMA_POLICY_KEY } from '@/cms/core/structured-data/policy';

describe('resolveLocaleSet', () => {
  test('undefined (unset) means all of pool, in pool order', () => {
    assert.deepEqual(resolveLocaleSet(undefined, ['en', 'el', 'fr'], 'en'), ['en', 'el', 'fr']);
  });

  test('narrows the selection but always includes `must` and keeps pool order', () => {
    assert.deepEqual(resolveLocaleSet(['fr'], ['en', 'el', 'fr'], 'en'), ['en', 'fr']);
    assert.deepEqual(resolveLocaleSet(['el', 'en'], ['en', 'el'], 'en'), ['en', 'el']);
  });

  test('empty selection collapses to just `must`', () => {
    assert.deepEqual(resolveLocaleSet([], ['en', 'el'], 'en'), ['en']);
  });

  test('ignores selections outside the pool', () => {
    assert.deepEqual(resolveLocaleSet(['xx'], ['en', 'el'], 'en'), ['en']);
  });
});

describe('settings keys', () => {
  test('moduleSettingKey', () => {
    assert.equal(moduleSettingKey('commerce'), 'module.commerce');
  });

  test('managed key allowlists', () => {
    // The site name moved into `brand.identity` (Settings → Branding); a second,
    // unread "Site name" field on the General tab would only mislead.
    assert.ok(!MANAGED_SETTING_KEYS.includes('site.name'));
    assert.ok(MANAGED_SETTING_KEYS.includes('site.supportEmail'));
    assert.ok(MANAGED_SETTING_KEYS.includes(ECOMMERCE_CURRENCY_KEY));
    assert.deepEqual(EXTRA_MANAGED_KEYS, [
      BRAND_IDENTITY_KEY,
      BRAND_PALETTE_KEY,
      SCHEMA_POLICY_KEY,
      GOOGLE_REVIEWS_KEY,
      ECOMMERCE_SHIPPING_KEY,
      ECOMMERCE_COUPONS_KEY,
      ECOMMERCE_WISHLIST_KEY,
      ECOMMERCE_GIFTCARDS_KEY,
      CUSTOM_FIELDS_KEY,
      SEO_FIELDS_KEY,
    ]);
  });

  test('the structured keys are validated at the write boundary', () => {
    // A key on the allowlist with no `checkStructuredSetting` branch is stored
    // as whatever JSON arrives — the failure mode this file's header describes.
    for (const key of [
      SCHEMA_POLICY_KEY,
      GOOGLE_REVIEWS_KEY,
      ECOMMERCE_SHIPPING_KEY,
      ECOMMERCE_COUPONS_KEY,
      ECOMMERCE_WISHLIST_KEY,
      ECOMMERCE_GIFTCARDS_KEY,
      CUSTOM_FIELDS_KEY,
      SEO_FIELDS_KEY,
    ]) {
      assert.notEqual(checkStructuredSetting(key, {}), undefined, key);
    }
  });

  test('the SEO field overrides are stored as the sanitiser leaves them', () => {
    const checked = checkStructuredSetting(SEO_FIELDS_KEY, {
      disabled: ['prosCons', 'notAField'],
      tab: { faqs: 'nope' },
    });
    assert.ok(checked?.ok);
    // Unknown keys and invalid tabs are dropped rather than stored, so a reader
    // never has to defend against them.
    assert.deepEqual((checked.value as { disabled: string[] }).disabled, ['prosCons']);
    assert.deepEqual((checked.value as { tab: Record<string, string> }).tab, {});
  });

  test('a non-object SEO override value is refused, not coerced', () => {
    for (const bad of [null, 'nope', 42, []]) {
      const checked = checkStructuredSetting(SEO_FIELDS_KEY, bad);
      assert.equal(checked?.ok, false, JSON.stringify(bad));
    }
  });
});

describe('multiselect settings', () => {
  test('parseMultiValue tolerates whatever is in the column', () => {
    // Every reader splits on commas; none of them should have to think about
    // spacing, empties or a value that was stored as an array by an older path.
    assert.deepEqual(parseMultiValue('transport,stay'), ['transport', 'stay']);
    assert.deepEqual(parseMultiValue(' transport , stay '), ['transport', 'stay']);
    assert.deepEqual(parseMultiValue('transport,,'), ['transport']);
    assert.deepEqual(parseMultiValue(''), []);
    assert.deepEqual(parseMultiValue(null), []);
    assert.deepEqual(parseMultiValue(['transport', 'stay']), ['transport', 'stay']);
  });

  test('formatMultiValue dedupes and drops blanks', () => {
    assert.equal(formatMultiValue(['transport', 'transport', '', 'stay']), 'transport,stay');
    assert.equal(formatMultiValue([]), '');
  });

  test('the two round-trip', () => {
    assert.deepEqual(parseMultiValue(formatMultiValue(['stay'])), ['stay']);
  });

  test('every multiselect declares its options and a default', () => {
    // An unset multiselect renders as no boxes ticked, which reads as "none"
    // when it means "not asked yet" — so a default is not optional.
    for (const f of MANAGED_SETTINGS.filter((d) => d.type === 'multiselect')) {
      assert.ok(f.options?.length, `${f.key} has no options`);
      assert.ok(f.defaultValue, `${f.key} has no defaultValue`);
      const allowed = new Set(f.options!.map((o) => o.value));
      for (const v of parseMultiValue(f.defaultValue)) {
        assert.ok(allowed.has(v), `${f.key} defaults to "${v}", which is not one of its options`);
      }
    }
  });
});
