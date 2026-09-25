/**
 * `PATCH /api/cms/settings` — all or nothing.
 *
 * The route validated and wrote one key at a time, so a save whose fifth key was
 * refused had already stored the first four while the caller was told it failed.
 * Its cache purge ran only after the loop, so those four were also invisible to
 * every cached reader until the next deploy. Driven through the save's own logic
 * with an in-memory store, since the point is what reaches the store and when.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import type { CmsConfig } from '@/cms/config';
import { applySettingsUpdate } from '@/cms/core/routes/settings';

const config = {
  modules: { commerce: false },
  locales: ['el', 'en'],
  defaultLocale: 'el',
} as unknown as CmsConfig;

function memoryStore(initial: Record<string, unknown> = {}) {
  const rows = new Map<string, unknown>(Object.entries(initial));
  const writes: string[] = [];
  return {
    rows,
    writes,
    deps: {
      read: async <T,>(key: string) => (rows.has(key) ? (rows.get(key) as T) : null),
      write: async (key: string, value: unknown) => {
        writes.push(key);
        rows.set(key, value);
      },
    },
  };
}

describe('applySettingsUpdate', () => {
  test('a refused key writes nothing — not even the valid keys before it', async () => {
    const store = memoryStore();
    await assert.rejects(
      applySettingsUpdate(
        config,
        { 'site.supportEmail': 'team@example.com', 'module.commerce': 'false' },
        1,
        store.deps,
      ),
    );
    assert.deepEqual(store.writes, []);
  });

  test('a save that passes writes every managed key it sent, and reports them', async () => {
    const store = memoryStore();
    const changed = await applySettingsUpdate(
      config,
      { 'site.supportEmail': 'team@example.com', 'module.commerce': true, 'not.managed': 'x' },
      1,
      store.deps,
    );
    assert.deepEqual(changed, ['site.supportEmail', 'module.commerce']);
    assert.deepEqual(store.writes, changed);
    assert.equal(store.rows.get('module.commerce'), true);
  });
});

describe('setSetting purges its own cache', () => {
  // Cached reads never expire by the clock, so a writer that forgot to purge
  // (the Google OAuth state did) left readers stale until the next deploy. The
  // purge belongs to the one function every writer goes through.
  test('the upsert is followed by the per-key invalidation', () => {
    const src = readFileSync('src/cms/core/settings/index.ts', 'utf8');
    const body = src.slice(src.indexOf('export async function setSetting'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    assert.match(fn, /onDuplicateKeyUpdate[\s\S]*invalidateSetting\(key\)/);
  });

  test('the OAuth callback reads its one-use state uncached', () => {
    const src = readFileSync('src/cms/modules/reviews-external/routes.ts', 'utf8');
    assert.match(src, /getSettingUncached<[^>]*>\(OAUTH_STATE_KEY\)/);
  });
});
