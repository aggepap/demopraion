import assert from 'node:assert/strict';
import { test } from 'node:test';

import { slugAfterSave } from '@/cms/admin/document-save';

/**
 * The server normalises a new slug on create and PATCH ("My Post" → `my-post`);
 * the form kept showing — and propagating to the other languages — what was
 * typed until a reload.
 */
test('the form adopts the slug the server stored', () => {
  assert.equal(slugAfterSave('My Post', { slug: 'my-post' }), 'my-post');
  assert.equal(slugAfterSave('my-post', { slug: 'my-post' }), 'my-post');
});

test('an unexpected response never blanks the field', () => {
  assert.equal(slugAfterSave('my-post', undefined), 'my-post');
  assert.equal(slugAfterSave('my-post', {}), 'my-post');
  assert.equal(slugAfterSave('my-post', { slug: '' }), 'my-post');
  assert.equal(slugAfterSave('my-post', { slug: 42 }), 'my-post');
});
