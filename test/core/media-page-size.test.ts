/**
 * The media list's page size, as served and as reported.
 *
 * With no `limit`, `listMedia` served 200 rows while the route's envelope said
 * `pageSize: 500` — so the page number it computed for any offset, and any
 * "is there more?" arithmetic built on it, were wrong. One function decides now.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { MEDIA_PAGE_DEFAULT, MEDIA_PAGE_MAX, mediaPageLimit } from '@/cms/core/media/service';

describe('mediaPageLimit', () => {
  test('unasked is the default page, not the maximum', () => {
    assert.equal(mediaPageLimit(undefined), MEDIA_PAGE_DEFAULT);
  });

  test('clamps to 1..MEDIA_PAGE_MAX', () => {
    assert.equal(mediaPageLimit(0), 1);
    assert.equal(mediaPageLimit(10_000), MEDIA_PAGE_MAX);
    assert.equal(mediaPageLimit(25.7), 25);
  });

  test('the route reports the size listMedia serves', () => {
    const src = readFileSync('src/cms/core/routes/media.ts', 'utf8');
    assert.match(src, /const limit = mediaPageLimit\(query\?\.limit\)/);
  });
});
