/**
 * Product feeds for the Greek marketplaces + Google.
 *
 * Two on-the-fly XML generators over the published catalog:
 *  - **Skroutz family** (`<mywebstore>`): Skroutz, and the near-identical
 *    BestPrice / Shopflix schemas — the exact field mapping is finished in each
 *    merchant's own panel, so one builder serves all three.
 *  - **Google Merchant Center** (RSS 2.0 + the `g:` namespace).
 *
 * The pure `buildSkroutzXml` / `buildGoogleMerchantXml` take a projected
 * `FeedProduct[]` + metadata (including a caller-supplied `generatedAt`, so they
 * stay pure and unit-test without a clock). `renderFeed` does the DB read,
 * visibility filter and projection, then dispatches to the right builder.
 *
 * Prices are MAJOR units (product `data.price`); feeds emit them as decimal
 * strings. Products the storefront wouldn't list (hidden / search-only) are
 * excluded, matching `filterByVisibility('catalog')`.
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { DocumentRow } from '../../db/adapters/mysql/schema/documents';
import { getDb, schema } from '../../db';
import { listPublishedDocuments } from '../../core';
import { localeUrl, priceString } from '../../../lib/seo/commerce-schema';
import { SITE_URL } from '../../../lib/seo/schemas';
import { DEFAULT_CATEGORY_TYPE, DEFAULT_PRODUCT_TYPE, getSiteCurrency } from './read';

export const FEED_FORMATS = ['skroutz', 'bestprice', 'shopflix', 'google'] as const;
export type FeedFormat = (typeof FEED_FORMATS)[number];

/** Accepts `skroutz.xml`, `google-merchant.xml`, … → a canonical format key. */
export function resolveFeedFormat(name: string): FeedFormat | null {
  const base = name.replace(/\.xml$/i, '').toLowerCase();
  if (base === 'google-merchant' || base === 'merchant' || base === 'google') return 'google';
  return (FEED_FORMATS as readonly string[]).includes(base) ? (base as FeedFormat) : null;
}

// ── Projection ────────────────────────────────────────────────────────────────

export interface FeedProduct {
  id: string;
  title: string;
  description: string;
  /** Absolute product URL. */
  link: string;
  /** Absolute primary image URL (empty when the product has no gallery). */
  image: string;
  additionalImages: string[];
  price: number;
  currency: string;
  /** Product availability enum (`in-stock` | …). */
  availability: string;
  stock?: number;
  brand?: string;
  gtin?: string;
  mpn?: string;
  sku?: string;
  /** `new` | `refurbished` | `used`. */
  condition: string;
  category?: string;
  weight?: number;
  weightUnit?: string;
}

type Localized = string | Record<string, string> | undefined;

function resolveLoc(v: Localized, locale: string): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const pick = v[locale];
    const any = Object.values(v).find((x) => typeof x === 'string' && x.trim());
    return String(pick ?? any ?? '').trim();
  }
  return '';
}

const MEDIA = (uuid: string) => `${SITE_URL}/api/cms/media/file/${uuid}`;

/** Visibilities a catalog feed lists — same set as `filterByVisibility('catalog')`. */
const FEED_VISIBILITIES = new Set(['visible', 'catalog']);

/**
 * Project a published product document into a feed entry, resolving category
 * names via `categoryNames`. Returns null for products a feed shouldn't carry
 * (no price, or hidden/search-only visibility).
 */
export function productDocToFeed(
  doc: DocumentRow,
  locale: string,
  currency: string,
  categoryNames: Map<number, string>,
): FeedProduct | null {
  const data = doc.data as Record<string, unknown>;
  const visibility = String(data.visibility ?? 'visible');
  if (!FEED_VISIBILITIES.has(visibility)) return null;

  const price = Number(data.price ?? 0);
  if (!(price > 0)) return null;

  const gallery = Array.isArray(data.gallery)
    ? (data.gallery as { image?: string }[]).filter((g) => g.image).map((g) => MEDIA(g.image!))
    : [];

  const categoryIds = Array.isArray(data.categories) ? (data.categories as number[]) : [];
  const category = categoryIds
    .map((id) => categoryNames.get(id))
    .filter((n): n is string => Boolean(n))
    .join(' > ');

  const str = (v: unknown) => (v == null || v === '' ? undefined : String(v));

  return {
    id: doc.slug,
    title: String(data.title ?? doc.metaTitle ?? doc.slug),
    description: String(data.subtitle ?? doc.metaDescription ?? data.title ?? doc.slug),
    link: localeUrl(`/shop/${doc.slug}`, locale as 'el' | 'en'),
    image: gallery[0] ?? '',
    additionalImages: gallery.slice(1, 10),
    price,
    currency,
    availability: String(data.availability ?? 'in-stock'),
    stock: data.stock == null || data.stock === '' ? undefined : Number(data.stock),
    brand: str(data.brand),
    gtin: str(data.gtin),
    mpn: str(data.mpn),
    sku: str(data.sku),
    condition: String(data.condition ?? 'new'),
    category: category || undefined,
    weight: data.weight == null || data.weight === '' ? undefined : Number(data.weight),
    weightUnit: str(data.weightUnit),
  };
}

