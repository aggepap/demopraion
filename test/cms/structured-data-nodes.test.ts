import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildDocumentNodes,
  businessNode,
  structuredDataJson,
  type DocumentNodesInput,
} from '@/cms/core/structured-data/nodes';
import { parseSchemaPolicy, resolveSchemaChoice } from '@/cms/core/structured-data/policy';

/**
 * The graph each document emits, from the type chosen in Settings → Structured
 * data (or on the document itself).
 */

const ids = { orgId: 'https://x.test/#organization', websiteId: 'https://x.test/#website' };
const url = 'https://x.test/blog/hello';
const crumb = { '@type': 'BreadcrumbList', itemListElement: [] };
const person = { '@type': 'Person', '@id': 'https://x.test/authors/ann#person', name: 'Ann' };

const build = (
  category: Parameters<typeof resolveSchemaChoice>[1],
  stored: unknown = null,
  over: Partial<DocumentNodesInput> = {},
  override: string | null = null,
) =>
  buildDocumentNodes({
    ids,
    url,
    locale: 'en',
    choice: resolveSchemaChoice(parseSchemaPolicy(stored), category, override),
    facts: {
      name: 'Hello',
      description: 'A post',
      images: ['https://x.test/a.jpg'],
      datePublished: '2026-01-02',
      dateModified: new Date('2026-02-03T10:00:00Z'),
      author: person,
    },
    breadcrumb: crumb,
    seoFaqs: [],
    ...over,
  });

const types = (nodes: Record<string, unknown>[]) => nodes.map((n) => n['@type']);

describe('document nodes — by family', () => {
  test('a page is a WebPage (or the chosen subtype) with its breadcrumb', () => {
    const nodes = build('pages');
    assert.deepEqual(types(nodes), ['WebPage', 'BreadcrumbList']);
    assert.equal(nodes[0].url, url);
    assert.deepEqual(nodes[0].isPartOf, { '@id': ids.websiteId });
    assert.equal(build('pages', { categories: { pages: { type: 'ContactPage' } } })[0]['@type'], 'ContactPage');
  });

  test('an article carries headline, dates, image and author', () => {
    const nodes = build('articles', null, {
      facts: {
        name: 'x'.repeat(200),
        images: ['https://x.test/a.jpg'],
        datePublished: '2026-01-02',
        author: person,
      },
    });
    assert.deepEqual(types(nodes), ['BlogPosting', 'Person', 'BreadcrumbList']);
    const article = nodes[0];
    assert.equal((article.headline as string).length, 110);
    assert.equal(article.datePublished, '2026-01-02T00:00:00+00:00');
    assert.deepEqual(article.image, ['https://x.test/a.jpg']);
    assert.deepEqual(article.author, { '@id': person['@id'] });
    assert.deepEqual(article.publisher, { '@id': ids.orgId });
  });

  test('switched-off article parts are left out', () => {
    const [article, ...rest] = build('articles', {
      categories: { articles: { parts: { author: false, dates: false, image: false } } },
    });
    assert.equal(article.author, undefined);
    assert.equal(article.datePublished, undefined);
    assert.equal(article.image, undefined);
    assert.deepEqual(types(rest), ['BreadcrumbList']);
  });

  test('an article carries a speakable spec while the part is on, and none once off', () => {
    // The toggle existed in Settings and did nothing: no node ever had `speakable`.
    const [on] = build('articles');
    assert.deepEqual(on.speakable, {
      '@type': 'SpeakableSpecification',
      cssSelector: ['[data-speakable="headline"]', '[data-speakable="summary"]'],
    });
    const [off] = build('articles', { categories: { articles: { parts: { speakable: false } } } });
    assert.equal(off.speakable, undefined);
  });

  test('None emits nothing for the document', () => {
    assert.deepEqual(build('articles', { categories: { articles: { type: 'None' } } }), []);
    assert.deepEqual(build('articles', null, {}, 'None'), []);
  });

  test('breadcrumbs can be switched off', () => {
    assert.deepEqual(types(build('pages', { categories: { pages: { breadcrumbs: false } } })), ['WebPage']);
  });

  test("an answer's own Q&A and the SEO panel FAQs share one FAQPage", () => {
    const nodes = build('answers', null, {
      facts: { name: 'Q?', faq: [{ question: 'Q?', answer: 'A.' }] },
      seoFaqs: [{ question: 'Q2?', answer: 'A2.' }],
    });
    assert.deepEqual(types(nodes), ['FAQPage', 'BreadcrumbList']);
    assert.equal((nodes[0].mainEntity as unknown[]).length, 2);
  });

  test('SEO panel FAQs are appended to other types, unless switched off', () => {
    const seoFaqs = [{ question: 'Q?', answer: 'A.' }];
    assert.deepEqual(types(build('pages', null, { seoFaqs })), ['WebPage', 'BreadcrumbList', 'FAQPage']);
    assert.deepEqual(
      types(build('pages', { categories: { pages: { appendFaq: false } } }, { seoFaqs })),
      ['WebPage', 'BreadcrumbList'],
    );
  });

  test('an FAQPage with no questions is not emitted', () => {
    assert.deepEqual(types(build('answers', null, { facts: { name: 'Q?' } })), ['BreadcrumbList']);
  });

  test('product parts can be removed from the site-built node', () => {
    const productNode = {
      '@type': 'Product',
      name: 'Mug',
      image: ['https://x.test/m.jpg'],
      brand: { '@type': 'Brand', name: 'Acme' },
      offers: { '@type': 'Offer', price: '10.00' },
      aggregateRating: { '@type': 'AggregateRating', ratingValue: 5, reviewCount: 1 },
      review: [{ '@type': 'Review' }],
    };
    const [full] = build('products', null, { facts: { name: 'Mug', productNode } });
    assert.ok(full.brand && full.offers && full.review && full.image);

    const [bare] = build(
      'products',
      { categories: { products: { parts: { brand: false, reviews: false, offers: false } } } },
      { facts: { name: 'Mug', productNode } },
    );
    assert.equal(bare.brand, undefined);
    assert.equal(bare.offers, undefined);
    assert.equal(bare.review, undefined);
    assert.equal(bare.aggregateRating, undefined);
    assert.deepEqual(bare.image, ['https://x.test/m.jpg']);
    // The caller's node is not mutated.
    assert.ok(productNode.brand);
  });

  test('a day trip is a TouristTrip provided by the organisation, with its offer', () => {
    const offers = { '@type': 'Offer', price: 40, priceCurrency: 'EUR' };
    const [trip] = build('bookingTransport', null, { facts: { name: 'Island day', offers } });
    assert.equal(trip['@type'], 'TouristTrip');
    assert.deepEqual(trip.provider, { '@id': ids.orgId });
    assert.deepEqual(trip.offers, offers);
  });

  test('a stay never carries offers', () => {
    const offers = { '@type': 'Offer', price: 90, priceCurrency: 'EUR' };
    const [stay] = build('bookingStay', null, {
      facts: { name: 'Sea view', images: ['https://x.test/s.jpg'], offers },
    });
    assert.equal(stay['@type'], 'Accommodation');
    assert.equal(stay.offers, undefined);
    assert.deepEqual(stay.image, ['https://x.test/s.jpg']);

    const [product] = build('bookingStay', { categories: { bookingStay: { type: 'Product' } } }, {
      facts: { name: 'Sea view', offers },
    });
    assert.equal(product['@type'], 'Product');
    assert.deepEqual(product.offers, offers);
  });
});

