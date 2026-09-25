import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  availabilityToMerchant,
  availabilityToSkroutz,
  buildGoogleMerchantXml,
  buildSkroutzXml,
  resolveFeedFormat,
  xmlEscape,
  type FeedProduct,
} from '@/cms/modules/commerce';

const meta = { storeName: 'Praion', generatedAt: '2026-07-27T00:00:00.000Z' };

const product = (over: Partial<FeedProduct> = {}): FeedProduct => ({
  id: 'oak-chair',
  title: 'Oak Chair',
  description: 'Solid oak',
  link: 'https://praion.gr/shop/oak-chair',
  image: 'https://praion.gr/api/cms/media/file/abc',
  additionalImages: [],
  price: 120,
  currency: 'EUR',
  availability: 'in-stock',
  stock: 5,
  brand: 'Praion',
  gtin: '5201234567890',
  mpn: 'MPN-9',
  sku: 'OAK-1',
  condition: 'new',
  category: 'Furniture > Chairs',
  weight: 8,
  weightUnit: 'kg',
  ...over,
});

describe('resolveFeedFormat', () => {
  test('accepts the .xml aliases and the merchant synonyms', () => {
    assert.equal(resolveFeedFormat('skroutz.xml'), 'skroutz');
    assert.equal(resolveFeedFormat('bestprice.xml'), 'bestprice');
    assert.equal(resolveFeedFormat('shopflix'), 'shopflix');
    assert.equal(resolveFeedFormat('google-merchant.xml'), 'google');
    assert.equal(resolveFeedFormat('merchant'), 'google');
    assert.equal(resolveFeedFormat('nope'), null);
  });
});

describe('availability mappings', () => {
  test('→ Google Merchant vocabulary', () => {
    assert.equal(availabilityToMerchant('in-stock'), 'in_stock');
    assert.equal(availabilityToMerchant('out-of-stock'), 'out_of_stock');
    assert.equal(availabilityToMerchant('preorder'), 'preorder');
    assert.equal(availabilityToMerchant('made-to-order'), 'preorder');
  });

  test('→ Skroutz Greek labels', () => {
    assert.equal(availabilityToSkroutz('in-stock'), 'Άμεσα διαθέσιμο');
    assert.equal(availabilityToSkroutz('out-of-stock'), 'Μη διαθέσιμο');
    assert.equal(availabilityToSkroutz('made-to-order'), 'Κατόπιν παραγγελίας');
  });
});

describe('xmlEscape', () => {
  test('escapes the five XML metacharacters', () => {
    assert.equal(xmlEscape(`Tom & "Jerry" <a> 'b'`), 'Tom &amp; &quot;Jerry&quot; &lt;a&gt; &apos;b&apos;');
  });
});

describe('buildSkroutzXml', () => {
  const xml = buildSkroutzXml([product()], meta);

  test('well-formed <mywebstore> with product fields', () => {
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('<mywebstore>'));
    assert.ok(xml.includes('<created_at>2026-07-27T00:00:00.000Z</created_at>'));
    assert.ok(xml.includes('<id>oak-chair</id>'));
    assert.ok(xml.includes('<price_with_vat>120.00</price_with_vat>'));
    assert.ok(xml.includes('<manufacturer>Praion</manufacturer>'));
    assert.ok(xml.includes('<ean>5201234567890</ean>'));
    assert.ok(xml.includes('<availability>Άμεσα διαθέσιμο</availability>'));
    assert.ok(xml.includes('<quantity>5</quantity>'));
    assert.ok(xml.includes('<weight>8</weight>'));
  });

  test('omits empty optional elements', () => {
    const bare = buildSkroutzXml([product({ brand: undefined, gtin: undefined, mpn: undefined, weight: undefined })], meta);
    assert.ok(!bare.includes('<manufacturer>'));
    assert.ok(!bare.includes('<ean>'));
    assert.ok(!bare.includes('<weight>'));
  });
});

describe('buildGoogleMerchantXml', () => {
  const xml = buildGoogleMerchantXml([product({ additionalImages: ['https://praion.gr/api/cms/media/file/x2'] })], meta);

  test('RSS with the g: namespace and required item fields', () => {
    assert.ok(xml.includes('xmlns:g="http://base.google.com/ns/1.0"'));
    assert.ok(xml.includes('<g:id>oak-chair</g:id>'));
    assert.ok(xml.includes('<g:price>120.00 EUR</g:price>'));
    assert.ok(xml.includes('<g:availability>in_stock</g:availability>'));
    assert.ok(xml.includes('<g:brand>Praion</g:brand>'));
    assert.ok(xml.includes('<g:gtin>5201234567890</g:gtin>'));
    assert.ok(xml.includes('<g:condition>new</g:condition>'));
    assert.ok(xml.includes('<g:product_type>Furniture &gt; Chairs</g:product_type>'));
    assert.ok(xml.includes('<g:additional_image_link>https://praion.gr/api/cms/media/file/x2</g:additional_image_link>'));
  });

  test('flags g:identifier_exists=no when brand/gtin/mpn are all absent', () => {
    const noIds = buildGoogleMerchantXml([product({ brand: undefined, gtin: undefined, mpn: undefined })], meta);
    assert.ok(noIds.includes('<g:identifier_exists>no</g:identifier_exists>'));
  });
});
