import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ANALYTICS_CATEGORY_KEY } from '@/cms/core/cookies/defaults';
import {
  cookiePolicyVersion,
  toConsentOptions,
  withAnalyticsDeclaration,
  type CategoryWithServices,
} from '@/cms/core/cookies/declaration';
import { resolveGaId } from '@/cms/core/settings/analytics';

/**
 * The cookie declaration is what a visitor is told the site does, and it was
 * derived from the `cookie_categories` table alone. Analytics, meanwhile, is
 * switched on by a setting — so an admin who pasted a GA4 measurement ID got a
 * site that loaded Google Analytics while its own cookie policy declared
 * nothing, and `useCategoryConsent('analytics')` fell through to the blanket
 * consent flag because no `analytics` category existed to refuse.
 *
 * These tests pin the derivation: what the loader will load, the declaration
 * says. The DB round-trip is not tested here — nothing in this suite touches a
 * database, so the synthesis is a pure function over a catalogue.
 */

const NOW = new Date('2026-01-01T00:00:00Z');

function category(
  over: Partial<CategoryWithServices> & Pick<CategoryWithServices, 'id' | 'key'>,
): CategoryWithServices {
  return {
    name: { el: over.key, en: over.key },
    description: null,
    required: false,
    sortOrder: 0,
    createdAt: NOW,
    services: [],
    ...over,
  };
}

function service(over: { id: number; categoryId: number; name: string; enabled?: boolean; provider?: string | null }) {
  return {
    provider: null,
    purpose: null,
    enabled: true,
    createdAt: NOW,
    ...over,
  };
}

const necessary = category({
  id: 1,
  key: 'necessary',
  required: true,
  sortOrder: 0,
  services: [service({ id: 10, categoryId: 1, name: 'Praion' })],
});
const analytics = category({ id: 2, key: ANALYTICS_CATEGORY_KEY, sortOrder: 1 });
const marketing = category({ id: 3, key: 'marketing', sortOrder: 2 });

/** The service the synthesis is expected to add, wherever it lands. */
function gaOf(catalog: CategoryWithServices[]) {
  const cat = catalog.find((c) => c.key === ANALYTICS_CATEGORY_KEY);
  return cat?.services.find((s) => /google analytics/i.test(s.name));
}

describe('withAnalyticsDeclaration', () => {
  test('declares Google Analytics under the analytics category when an ID is set', () => {
    const out = withAnalyticsDeclaration([necessary, analytics, marketing], 'G-ABC1234567');
    const ga = gaOf(out);
    assert.ok(ga, 'expected a Google Analytics service under the analytics category');
    assert.equal(ga.provider, 'Google');
    assert.equal(ga.enabled, true);
    assert.ok(ga.purpose?.el, 'purpose must be written in Greek');
    assert.ok(ga.purpose?.en, 'purpose must be written in English');
  });

  test('an absent ID leaves the stored catalogue exactly as it is', () => {
    const stored = [necessary, analytics, marketing];
    for (const empty of ['', '   ', null, undefined]) {
      assert.deepEqual(withAnalyticsDeclaration(stored, empty), stored);
    }
  });

  test('any non-empty ID is declared, even a malformed one', () => {
    // The loader interpolates whatever is stored; a stricter reader here would
    // re-create the bug being fixed — GA running while the policy denies it.
    assert.ok(gaOf(withAnalyticsDeclaration([analytics], 'not-a-ga-id')));
  });

  test('an admin-declared Google Analytics service is not duplicated', () => {
    const own = category({
      id: 2,
      key: ANALYTICS_CATEGORY_KEY,
      services: [service({ id: 20, categoryId: 2, name: 'Google Analytics', provider: 'Google LLC' })],
    });
    const out = withAnalyticsDeclaration([own], 'G-ABC1234567');
    const cat = out.find((c) => c.key === ANALYTICS_CATEGORY_KEY);
    assert.equal(cat?.services.length, 1);
    assert.equal(cat?.services[0].id, 20, 'the admin row must survive, not be replaced');
  });

  test('a disabled admin-declared Google Analytics row still suppresses the synthetic one', () => {
    // Turning the row off is a deliberate act; re-adding it under another id
    // would silently overrule the admin.
    const own = category({
      id: 2,
      key: ANALYTICS_CATEGORY_KEY,
      services: [service({ id: 20, categoryId: 2, name: 'Google Analytics 4', enabled: false })],
    });
    const cat = withAnalyticsDeclaration([own], 'G-ABC1234567').find((c) => c.key === ANALYTICS_CATEGORY_KEY);
    assert.equal(cat?.services.length, 1);
  });

  test('synthesizes the analytics category when the catalogue has none', () => {
    // Without a category to refuse, `useCategoryConsent('analytics')` falls back
    // to the blanket flag and GA loads for anyone who accepted anything.
    const out = withAnalyticsDeclaration([necessary], 'G-ABC1234567');
    const cat = out.find((c) => c.key === ANALYTICS_CATEGORY_KEY);
    assert.ok(cat, 'expected a synthesized analytics category');
    assert.equal(cat.required, false, 'analytics is never a required category');
    assert.ok(cat.name.el && cat.name.en);
    assert.ok(gaOf(out));
  });

  test('leaves every other category untouched', () => {
    const out = withAnalyticsDeclaration([necessary, analytics, marketing], 'G-ABC1234567');
    assert.deepEqual(out.find((c) => c.key === 'necessary'), necessary);
    assert.deepEqual(out.find((c) => c.key === 'marketing'), marketing);
  });

  test('does not mutate the catalogue it is given', () => {
    const stored = [category({ id: 2, key: ANALYTICS_CATEGORY_KEY })];
    withAnalyticsDeclaration(stored, 'G-ABC1234567');
    assert.equal(stored[0].services.length, 0);
  });
});

