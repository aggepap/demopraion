/**
 * The JSON-LD nodes one document emits, built from its resolved `SchemaChoice`.
 *
 * Lives in the core, not in the site's `lib/seo`, so every site built from the
 * CMS gets the same rules — and pure, because the core may not import the site:
 * the site passes in its own origin-based ids, its breadcrumb node and whatever
 * it knows about the document (`facts`), and serialises nothing itself.
 */
import type { BusinessPolicy, SchemaChoice } from './policy';
import { isLocalBusiness } from './policy';

type Node = Record<string, unknown>;

export interface SchemaIds {
  orgId: string;
  websiteId: string;
}

export interface FaqPair {
  question: string;
  answer: string;
}

/** What the page knows about the document. Anything absent is left out. */
export interface DocumentFacts {
  name: string;
  description?: string;
  /** Absolute image URLs. */
  images?: string[];
  datePublished?: string | Date | null;
  dateModified?: string | Date | null;
  /** A Person node with an `@id`; referenced from the article and emitted beside it. */
  author?: Node | null;
  /** An Offer / AggregateOffer node. */
  offers?: Node | null;
  /** A product node the site already builds (price, stock, reviews…). */
  productNode?: Node;
  /** The document's own questions (an answer's question and short answer). */
  faq?: FaqPair[];
}

export interface DocumentNodesInput {
  ids: SchemaIds;
  /** The document's absolute URL. */
  url: string;
  locale: string;
  choice: SchemaChoice;
  facts: DocumentFacts;
  /** A BreadcrumbList node, or null for none. */
  breadcrumb: Node | null;
  /** The SEO panel's FAQs. */
  seoFaqs: readonly FaqPair[];
}

/**
 * What a `speakable` part points voice assistants at: the page's headline and its
 * summary, marked in the template with `data-speakable="headline"` / `"summary"`.
 * Attributes rather than class names, so a restyle cannot silently unhook them.
 * A template that marks neither gets a spec that matches nothing, which search
 * engines ignore — it never reads the wrong text.
 */
export const SPEAKABLE_SELECTORS = ['[data-speakable="headline"]', '[data-speakable="summary"]'] as const;

/** Google's article headline limit. */
const HEADLINE_MAX = 110;

/** Google rejects date-only values for datetime properties. */
function dateTime(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  return value.includes('T') ? value : `${value}T00:00:00+00:00`;
}

const faqPage = (pairs: readonly FaqPair[], extra: Node = {}): Node => ({
  '@type': 'FAQPage',
  ...extra,
  mainEntity: pairs.map((f) => ({
    '@type': 'Question',
    name: f.question,
    acceptedAnswer: { '@type': 'Answer', text: f.answer },
  })),
});

const images = (input: DocumentNodesInput): Node =>
  input.choice.parts.image && input.facts.images?.length ? { image: input.facts.images } : {};

const offers = (input: DocumentNodesInput): Node =>
  input.choice.parts.offers && input.facts.offers ? { offers: input.facts.offers } : {};

const described = (facts: DocumentFacts): Node => (facts.description ? { description: facts.description } : {});

