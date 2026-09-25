import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NextRequest } from 'next/server';

process.env.ADMIN_SESSION_SECRET = 'test-session-secret-at-least-32-chars-long';

import { ANALYTICS_CATEGORY_KEY } from '@/cms/core/cookies/defaults';
import type { CategoryWithServices } from '@/cms/core/cookies/declaration';
import { withAnalyticsDeclaration } from '@/cms/core/cookies/declaration';
import { compareToDeclaration, detectServices } from '@/cms/core/cookies/scan';

/**
 * What the site actually stores in a visitor's browser, against what it tells
 * them it stores.
 *
 * The catalogue is typed by hand, so the two drift the moment anybody forgets —
 * and a cookie policy that is merely out of date is the one thing this table is
 * not allowed to be. The scanner does not guess: it reports the storage this
 * codebase is known to write, plus what a configured integration necessarily
 * brings with it, and says which of it has been declared.
 */

const NOW = new Date('2026-01-01T00:00:00Z');

function declared(name: string, opts: { enabled?: boolean; key?: string } = {}): CategoryWithServices {
  return {
    id: 1,
    key: opts.key ?? ANALYTICS_CATEGORY_KEY,
    name: { el: 'x', en: 'x' },
    description: null,
    required: false,
    sortOrder: 0,
    createdAt: NOW,
    services: [
      {
        id: 10,
        categoryId: 1,
        name,
        provider: null,
        purpose: null,
        enabled: opts.enabled ?? true,
        createdAt: NOW,
      },
    ],
  };
}

const find = <T extends { name: string }>(list: T[], name: string): T | undefined =>
  list.find((s) => s.name === name);

describe('detectServices', () => {
  test('reports no Google service when no measurement ID is configured', () => {
    const detected = detectServices({ storagePrefix: 'acme', gaId: '' });
    assert.equal(find(detected, 'Google Analytics 4'), undefined);
    assert.ok(detected.length > 0, 'the first-party services are always present');
  });

  test('a measurement ID brings _ga and the per-container key', () => {
    const ga = find(detectServices({ storagePrefix: 'acme', gaId: 'G-ABC1234567' }), 'Google Analytics 4');
    assert.ok(ga);
    assert.deepEqual(
      ga.keys.map((k) => k.name).sort(),
      ['_ga', '_ga_ABC1234567'],
    );
    assert.equal(ga.categoryKey, ANALYTICS_CATEGORY_KEY);
    assert.equal(ga.provider, 'Google');
  });

  test('a malformed ID still reports _ga but invents no container key', () => {
    // The loader injects whatever is stored, so the cookie is set either way —
    // but a container name that was never issued must not appear in a policy.
    const ga = find(detectServices({ storagePrefix: 'acme', gaId: 'not-a-ga-id' }), 'Google Analytics 4');
    assert.ok(ga);
    assert.deepEqual(ga.keys.map((k) => k.name), ['_ga']);
  });

  test('every key says whether it is a cookie or browser storage', () => {
    // Three of the consent keys are localStorage. A scanner that only looked at
    // cookies would under-report the site's own consent mechanism.
    const all = detectServices({ storagePrefix: 'acme', gaId: 'G-ABC1234567' }).flatMap((s) => s.keys);
    assert.ok(all.length > 0);
    for (const k of all) {
      assert.ok(k.kind === 'cookie' || k.kind === 'storage', `${k.name}: ${k.kind}`);
    }
    assert.ok(all.some((k) => k.kind === 'storage'), 'localStorage keys must be reported');
    assert.ok(all.some((k) => k.name === 'NEXT_LOCALE' && k.kind === 'cookie'));
  });

  test('staff-only storage is flagged so it is not mixed with what visitors get', () => {
    const admin = detectServices({ storagePrefix: 'acme', gaId: '' }).filter((s) => s.audience === 'admin');
    const keys = admin.flatMap((s) => s.keys.map((k) => k.name)).sort();
    assert.deepEqual(keys, ['cms_mfa', 'cms_session']);
  });

  test('every detected service carries the copy needed to declare it', () => {
    for (const s of detectServices({ storagePrefix: 'acme', gaId: 'G-ABC1234567' })) {
      assert.ok(s.name.trim(), 'name');
      assert.ok(s.purpose.el?.trim() && s.purpose.en?.trim(), `${s.name} purpose`);
      assert.ok(s.categoryKey.trim(), `${s.name} category`);
    }
  });
});

