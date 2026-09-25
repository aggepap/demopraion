/**
 * One document's SEO/AEO values, normalised for the public site.
 *
 * The values arrive from two places — SEO columns on the row, and the `data.seo`
 * JSON the editor's SEO panel writes — and every route needs the same handful
 * of them. Reading them inline per route is how `noindex` ended up being
 * honoured by exactly one of the six document-backed routes while the other
 * five quietly indexed pages the editor had taken out of search.
 *
 * Everything here is defensive. `data` is JSON an older document may not have,
 * and a page must never fail to render because its SEO block is an unexpected
 * shape — the worst outcome allowed is "this field behaves as if unset".
 *
 * Pure and dependency-free (no `server-only`), so the sitemap, the metadata
 * builders and the tests can all call it.
 */
import { ROBOTS_DEFAULT, robotsValue, SEO_FIELDS_DATA_KEY } from './fields';

export interface SeoFaq {
  question: string;
  answer: string;
}

export interface DocumentSeo {
  metaTitle: string | null;
  metaDescription: string | null;
  /** Social title/description. Null means "fall back to the meta pair". */
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageUuid: string | null;
  twitterCard: 'summary' | 'summary_large_image' | null;
  /**
   * The editor's canonical override — the address of the ORIGINAL when this
   * page duplicates another. Deliberately not the `canonical_path` column,
   * which is the unique routing index and cannot hold two pages' shared
   * canonical; see the note on the field in `fields.ts`.
   */
  canonicalUrl: string | null;
  /** `index, follow` etc. Always a value; compare against `ROBOTS_DEFAULT`. */
  robots: string;
  noindex: boolean;
  nofollow: boolean;
  includeInSitemap: boolean;
  faqs: SeoFaq[];
  keyFacts: string[];
  answerSummary: string | null;
  prosCons: { pro: string; con: string }[];
  focusKeywords: string[];
  /**
   * Parsed JSON-LD that REPLACES the generated graph. Null unless the editor
   * pasted something that parses to an object or an array — a half-typed string
   * must not blank out a page's structured data.
   */
  schemaOverride: unknown;
  /**
   * The document's own schema type, overriding its category's (Settings →
   * Structured data). Null for "use the category setting"; whether the value is
   * allowed for the category is decided by `resolveSchemaChoice`.
   */
  schemaType: string | null;
}

/** The subset of a document row this reads. Structural typing so callers can
 *  pass a full `DocumentRow`, a projection, or a version snapshot. */
export interface SeoDocumentInput {
  data?: unknown;
  metaTitle?: string | null;
  metaDescription?: string | null;
  noindex?: boolean | null;
  nofollow?: boolean | null;
  includeInSitemap?: boolean | null;
  ogImageUuid?: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter(isRecord) : [];

/** A repeater of one-string rows → the strings, empties dropped. */
function strings(v: unknown, key: string): string[] {
  return rows(v)
    .map((row) => text(row[key]))
    .filter((s): s is string => s !== null);
}

/** Parse a pasted JSON-LD override. Anything that is not an object or an array
 *  is ignored — including valid JSON like `"hello"` or `42`, which would be
 *  syntactically fine and semantically nothing. */
function parseSchemaOverride(v: unknown): unknown {
  const raw = text(v);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** `inherit`, blank and non-strings all mean "no override". */
function schemaTypeOf(v: unknown): string | null {
  const type = text(v);
  return type === null || type === 'inherit' ? null : type;
}

export function documentSeo(doc: SeoDocumentInput): DocumentSeo {
  const data = isRecord(doc.data) ? doc.data : {};
  const seo = isRecord(data[SEO_FIELDS_DATA_KEY]) ? (data[SEO_FIELDS_DATA_KEY] as Record<string, unknown>) : {};

  const noindex = doc.noindex === true;
  const nofollow = doc.nofollow === true;
  const card = seo.twitterCard;

  return {
    metaTitle: text(doc.metaTitle),
    metaDescription: text(doc.metaDescription),
    ogTitle: text(seo.ogTitle),
    ogDescription: text(seo.ogDescription),
    ogImageUuid: text(doc.ogImageUuid),
    twitterCard: card === 'summary' || card === 'summary_large_image' ? card : null,
    canonicalUrl: text(seo.canonicalUrl),
    robots: robotsValue(noindex, nofollow),
    noindex,
    nofollow,
    // Absent reads as true, matching the column default. A document written
    // before this field existed is in the sitemap, and must stay there.
    includeInSitemap: doc.includeInSitemap !== false,
    faqs: rows(seo.faqs)
      .map((row) => ({ question: text(row.question), answer: text(row.answer) }))
      // Half a Q&A pair is not an FAQ, and search engines reject the entry
      // rather than the page — so drop it here where it is visible in tests.
      .filter((f): f is SeoFaq => f.question !== null && f.answer !== null),
    keyFacts: strings(seo.keyFacts, 'fact'),
    answerSummary: text(seo.answerSummary),
    prosCons: rows(seo.prosCons)
      .map((row) => ({ pro: text(row.pro) ?? '', con: text(row.con) ?? '' }))
      .filter((p) => p.pro !== '' || p.con !== ''),
    focusKeywords: strings(seo.focusKeywords, 'keyword'),
    schemaOverride: parseSchemaOverride(seo.schemaOverride),
    schemaType: schemaTypeOf(seo.schemaType),
  };
}

/** Has the editor asked for anything other than the default visibility? */
export function seoRestrictsRobots(seo: DocumentSeo): boolean {
  return seo.robots !== ROBOTS_DEFAULT;
}
