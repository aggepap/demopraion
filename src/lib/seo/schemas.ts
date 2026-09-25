/**
 * JSON-LD helpers. Every helper returns a plain object to stringify into a
 * `<script type="application/ld+json">` tag or compose into an `@graph`.
 * Stable `@id`s (`#organization`, `#website`) let schemas reference each other.
 */
import type { SiteBrand } from '@/cms/core/brand/policy';
import type { DocumentSeo } from '@/cms/core/seo/document';
import { buildDocumentNodes, businessNode, structuredDataJson, type DocumentFacts } from '@/cms/core/structured-data/nodes';
import {
  resolveSchemaChoice,
  type BusinessPolicy,
  type SchemaCategoryKey,
  type SchemaPolicy,
} from '@/cms/core/structured-data/policy';
import { defaultLocale } from '@/lib/i18n/config';
// Only for the deploy URL fallback: the brand itself is read from the database.
import { brand as brandFile } from '@/site.brand';

/** A question and its answer, as FAQPage wants them. */
export interface FAQItem {
  question: string;
  answer: string;
}

/**
 * Canonical origin, from `NEXT_PUBLIC_SITE_URL` (inlined at build time) so
 * staging and production build from the same code. No trailing slash.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? brandFile.url;

export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** `/about` in a locale: unprefixed for the default locale, `/en/about` otherwise. */
export function localePath(locale: string, path: string): string {
  if (locale === defaultLocale) return path;
  return `/${locale}${path === '/' ? '' : path}`;
}

/**
 * The Organization, from the brand saved in Settings → Branding, as the business
 * type chosen in Settings → Structured data.
 */
export function organizationSchema(brand: SiteBrand, business?: BusinessPolicy) {
  const sameAs = Object.values(brand.socials).filter(Boolean);
  const hasAddress = Boolean(brand.address.street || brand.address.city);
  const org = {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: brand.name,
    ...(brand.legalName ? { legalName: brand.legalName } : {}),
    url: SITE_URL,
    ...(brand.logoUrl ? { logo: `${SITE_URL}${brand.logoUrl}` } : {}),
    ...(brand.tagline ? { slogan: brand.tagline } : {}),
    ...(hasAddress
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: brand.address.street || undefined,
            postalCode: brand.address.postcode || undefined,
            addressLocality: brand.address.city || undefined,
            addressCountry: brand.address.country || undefined,
          },
        }
      : {}),
    ...(brand.email || brand.phoneHref
      ? {
          contactPoint: {
            '@type': 'ContactPoint',
            ...(brand.email ? { email: brand.email } : {}),
            ...(brand.phoneHref ? { telephone: brand.phoneHref } : {}),
            contactType: 'customer service',
          },
        }
      : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
  return business ? businessNode(org, business) : org;
}

export function websiteSchema(locale: string, brand: SiteBrand) {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: SITE_URL,
    name: brand.name,
    publisher: { '@id': ORG_ID },
    inLanguage: locale,
  };
}

/** Wrap schema objects into one `@graph` document. */
export function graphSchema(items: ReadonlyArray<Record<string, unknown>>) {
  return { '@context': 'https://schema.org', '@graph': items };
}

/** Organization + WebSite — emitted on every page by the locale layout. */
export function globalGraph(locale: string, brand: SiteBrand, business?: BusinessPolicy) {
  return graphSchema([organizationSchema(brand, business), websiteSchema(locale, brand)]);
}

/** Google rejects date-only values for datetime properties. */
export function toSchemaDateTime(value: string): string {
  return value.includes('T') ? value : `${value}T00:00:00+00:00`;
}

export function faqSchema(faqs: ReadonlyArray<FAQItem>) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

export interface BreadcrumbItem {
  name: string;
  /** Path relative to site root, with leading slash, no locale prefix. */
  path: string;
}

export function breadcrumbSchema(items: ReadonlyArray<BreadcrumbItem>, locale: string) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${localePath(locale, item.path)}`,
    })),
  };
}

/** JSON for `dangerouslySetInnerHTML`, with `<` escaped so `</script>` cannot break out. */
export function jsonLd(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

/**
 * A document's structured data, honouring the editor's overrides: a pasted
 * `schemaOverride` replaces the generated graph outright, and the document's
 * own FAQs are appended as a FAQPage.
 */
export function documentGraph(
  seo: { schemaOverride: unknown; faqs: ReadonlyArray<FAQItem> },
  items: ReadonlyArray<Record<string, unknown>>,
): string {
  if (seo.schemaOverride) return jsonLd(seo.schemaOverride);
  const all = seo.faqs.length ? [...items, faqSchema(seo.faqs)] : items;
  return jsonLd(graphSchema(all));
}

/**
 * A document's structured data, as its category is set up in Settings →
 * Structured data and as the document's own SEO panel overrides it. Null when
 * there is nothing to emit (the type is None) — render no `<script>` then.
 */
export function documentStructuredData(input: {
  category: SchemaCategoryKey;
  seo: Pick<DocumentSeo, 'schemaOverride' | 'schemaType' | 'faqs'>;
  policy: SchemaPolicy;
  /** Absolute URL of the document. */
  url: string;
  locale: string;
  facts: DocumentFacts;
  /** The breadcrumb trail; empty for none. */
  crumbs: ReadonlyArray<BreadcrumbItem>;
}): string | null {
  const nodes = buildDocumentNodes({
    ids: { orgId: ORG_ID, websiteId: WEBSITE_ID },
    url: input.url,
    locale: input.locale,
    choice: resolveSchemaChoice(input.policy, input.category, input.seo.schemaType),
    facts: input.facts,
    breadcrumb: input.crumbs.length > 0 ? breadcrumbSchema(input.crumbs, input.locale) : null,
    seoFaqs: input.seo.faqs,
  });
  return structuredDataJson(input.seo, nodes);
}
