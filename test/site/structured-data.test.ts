import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseBrandIdentity, parsePalette, resolveBrand } from '@/cms/core/brand/policy';
import { documentSeo } from '@/cms/core/seo/document';
import { parseSchemaPolicy } from '@/cms/core/structured-data/policy';
import { documentStructuredData, globalGraph, ORG_ID, SITE_URL } from '@/lib/seo/schemas';

/**
 * The site's side of Settings → Structured data: the layout's Organization takes
 * the chosen business type, and a document's graph follows its category.
 */

const brand = resolveBrand(
  parseBrandIdentity({
    name: 'Acme',
    legalName: '',
    tagline: '',
    email: '',
    phone: '+30 210 000 0000',
    address: { street: '1 Main St', city: 'Athens', postcode: '', country: 'GR' },
    socials: {},
    logoId: null,
    logoDarkId: null,
    faviconId: null,
    ogImageId: null,
  }),
  parsePalette(null),
);

type Graph = { '@graph': readonly Record<string, unknown>[] };

describe('site structured data', () => {
  test('the layout Organization takes the chosen business type', () => {
    const graph = globalGraph('en', brand, { type: 'TravelAgency', priceRange: '' }) as Graph;
    const org = graph['@graph'][0];
    assert.equal(org['@type'], 'TravelAgency');
    assert.equal(org['@id'], ORG_ID);
    assert.equal(org.telephone, '+302100000000');
    // Without a business choice the Organization is unchanged.
    assert.equal((globalGraph('en', brand) as Graph)['@graph'][0]['@type'], 'Organization');
  });

  test('a document graph follows the category and the document override', () => {
    const policy = parseSchemaPolicy({ categories: { pages: { type: 'AboutPage' } } });
    const input = (data: Record<string, unknown>) => ({
      category: 'pages' as const,
      seo: documentSeo({ data }),
      policy,
      url: `${SITE_URL}/about`,
      locale: 'en',
      facts: { name: 'About' },
      crumbs: [
        { name: 'Home', path: '/' },
        { name: 'About', path: '/about' },
      ],
    });

    const graph = JSON.parse(documentStructuredData(input({}))!) as Graph;
    assert.deepEqual(
      graph['@graph'].map((n) => n['@type']),
      ['AboutPage', 'BreadcrumbList'],
    );

    const contact = JSON.parse(documentStructuredData(input({ seo: { schemaType: 'ContactPage' } }))!) as Graph;
    assert.equal(contact['@graph'][0]['@type'], 'ContactPage');

    assert.equal(documentStructuredData(input({ seo: { schemaType: 'None' } })), null);
  });
});