describe('cookiePolicyVersion', () => {
  test('changes once Google Analytics is declared', () => {
    // Consent is recorded against a policy version; it has to describe the
    // declaration the visitor was actually shown.
    const off = cookiePolicyVersion(withAnalyticsDeclaration([analytics], ''));
    const on = cookiePolicyVersion(withAnalyticsDeclaration([analytics], 'G-ABC1234567'));
    assert.notEqual(off, on);
  });
});

describe('toConsentOptions', () => {
  test('offers the synthetic service and hides disabled stored ones', () => {
    const withDisabled = category({
      id: 2,
      key: ANALYTICS_CATEGORY_KEY,
      services: [service({ id: 21, categoryId: 2, name: 'Hotjar', enabled: false })],
    });
    const options = toConsentOptions(withAnalyticsDeclaration([withDisabled], 'G-ABC1234567'));
    const cat = options.categories.find((c) => c.key === ANALYTICS_CATEGORY_KEY);
    assert.deepEqual(cat?.services.map((s) => s.name), ['Google Analytics 4']);
    assert.equal(options.policyVersion, cookiePolicyVersion(withAnalyticsDeclaration([withDisabled], 'G-ABC1234567')));
  });
});

describe('resolveGaId', () => {
  const ENV = 'NEXT_PUBLIC_GA_MEASUREMENT_ID';

  function withEnv(value: string | undefined, fn: () => void) {
    const before = process.env[ENV];
    if (value === undefined) delete process.env[ENV];
    else process.env[ENV] = value;
    try {
      fn();
    } finally {
      if (before === undefined) delete process.env[ENV];
      else process.env[ENV] = before;
    }
  }

  test('the setting wins over the build-time env var', () => {
    withEnv('G-FROMENV000', () => assert.equal(resolveGaId('G-SETTING001'), 'G-SETTING001'));
  });

  test('falls back to the env var, matching what AnalyticsLoader loads', () => {
    withEnv('G-FROMENV000', () => {
      assert.equal(resolveGaId(''), 'G-FROMENV000');
      assert.equal(resolveGaId(null), 'G-FROMENV000');
    });
  });

  test('trims, and treats blank or non-string values as unset', () => {
    withEnv(undefined, () => {
      assert.equal(resolveGaId('  G-ABC1234567  '), 'G-ABC1234567');
      assert.equal(resolveGaId('   '), '');
      assert.equal(resolveGaId(undefined), '');
      assert.equal(resolveGaId(42), '');
    });
  });
});