describe('compareToDeclaration', () => {
  const detected = detectServices({ storagePrefix: 'acme', gaId: 'G-ABC1234567' });

  test('an empty catalogue leaves everything undeclared and crashes nothing', () => {
    const out = compareToDeclaration(detected, []);
    assert.equal(out.matched.length, 0);
    assert.equal(out.unknownToScanner.length, 0);
    assert.equal(out.undeclared.length, detected.length);
  });

  test('a declared service is matched by name', () => {
    const out = compareToDeclaration(detected, [declared('Google Analytics 4')]);
    assert.ok(find(out.matched, 'Google Analytics 4'));
    assert.equal(find(out.undeclared, 'Google Analytics 4'), undefined);
  });

  test('matching ignores case and stray whitespace', () => {
    const out = compareToDeclaration(detected, [declared('  google   analytics 4 ')]);
    assert.ok(find(out.matched, 'Google Analytics 4'));
  });

  test('a disabled declaration still counts as declared', () => {
    // Switching a row off is a deliberate act; the scanner must not nag to
    // re-add something an admin turned off on purpose.
    const out = compareToDeclaration(detected, [declared('Google Analytics 4', { enabled: false })]);
    assert.ok(find(out.matched, 'Google Analytics 4'));
  });

  test('the automatic GA declaration counts as declared, and says so', () => {
    // `/legal/cookies` already shows it. Reporting it as missing would ask the
    // admin to duplicate a row the site is publishing anyway.
    const effective = withAnalyticsDeclaration([], 'G-ABC1234567');
    const out = compareToDeclaration(detected, effective);
    const ga = find(out.matched, 'Google Analytics 4');
    assert.ok(ga);
    assert.equal(ga.declaredBy, 'automatic');
  });

  test('a stored declaration is labelled stored, not automatic', () => {
    const out = compareToDeclaration(detected, [declared('Google Analytics 4')]);
    assert.equal(find(out.matched, 'Google Analytics 4')?.declaredBy, 'stored');
  });

  test('a declared service the scanner does not know is reported, not treated as an error', () => {
    const out = compareToDeclaration(detected, [declared('Hotjar')]);
    assert.deepEqual(out.unknownToScanner.map((s) => s.name), ['Hotjar']);
  });

  test('every detected service lands in exactly one bucket', () => {
    const out = compareToDeclaration(detected, [declared('Google Analytics 4')]);
    assert.equal(out.matched.length + out.undeclared.length, detected.length);
  });
});

/**
 * The endpoint itself. The scan names `cms_session` and `cms_mfa` and reports
 * how the site is configured, which is admin-facing detail — it must sit behind
 * the same permission as the catalogue it reports on, not merely be hard to
 * guess.
 */
describe('GET /api/cms/cookies/scan', () => {
  test('returns no scan data without an admin session', async () => {
    /*
     * The property, not the status code. In a request scope the guard reads the
     * session cookie and answers 401; this runner has no such scope, so
     * `next/headers` throws first and `createRoute` maps it to 500. Either way
     * the thing that matters is the same and is what is asserted: an
     * unauthenticated caller gets no payload. Pinning 500 here would pin the
     * harness rather than the behaviour.
     */
    const { cookieScanRoute } = await import('@/cms/core/routes/cookies');
    const { defineConfig } = await import('@/cms/config/config');
    const config = defineConfig({ locales: ['en'], defaultLocale: 'en', collections: [{ key: 'page', fields: [] }] });
    const res = await cookieScanRoute(config)(
      new NextRequest('http://localhost/api/cms/cookies/scan', { method: 'GET' }),
      { params: Promise.resolve({}) },
    );
    assert.notEqual(res.status, 200);

    const body = (await res.json()) as { ok?: boolean; data?: unknown };
    assert.notEqual(body.ok, true);
    assert.equal(body.data, undefined, 'no scan payload may leave without authorization');
  });
});
