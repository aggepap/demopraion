import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseBrandIdentity, parsePalette, resolveBrand } from '@/cms/core/brand/policy';
import { siteMetadata } from '@/lib/seo/metadata';
import { organizationSchema, SITE_URL, websiteSchema } from '@/lib/seo/schemas';

/**
 * Search engines and link previews read the brand from the database too: a name
 * or logo changed in Settings → Branding must reach the page title, the
 * Organization schema and the share card, not only the visible header.
 */

const UUID = '0b6f0d4e-6a1e-4c55-9d47-1f3b2a9c8e11';
const brand = resolveBrand(
  parseBrandIdentity({
    name: 'Acme',
    legalName: 'Acme Ltd',
    tagline: 'Well made',
    email: 'hello@acme.test',
    phone: '+30 210 000 0000',
    address: { street: '', city: 'Athens', postcode: '', country: 'GR' },
    socials: { instagram: 'https://instagram.com/acme', facebook: 'https://facebook.com/acme' },
    logoId: UUID,
    logoDarkId: null,
    faviconId: UUID,
    ogImageId: UUID,
  }),
  parsePalette(null),
);

describe('structured data from the brand', () => {
  test('the Organization carries the saved name, logo and profiles', () => {
    const org = organizationSchema(brand) as Record<string, unknown>;
    assert.equal(org.name, 'Acme');
    assert.equal(org.legalName, 'Acme Ltd');
    assert.equal(org.logo, `${SITE_URL}/api/cms/media/file/${UUID}`);
    assert.deepEqual(org.sameAs, ['https://instagram.com/acme', 'https://facebook.com/acme']);
  });

  test('the WebSite is named after the brand', () => {
    assert.equal((websiteSchema('en', brand) as Record<string, unknown>).name, 'Acme');
  });
});

describe('site metadata from the brand', () => {
  const meta = siteMetadata(brand);

  test('titles are built from the saved name and tagline', () => {
    assert.deepEqual(meta.title, { default: 'Acme — Well made', template: '%s | Acme' });
  });

  test('the favicon and share image are the uploaded ones', () => {
    assert.deepEqual(meta.icons, { icon: [{ url: `/api/cms/media/file/${UUID}` }] });
    assert.deepEqual((meta.openGraph as { images?: unknown }).images, [{ url: `/api/cms/media/file/${UUID}` }]);
  });

  test('with no favicon uploaded, the bundled one is used', () => {
    const plain = siteMetadata({ ...brand, faviconUrl: null, ogImageUrl: null });
    assert.deepEqual(plain.icons, { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }] });
    assert.equal((plain.openGraph as { images?: unknown }).images, undefined);
  });
});
