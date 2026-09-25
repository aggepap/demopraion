import assert from 'node:assert/strict';
import { test } from 'node:test';

import { productCollection } from '@/cms/modules/commerce/collection';

/** An unpublished product sends its visitors to its category page, else the shop. */

test('products redirect to their category when unpublished, falling back to the shop', () => {
  assert.deepEqual(productCollection().unpublishRedirect, { taxonomyField: 'categories', fallbackPath: '/shop' });
});

test('a custom product path moves the fallback with it', () => {
  assert.equal(productCollection({ pathTemplate: '/store/{slug}' }).unpublishRedirect?.fallbackPath, '/store');
});

test('a path that does not end in /{slug} has no listing to fall back to, so no redirect', () => {
  assert.equal(productCollection({ pathTemplate: '/p-{slug}' }).unpublishRedirect, undefined);
});
