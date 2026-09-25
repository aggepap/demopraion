/**
 * The commerce headers still described checkout as future work and the order
 * tables as "dormant" long after both shipped, which is the first thing a
 * reader of the module sees.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

for (const path of [
  'src/cms/modules/commerce/index.ts',
  'src/cms/modules/commerce/collection.ts',
  'src/cms/modules/commerce/quote.ts',
  'src/cms/db/adapters/mysql/schema/commerce.ts',
]) {
  test(`${path} does not call checkout future work or the tables dormant`, () => {
    const text = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /dormant/i);
    assert.doesNotMatch(text, /checkout is (future work|not built)/i);
    assert.doesNotMatch(text, /future checkout/i);
  });
}
