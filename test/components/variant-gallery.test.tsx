import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveActiveGallery } from '@/components/shop/variant-gallery';

type Img = { url: string };

const base: Img[] = [{ url: 'base-1' }, { url: 'base-2' }];

const attributes = [
  {
    id: 'color',
    values: [
      { id: 'blue', gallery: [{ url: 'blue-1' }, { url: 'blue-2' }] as Img[] },
      { id: 'red', gallery: [] as Img[] }, // empty gallery → treated as none
    ],
  },
  {
    id: 'size',
    values: [{ id: 's' }, { id: 'm' }],
  },
];

describe('resolveActiveGallery', () => {
  test('returns the selected value gallery when it has one', () => {
    assert.deepEqual(resolveActiveGallery(attributes, { color: 'blue', size: 'm' }, base), [
      { url: 'blue-1' },
      { url: 'blue-2' },
    ]);
  });

  test('falls back to the base gallery (by identity) when the selected value has none', () => {
    assert.equal(resolveActiveGallery(attributes, { color: 'red', size: 's' }, base), base);
    assert.equal(resolveActiveGallery(attributes, {}, base), base);
  });

  test('first attribute with a gallery for its selected value wins', () => {
    const attrs = [
      { id: 'size', values: [{ id: 's', gallery: [{ url: 'size-s' }] as Img[] }] },
      { id: 'color', values: [{ id: 'blue', gallery: [{ url: 'blue-1' }] as Img[] }] },
    ];
    assert.deepEqual(resolveActiveGallery(attrs, { size: 's', color: 'blue' }, base), [{ url: 'size-s' }]);
  });
});