describe('business node', () => {
  const org = {
    '@type': 'Organization',
    '@id': ids.orgId,
    name: 'Acme',
    logo: 'https://x.test/logo.png',
    address: { '@type': 'PostalAddress', addressLocality: 'Athens' },
    contactPoint: { '@type': 'ContactPoint', telephone: '+30210' },
  };

  test('Organization is left as it is', () => {
    assert.deepEqual(businessNode(org, { type: 'Organization', priceRange: '' }), org);
  });

  test('a local business keeps the id and adds telephone, image and price range', () => {
    const node = businessNode(org, { type: 'TravelAgency', priceRange: '€€' });
    assert.equal(node['@type'], 'TravelAgency');
    assert.equal(node['@id'], ids.orgId);
    assert.equal(node.telephone, '+30210');
    assert.equal(node.image, 'https://x.test/logo.png');
    assert.equal(node.priceRange, '€€');
  });

  test('a local business without an address stays an Organization', () => {
    const noAddress = { ...org, address: undefined };
    assert.equal(businessNode(noAddress, { type: 'Hotel', priceRange: '' })['@type'], 'Organization');
    // An online store is not a local business: no address needed.
    assert.equal(businessNode(noAddress, { type: 'OnlineStore', priceRange: '' })['@type'], 'OnlineStore');
  });
});

describe('structuredDataJson', () => {
  test('a pasted override wins over everything, even None', () => {
    const json = structuredDataJson({ schemaOverride: { '@type': 'Event' } }, []);
    assert.equal(json, '{"@type":"Event"}');
  });

  test('no nodes means no script at all', () => {
    assert.equal(structuredDataJson({ schemaOverride: null }, []), null);
  });

  test('nodes become an escaped @graph', () => {
    const json = structuredDataJson({ schemaOverride: null }, [{ '@type': 'WebPage', name: '</script>' }]);
    assert.ok(json);
    assert.ok(!json.includes('</script>'));
    assert.deepEqual(JSON.parse(json), {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'WebPage', name: '</script>' }],
    });
  });
});
