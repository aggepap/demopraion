import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { projectShowcase } from '@/components/shop/showcase-data';

const opts = { locale: 'en', defaultLocale: 'el' };

describe('projectShowcase', () => {
  test('projects gallery + variant galleries to media URLs and dedupes for JSON-LD', () => {
    const sc = projectShowcase(
      {
        title: 'Chair',
        price: 50,
        compareAtPrice: 70,
        gallery: [{ image: 'base-1', alt: 'a' }, { image: 'base-2' }],
        attributes: [
          {
            id: 'color',
            name: { en: 'Color', el: 'Χρώμα' },
            swatchType: 'color',
            values: [
              { id: 'blue', label: { en: 'Blue' }, color: '#00f', gallery: [{ image: 'base-1' }, { image: 'blue-1' }] },
            ],
          },
        ],
        variations: [{ id: 'v1', options: { color: 'blue' }, price: 55, enabled: true }],
      },
      opts,
    );
    assert.equal(sc.title, 'Chair');
    assert.equal(sc.basePrice, 50);
    assert.equal(sc.compareAt, 70);
    assert.deepEqual(sc.images.map((i) => i.url), ['/api/cms/media/file/base-1', '/api/cms/media/file/base-2']);
    assert.equal(sc.attributes[0].name, 'Color');
    assert.equal(sc.attributes[0].values[0].gallery?.length, 2);
    assert.equal(sc.variations[0].price, 55);
    // base-1 appears in both base + variant gallery → deduped in allImageUrls.
    assert.deepEqual(sc.allImageUrls, [
      '/api/cms/media/file/base-1',
      '/api/cms/media/file/base-2',
      '/api/cms/media/file/blue-1',
    ]);
  });

  test('resolves external + digital by product type', () => {
    const ext = projectShowcase(
      { title: 'X', productType: 'external', externalUrl: ' https://x.gr ', externalLabel: { en: 'Buy on X' } },
      opts,
    );
    assert.deepEqual(ext.external, { url: 'https://x.gr', label: 'Buy on X' });
    assert.equal(ext.digital, undefined);

    const dig = projectShowcase(
      { title: 'Y', productType: 'digital', downloadFiles: [{ name: 'Manual.pdf' }, { name: '' }] },
      opts,
    );
    assert.deepEqual(dig.digital, { includes: ['Manual.pdf'] });
    assert.equal(dig.external, undefined);
  });

  test('label falls back across locales', () => {
    const sc = projectShowcase(
      { title: 'T', attributes: [{ id: 'a', name: { el: 'Μόνο' }, values: [{ id: 'v', label: { el: 'Τιμή' } }] }] },
      opts,
    );
    // en missing → falls back to el.
    assert.equal(sc.attributes[0].name, 'Μόνο');
    assert.equal(sc.attributes[0].values[0].label, 'Τιμή');
  });
});