/** The main node, plus any node it references (the author). */
function mainNodes(input: DocumentNodesInput): Node[] {
  const { choice, facts, url, ids, locale } = input;
  const type = choice.type;

  switch (choice.family) {
    case 'none':
      return [];

    case 'webpage':
      return [
        {
          '@type': type,
          '@id': `${url}#webpage`,
          name: facts.name,
          ...described(facts),
          url,
          isPartOf: { '@id': ids.websiteId },
          publisher: { '@id': ids.orgId },
          inLanguage: locale,
        },
      ];

    case 'article': {
      const author = choice.parts.author ? facts.author : null;
      const published = choice.parts.dates ? dateTime(facts.datePublished) : undefined;
      const modified = choice.parts.dates ? dateTime(facts.dateModified) : undefined;
      const article: Node = {
        '@type': type,
        '@id': `${url}#article`,
        headline: facts.name.slice(0, HEADLINE_MAX),
        ...described(facts),
        url,
        mainEntityOfPage: url,
        inLanguage: locale,
        publisher: { '@id': ids.orgId },
        ...images(input),
        ...(published ? { datePublished: published } : {}),
        ...(modified ? { dateModified: modified } : {}),
        ...(author ? { author: author['@id'] ? { '@id': author['@id'] } : author } : {}),
        ...(choice.parts.speakable
          ? { speakable: { '@type': 'SpeakableSpecification', cssSelector: [...SPEAKABLE_SELECTORS] } }
          : {}),
      };
      return author?.['@id'] ? [article, author] : [article];
    }

    case 'faq': {
      // One FAQPage per page: two are reported as duplicates.
      const pairs = [...(facts.faq ?? []), ...(choice.appendFaq ? input.seoFaqs : [])];
      if (pairs.length === 0) return [];
      return [
        faqPage(pairs, {
          '@id': `${url}#faq`,
          name: facts.name,
          url,
          isPartOf: { '@id': ids.websiteId },
          inLanguage: locale,
        }),
      ];
    }

    case 'product': {
      const base: Node = facts.productNode
        ? { ...facts.productNode }
        : {
            '@id': `${url}#product`,
            name: facts.name,
            ...described(facts),
            url,
            ...(facts.images?.length ? { image: facts.images } : {}),
            ...(facts.offers ? { offers: facts.offers } : {}),
          };
      base['@type'] = type;
      if (!choice.parts.image) delete base.image;
      if (!choice.parts.brand) delete base.brand;
      if (!choice.parts.offers) delete base.offers;
      if (!choice.parts.reviews) {
        delete base.review;
        delete base.aggregateRating;
      }
      return [base];
    }

    case 'trip':
      return [
        {
          '@type': type,
          '@id': `${url}#trip`,
          name: facts.name,
          ...described(facts),
          url,
          provider: { '@id': ids.orgId },
          ...images(input),
          ...offers(input),
        },
      ];

    case 'accommodation':
      // Accommodation types cannot carry `offers` — Google ignores or flags them.
      return [
        {
          '@type': type,
          '@id': `${url}#accommodation`,
          name: facts.name,
          ...described(facts),
          url,
          ...images(input),
        },
      ];
  }
}

/**
 * Every node the document emits, in order: the main node (and its author), the
 * breadcrumb, then the SEO panel's FAQs as a FAQPage. `None` emits nothing —
 * the layout's Organization and WebSite still stand.
 */
export function buildDocumentNodes(input: DocumentNodesInput): Node[] {
  const { choice } = input;
  if (choice.family === 'none') return [];
  const nodes = mainNodes(input);
  if (choice.breadcrumbs && input.breadcrumb) nodes.push(input.breadcrumb);
  if (choice.appendFaq && choice.family !== 'faq' && input.seoFaqs.length > 0) {
    nodes.push(faqPage(input.seoFaqs));
  }
  return nodes;
}

/**
 * The site's Organization node as the chosen business type. The `@id` never
 * changes, so every `publisher` reference still resolves.
 *
 * A local business without an address stays an Organization: Google requires the
 * address, and an invalid LocalBusiness is worse than a valid Organization. The
 * admin screen says so.
 */
export function businessNode(org: Node, business: BusinessPolicy): Node {
  if (business.type === 'Organization') return org;
  if (!isLocalBusiness(business.type)) return { ...org, '@type': business.type };
  if (!org.address) return org;

  const contact = org.contactPoint as Node | undefined;
  return {
    ...org,
    '@type': business.type,
    ...(contact?.telephone ? { telephone: contact.telephone } : {}),
    ...(org.logo ? { image: org.logo } : {}),
    ...(business.priceRange ? { priceRange: business.priceRange } : {}),
  };
}

/** JSON for `dangerouslySetInnerHTML`, with `<` escaped so `</script>` cannot break out. */
const escapeJson = (payload: unknown): string => JSON.stringify(payload).replace(/</g, '\\u003c');

/**
 * The document's `<script>` body, or null for no script at all. A pasted
 * `schemaOverride` replaces everything — even a category set to None.
 */
export function structuredDataJson(
  seo: { schemaOverride: unknown },
  nodes: readonly Node[],
): string | null {
  if (seo.schemaOverride) return escapeJson(seo.schemaOverride);
  if (nodes.length === 0) return null;
  return escapeJson({ '@context': 'https://schema.org', '@graph': nodes });
}
