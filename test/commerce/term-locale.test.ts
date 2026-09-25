/**
 * `/shop/category/[slug]` and `/shop/tag/[slug]` looked the term up by slug with
 * `LIMIT 1` and no locale, so on a multilingual site they could pick another
 * locale's row. Products relate to their own locale's term row, so the join
 * found nothing (an empty category), and the title and the admin-bar edit link
 * were the other language's.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { pickTermRow } from '@/cms/modules/commerce/read';

describe('pickTermRow', () => {
  const row = (id: number, locale: string) => ({ id, locale });

  test('takes the row in the page locale', () => {
    assert.equal(pickTermRow([row(1, 'en'), row(2, 'el')], 'el')?.id, 2);
    assert.equal(pickTermRow([row(2, 'el'), row(1, 'en')], 'en')?.id, 1);
  });

  test('falls back to another locale only when the term has no row in this one', () => {
    assert.equal(pickTermRow([row(1, 'en')], 'el')?.id, 1);
    assert.equal(pickTermRow([], 'el'), undefined);
  });
});

test('both readers pick the term by locale and join on every row of the term', () => {
  const read = readFileSync(new URL('../../src/cms/modules/commerce/read.ts', import.meta.url), 'utf8');
  for (const name of ['readProductsByCategory', 'readProductsByTag']) {
    const start = read.indexOf(`async function ${name}(`);
    const body = read.slice(start, read.indexOf('\n}\n', start));
    assert.match(body, /pickTermRow\(/, name);
    assert.doesNotMatch(body, /\.limit\(1\)/, name);
    assert.match(body, /inArray\(schema\.documentRelations\.toId, /, name);
  }
});
