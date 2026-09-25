/**
 * Saving a meta override from Admin → SEO must not wipe what it does not show.
 *
 * The form edits title, description, robots, canonical and the social image; the
 * PM bridge writes the Open Graph title and description onto the same row. The
 * save route used `upsertMeta`, a whole-row write that nulls every column it was
 * not given — so any admin save of a path cleared PM's og:title/og:description.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { metaPatchColumns } from '@/cms/core/seo/service';

describe('metaPatchColumns', () => {
  test('only the fields sent are written; an explicit null still clears', () => {
    assert.deepEqual(
      metaPatchColumns({ path: '/a', locale: 'el', title: 'T', description: null, ogImage: undefined }),
      { title: 'T', description: null },
    );
  });

  test('the admin save route merges instead of replacing the row', () => {
    const src = readFileSync('src/cms/core/routes/seo.ts', 'utf8');
    const route = src.slice(src.indexOf('export function metaUpsertRoute'));
    const body = route.slice(0, route.indexOf('\n}\n'));
    assert.match(body, /await patchMeta\(input, auth\.userId\)/);
  });
});