/** id → localized title for every published category (one query). */
async function categoryNameMap(locale: string): Promise<Map<number, string>> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.documents.id, slug: schema.documents.slug, data: schema.documents.data })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.type, DEFAULT_CATEGORY_TYPE),
        eq(schema.documents.status, 'published'),
      ),
    );
  const map = new Map<number, string>();
  for (const r of rows) {
    const title = resolveLoc((r.data as Record<string, unknown>).title as Localized, locale) || r.slug;
    map.set(r.id, title);
  }
  return map;
}

/** Every feed-eligible product for `locale`, projected. */
export async function listFeedProducts(locale: string): Promise<FeedProduct[]> {
  const [docs, currency, categoryNames] = await Promise.all([
    listPublishedDocuments(DEFAULT_PRODUCT_TYPE, locale, { limit: 1000 }),
    getSiteCurrency(),
    categoryNameMap(locale),
  ]);
  return docs
    .map((doc) => productDocToFeed(doc, locale, currency, categoryNames))
    .filter((p): p is FeedProduct => p !== null);
}

// ── Availability mappings ─────────────────────────────────────────────────────

/** Product availability enum → Google Merchant `g:availability`. */
export function availabilityToMerchant(availability: string): string {
  switch (availability) {
    case 'out-of-stock':
      return 'out_of_stock';
    case 'preorder':
    case 'made-to-order':
      return 'preorder';
    default:
      return 'in_stock';
  }
}

/** Product availability enum → a Skroutz-family availability label (Greek). */
export function availabilityToSkroutz(availability: string): string {
  switch (availability) {
    case 'out-of-stock':
      return 'Μη διαθέσιμο';
    case 'preorder':
    case 'made-to-order':
      return 'Κατόπιν παραγγελίας';
    default:
      return 'Άμεσα διαθέσιμο';
  }
}

// ── XML builders (pure) ───────────────────────────────────────────────────────

/** Minimal XML text escaping for element content. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** `<tag>escaped</tag>`, or '' when value is empty/undefined (skip the element). */
function el(tag: string, value: string | number | undefined): string {
  if (value === undefined || value === '' || value === null) return '';
  return `<${tag}>${xmlEscape(String(value))}</${tag}>`;
}

export interface FeedMeta {
  storeName: string;
  /** ISO timestamp — passed in so the builders stay pure. */
  generatedAt: string;
}

/** Skroutz-family XML (`<mywebstore>`), also used for BestPrice / Shopflix. */
export function buildSkroutzXml(products: FeedProduct[], meta: FeedMeta): string {
  const items = products
    .map((p) => {
      const parts = [
        el('id', p.id),
        el('name', p.title),
        el('link', p.link),
        el('image', p.image),
        el('category', p.category),
        el('price_with_vat', priceString(p.price)),
        el('manufacturer', p.brand),
        el('mpn', p.mpn),
        el('ean', p.gtin),
        el('availability', availabilityToSkroutz(p.availability)),
        p.stock !== undefined ? el('quantity', p.stock) : '',
        p.weight !== undefined ? el('weight', p.weight) : '',
      ].filter(Boolean);
      return `    <product>\n      ${parts.join('\n      ')}\n    </product>`;
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<mywebstore>\n` +
    `  ${el('created_at', meta.generatedAt)}\n` +
    `  <products>\n${items}\n  </products>\n` +
    `</mywebstore>\n`
  );
}

/** Google Merchant Center RSS 2.0 feed. */
export function buildGoogleMerchantXml(products: FeedProduct[], meta: FeedMeta): string {
  const items = products
    .map((p) => {
      const parts = [
        el('g:id', p.id),
        el('title', p.title),
        el('description', p.description),
        el('link', p.link),
        el('g:image_link', p.image),
        ...p.additionalImages.map((img) => el('g:additional_image_link', img)),
        el('g:availability', availabilityToMerchant(p.availability)),
        el('g:price', `${priceString(p.price)} ${p.currency}`),
        el('g:brand', p.brand),
        el('g:gtin', p.gtin),
        el('g:mpn', p.mpn),
        el('g:condition', p.condition),
        el('g:identifier_exists', p.gtin || p.mpn || p.brand ? undefined : 'no'),
        el('g:product_type', p.category),
      ].filter(Boolean);
      return `    <item>\n      ${parts.join('\n      ')}\n    </item>`;
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n` +
    `  <channel>\n` +
    `    ${el('title', meta.storeName)}\n` +
    `    <link>${xmlEscape(SITE_URL)}</link>\n` +
    `    ${el('description', `${meta.storeName} product feed`)}\n` +
    `${items}\n` +
    `  </channel>\n` +
    `</rss>\n`
  );
}

export interface RenderedFeed {
  xml: string;
  contentType: string;
}

/**
 * Read the catalog and render one feed. `generatedAt`/`storeName` are injected
 * (the route supplies the timestamp) so this stays the only impure step.
 */
export async function renderFeed(
  format: FeedFormat,
  locale: string,
  meta: FeedMeta,
): Promise<RenderedFeed> {
  const products = await listFeedProducts(locale);
  const xml =
    format === 'google'
      ? buildGoogleMerchantXml(products, meta)
      : buildSkroutzXml(products, meta);
  return { xml, contentType: 'application/xml; charset=utf-8' };
}
