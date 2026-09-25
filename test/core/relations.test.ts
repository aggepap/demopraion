import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveCollection } from '@/cms/config/collection';
import { f } from '@/cms/config/fields';
import { extractRelationLinks } from '@/cms/core/documents/relations';

const collection = resolveCollection({
  key: 'article',
  fields: [f.relation('cat', { to: 'category' }), f.relation('tags', { to: 'topic', many: true }), f.text('title')],
});

describe('extractRelationLinks', () => {
  test('derives single + many relation links with positions', () => {
    assert.deepEqual(extractRelationLinks(collection, { cat: 5, tags: [2, 3], title: 'x' }), [
      { fieldKey: 'cat', toId: 5, position: 0 },
      { fieldKey: 'tags', toId: 2, position: 0 },
      { fieldKey: 'tags', toId: 3, position: 1 },
    ]);
  });

  test('ignores absent, null and non-integer values', () => {
    assert.deepEqual(extractRelationLinks(collection, {}), []);
    assert.deepEqual(extractRelationLinks(collection, { cat: null, tags: [1, 2.5, null] }), [
      { fieldKey: 'tags', toId: 1, position: 0 },
    ]);
    assert.deepEqual(extractRelationLinks(collection, { cat: 'not-a-number' }), []);
  });
});
