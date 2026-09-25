/**
 * Catalog read helpers — thin wrappers over the published-document read layer,
 * projecting a product document into the shapes a storefront needs. Cached +
 * revalidated exactly like every other published read (they ARE published
 * reads). Price formatting is locale-aware via `Intl.NumberFormat`.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';

import type { DocumentRow } from '../../db/adapters/mysql/schema/documents';
import { getDb, schema } from '../../db';
import {
  getPublishedDocument,
  getSetting,
  listPublishedDocuments,
  typeTag,
  DEFAULT_CURRENCY,
  ECOMMERCE_CURRENCY_KEY,
} from '../../core';
import { CMS_CACHE_REVALIDATE } from '../../core/cache';


export const DEFAULT_PRODUCT_TYPE = 'product';
export const DEFAULT_CATEGORY_TYPE = 'category';
const DEFAULT_PATH_PREFIX = '/shop';

type Localized = string | Record<string, string> | undefined;

/** Resolve a (possibly localized) label to a display string for `locale`. */
function resolveLoc(v: Localized, locale: string): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const pick = (l: string) => (typeof v[l] === 'string' && v[l].trim() ? v[l] : undefined);
    const any = Object.values(v).find((x) => typeof x === 'string' && x.trim());
    return (pick(locale) || any || '').trim();
  }
  return '';
}

/**
 * The site-wide product currency (ISO 4217), read from settings. Currency is a
 * single sitewide choice (Settings → Ecommerce), not a per-product field, so
 * every price formats consistently. Falls back to `DEFAULT_CURRENCY` when unset.
 */
export async function getSiteCurrency(): Promise<string> {
  const stored = await getSetting<string>(ECOMMERCE_CURRENCY_KEY);
  return typeof stored === 'string' && stored ? stored : DEFAULT_CURRENCY;
}

export interface GalleryImage {
  image?: string;
  alt?: string;
}

/**
 * A generated variation (see the admin `VariationsEditor`). `options` maps each
 * attribute name to the selected value label; the rest override product-level
 * defaults for that combination.
 */
export interface ProductVariation {
  id: string;
  options: Record<string, string>;
  sku?: string;
  price?: number;
  stock?: number;
  image?: string;
  enabled?: boolean;
  weight?: number;
}

/** Physical dimensions used by the (future) shipping-rate calculator. */
export interface ProductDimensions {
  length?: number;
  width?: number;
  height?: number;
}

/**
 * How an attribute is offered in the shop filters. `color` and `image`
 * attributes default to swatches — a grid of colours reads faster than a
 * column of colour NAMES, which is what the checkbox list showed.
 */
export type FacetDisplay = 'list' | 'swatches';

/** One selectable value. `color`/`image` are present only for a swatch. */
export interface ProductFacetValue {
  label: string;
  color?: string;
  /** Ready-to-use URL for the swatch image (already through `/api/cms/media/file`). */
  image?: string;
}

/** A product's attributes, resolved for a locale — used for faceted filtering. */
export interface ProductFacet {
  name: string;
  display: FacetDisplay;
  values: ProductFacetValue[];
}

/**
 * A merchandising badge on a card / product page. `sale` is derived from the
 * compare-at price; `custom` carries the editor's own label.
 */
export interface ProductBadge {
  /** Translation key under `shop.badges`, or `custom` when `label` is set. */
  kind: 'sale' | 'new' | 'bestseller' | 'custom';
  label?: string;
}

/** Where a product may be listed. `hidden` still resolves by direct URL. */
export type ProductVisibility = 'visible' | 'catalog' | 'search' | 'hidden';

/** A tag carried by a product — the slug filters, the title labels (§6). */
export interface ProductTagRef {
  slug: string;
  title: string;
}

/** Card/summary projection for catalog grids. */
export interface ProductSummary {
  /** The document id. Carried so the wishlist can store a stable reference —
   *  a slug changes when an editor renames a product, and a saved list must
   *  not quietly empty itself when they do. */
  id: number;
  slug: string;
  title: string;
  subtitle?: string;
  price: number;
  /** Cheapest/dearest across enabled variations, when the product has any. */
  priceRange?: { min: number; max: number };
  currency: string;
  compareAtPrice?: number;
  availability: string;
  stock?: number;
  image?: GalleryImage;
  href: string;
  /** Attribute name → its value labels, resolved for the locale. */
  facets: ProductFacet[];
  featured: boolean;
  visibility: ProductVisibility;
  badges: ProductBadge[];
  /** `standard` | `grouped` | `external` | `digital` (addendum §5). */
  productType: string;
  /** Manual sort position; `null` when unset (sorts after numbered products). */
  menuOrder: number | null;
  /** Tags on this product, resolved for the locale (empty when none / unresolved). */
  tags: ProductTagRef[];
}

function num(v: unknown): number | undefined {
  return v == null || v === '' ? undefined : Number(v);
}

interface RawAttrFacet {
  name?: Localized;
  /** `button` | `color` | `image` — how the attribute renders on a product page. */
  swatchType?: string;
  /** Admin override of the derived filter display (`auto` when unset). */
  filterDisplay?: string;
  values?: { label?: Localized; color?: string; image?: string }[];
}

/** Swatches for a colour/image attribute unless the admin asked for a list. */
export function facetDisplayFor(attr: {
  swatchType?: string;
  filterDisplay?: string;
}): FacetDisplay {
  if (attr.filterDisplay === 'list' || attr.filterDisplay === 'swatches') return attr.filterDisplay;
  return attr.swatchType === 'color' || attr.swatchType === 'image' ? 'swatches' : 'list';
}

/** Resolve a product's attributes into locale-specific filter facets. */
function toFacets(data: Record<string, unknown>, locale: string): ProductFacet[] {
  const attributes = (Array.isArray(data.attributes) ? data.attributes : []) as RawAttrFacet[];
  const facets: ProductFacet[] = [];
  for (const attr of attributes) {
    const name = resolveLoc(attr.name, locale);
    if (!name) continue;
    const values = (attr.values ?? [])
      .map((v) => {
        const label = resolveLoc(v.label, locale);
        if (!label) return null;
        const value: ProductFacetValue = { label };
        if (v.color) value.color = String(v.color);
        if (v.image) value.image = mediaFileUrl(String(v.image));
        return value;
      })
      .filter((v): v is ProductFacetValue => v !== null);
    if (values.length > 0) facets.push({ name, display: facetDisplayFor(attr), values });
  }
  return facets;
}

const VISIBILITIES: ProductVisibility[] = ['visible', 'catalog', 'search', 'hidden'];

function toVisibility(v: unknown): ProductVisibility {
  return VISIBILITIES.includes(v as ProductVisibility) ? (v as ProductVisibility) : 'visible';
}

/**
 * The badges to render for a product: the derived "Sale" badge (whenever a
 * compare-at price actually beats the price), the editor's toggles, and an
 * optional custom label. Derived first so a sale always reads as a sale.
 */
export function toBadges(data: Record<string, unknown>, locale: string): ProductBadge[] {
  const badges: ProductBadge[] = [];
  const price = Number(data.price ?? 0);
  const compareAt = num(data.compareAtPrice);
  if (compareAt != null && compareAt > price) badges.push({ kind: 'sale' });

  const stored = Array.isArray(data.badges) ? (data.badges as unknown[]) : [];
  for (const value of stored) {
    if (value === 'new' || value === 'bestseller') badges.push({ kind: value });
  }

  const custom = resolveLoc(data.badgeLabel as Localized, locale);
  if (custom) badges.push({ kind: 'custom', label: custom });
  return badges;
}

/**
 * Resolve a product's stored `tags` relation ids through a tag index. Ids that
 * aren't in the index (deleted tag) are dropped, deduped by slug.
 */
function toTagRefs(data: Record<string, unknown>, index?: Map<number, ProductTagRef>): ProductTagRef[] {
  if (!index || index.size === 0) return [];
  const ids = Array.isArray(data.tags) ? data.tags : [];
  const out: ProductTagRef[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const ref = typeof id === 'number' ? index.get(id) : undefined;
    if (!ref || seen.has(ref.slug)) continue;
    seen.add(ref.slug);
    out.push(ref);
  }
  return out;
}

/** Media URL for a stored file id, matching `showcase-data.ts`. */
function mediaFileUrl(id: string): string {
  // Encoded: the id comes out of a document's JSON, and the result is
  // interpolated into a CSS `url(...)` by the swatch.
  return `/api/cms/media/file/${encodeURIComponent(id)}`;
}

/**
 * The price span across a product's ENABLED variations. Undefined when it has
 * none, or when none of them prices itself differently — a range equal to the
 * base price is noise on every card and in every filter.
 */
function variationPriceRange(
  data: Record<string, unknown>,
): { min: number; max: number } | undefined {
  const variations = Array.isArray(data.variations) ? (data.variations as ProductVariation[]) : [];
  const base = Number(data.price ?? 0);
  const prices = variations
    .filter((v) => v.enabled !== false)
    .map((v) => (v.price == null || v.price === ('' as unknown) ? base : Number(v.price)))
    .filter((n) => Number.isFinite(n));
  if (prices.length === 0) return undefined;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max && min === base ? undefined : { min, max };
}

function toSummary(
  doc: DocumentRow,
  pathPrefix: string,
  currency: string,
  locale: string,
  tagIndex?: Map<number, ProductTagRef>,
): ProductSummary {
  const data = doc.data as Record<string, unknown>;
  const gallery = Array.isArray(data.gallery) ? (data.gallery as GalleryImage[]) : [];
  return {
    id: doc.id,
    slug: doc.slug,
    title: String(data.title ?? doc.metaTitle ?? ''),
    subtitle: data.subtitle ? String(data.subtitle) : undefined,
    price: Number(data.price ?? 0),
    priceRange: variationPriceRange(data),
    currency,
    compareAtPrice: num(data.compareAtPrice),
    availability: String(data.availability ?? 'in-stock'),
    stock: num(data.stock),
    image: gallery[0],
    href: `${pathPrefix}/${doc.slug}`,
    facets: toFacets(data, locale),
    featured: data.featured === true,
    visibility: toVisibility(data.visibility),
    badges: toBadges(data, locale),
    productType: String(data.productType ?? 'standard'),
    menuOrder: data.menuOrder == null || data.menuOrder === '' ? null : Number(data.menuOrder),
    tags: toTagRefs(data, tagIndex),
  };
}

export interface ListProductsOptions {
  /** Document type. Default `product`. */
  type?: string;
  /** Storefront path prefix for card hrefs. Default `/shop`. */
  pathPrefix?: string;
  limit?: number;
}

/** All published products for a locale, projected to card summaries. */
export async function listProducts(
  locale: string,
  opts: ListProductsOptions = {},
): Promise<ProductSummary[]> {
  const [docs, currency, tagIndex] = await Promise.all([
    listPublishedDocuments(opts.type ?? DEFAULT_PRODUCT_TYPE, locale, { limit: opts.limit }),
    getSiteCurrency(),
    loadTagIndex(locale),
  ]);
  const prefix = opts.pathPrefix ?? DEFAULT_PATH_PREFIX;
  return docs.map((doc) => toSummary(doc, prefix, currency, locale, tagIndex));
}

// ── Search / sort / pagination ───────────────────────────────────────────────

export type ProductSort = 'newest' | 'price-asc' | 'price-desc' | 'name' | 'manual';

export interface ProductQueryOptions {
  q?: string;
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
  minPrice?: number;
  maxPrice?: number;
  /** Attribute name → selected value labels (OR within an attribute, AND across). */
  attrs?: Record<string, string[]>;
  /** Selected tag slugs (OR — a product qualifies if it carries any of them). */
  tags?: string[];
}

/** Where a product list is being shown — decides which visibilities qualify. */
export type CatalogContext = 'catalog' | 'search';

/**
 * Drop products that shouldn't be listed in this context (WooCommerce
 * semantics): `catalog` omits search-only + hidden, `search` omits
 * catalog-only + hidden. Detail pages deliberately don't call this — `hidden`
 * means unlisted, not unreachable.
 */
export function filterByVisibility(
  products: ProductSummary[],
  context: CatalogContext,
): ProductSummary[] {
  const allowed: ProductVisibility[] = context === 'search' ? ['visible', 'search'] : ['visible', 'catalog'];
  return products.filter((p) => allowed.includes(p.visibility));
}

/** Distinct attributes + values across a product set, for building filter UI. */
export function buildFacets(products: ProductSummary[]): ProductFacet[] {
  const byName = new Map<string, { display: FacetDisplay; values: Map<string, ProductFacetValue> }>();
  for (const p of products) {
    for (const f of p.facets) {
      // First product to carry the attribute decides how it is shown; the
      // structure is shared across products, so they cannot honestly disagree.
      const entry = byName.get(f.name) ?? { display: f.display, values: new Map() };
      for (const v of f.values) if (!entry.values.has(v.label)) entry.values.set(v.label, v);
      byName.set(f.name, entry);
    }
  }
  return [...byName.entries()]
    .map(([name, entry]) => ({
      name,
      display: entry.display,
      values: [...entry.values.values()].sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A facet value with how many products in the current view carry it. */
export interface FacetCountValue extends ProductFacetValue {
  count: number;
}

export interface FacetWithCounts {
  name: string;
  display: FacetDisplay;
  values: FacetCountValue[];
}

/**
 * The filter list with a count beside every value.
 *
 * Counts are DISJUNCTIVE: a value is counted against the query with its own
 * attribute's selections removed, but every other filter applied. Counting with
 * the whole query would show every unchosen colour as "(0)" the moment one was
 * picked — telling a shopper the shop has nothing else, when it is only their
 * own choice narrowing the view.
 *
 * A value nothing matches stays in the list at zero rather than disappearing,
 * so the list does not reshuffle under the pointer as choices change.
 */
export function buildFacetCounts(
  products: ProductSummary[],
  opts: ProductQueryOptions = {},
): FacetWithCounts[] {
  return buildFacets(products).map((facet) => {
    // Everything except this attribute's own choice.
    const attrs = { ...(opts.attrs ?? {}) };
    delete attrs[facet.name];
    // Unpaged on purpose — see `filterProducts`.
    const pool = filterProducts(products, { ...opts, attrs });

    return {
      name: facet.name,
      display: facet.display,
      values: facet.values.map((value) => ({
        ...value,
        count: pool.filter((p) =>
          p.facets.some((f) => f.name === facet.name && f.values.some((v) => v.label === value.label)),
        ).length,
      })),
    };
  });
}

/**
 * The ends of the price slider for a product list: the cheapest and dearest
 * price anyone could actually pay, rounded outwards so no product sits outside
 * the track. `null` for an empty list — there is no range to offer.
 */
export function priceBounds(products: ProductSummary[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of products) {
    const range = productPriceRange(p);
    if (!range) continue;
    min = Math.min(min, range.min);
    max = Math.max(max, range.max);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min: Math.floor(min), max: Math.ceil(max) };
}

/**
 * What a product can cost: its variation range when it has one, otherwise its
 * single price. `null` when the price is unusable, so a broken document cannot
 * drag a slider's end to NaN.
 */
export function productPriceRange(p: ProductSummary): { min: number; max: number } | null {
  const range = p.priceRange;
  if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
    return { min: Math.min(range.min, range.max), max: Math.max(range.min, range.max) };
  }
  return Number.isFinite(p.price) ? { min: p.price, max: p.price } : null;
}

/**
 * Distinct tags across a product set, for the sidebar tag filter (§6). Deduped
 * by slug, sorted by label — the counterpart of `buildFacets` for tags.
 */
export function buildTagFacet(products: ProductSummary[]): ProductTagRef[] {
  const bySlug = new Map<string, ProductTagRef>();
  for (const p of products) {
    for (const tag of p.tags) if (!bySlug.has(tag.slug)) bySlug.set(tag.slug, tag);
  }
  return [...bySlug.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function matchesAttrs(product: ProductSummary, attrs: Record<string, string[]>): boolean {
  for (const [name, vals] of Object.entries(attrs)) {
    if (vals.length === 0) continue;
    const facet = product.facets.find((f) => f.name === name);
    if (!facet || !vals.some((v) => facet.values.some((fv) => fv.label === v))) return false;
  }
  return true;
}

export interface ProductQueryResult {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Apply a keyword search + sort + pagination to a product list, in memory.
 * The source list is already newest-first (publishedAt desc), so `'newest'`
 * keeps source order. Pure — usable over `listProducts`/category results.
 */
/**
 * The filter step alone: keyword, price, attributes and tags, with no sort and
 * no pagination. Split out of `applyProductQuery` because the facet counts need
 * to count the WHOLE matching set — going through the paged function capped
 * every count at one page of 48, so a shop with 300 red products said "Red (48)".
 */
export function filterProducts(
  products: ProductSummary[],
  opts: ProductQueryOptions = {},
): ProductSummary[] {
  const q = (opts.q ?? '').trim().toLowerCase();
  const attrs = opts.attrs ?? {};
  const hasAttrs = Object.values(attrs).some((v) => v.length > 0);
  const tags = (opts.tags ?? []).filter(Boolean);

  return products.filter((p) => {
    if (
      q &&
      !(p.title.toLowerCase().includes(q) || (p.subtitle?.toLowerCase().includes(q) ?? false))
    ) {
      return false;
    }
    /*
     * A product with variations has a RANGE, and this compared its base price
     * only — so a chair listed at €100 whose small version costs €20 was absent
     * from "up to €50". It qualifies when its range OVERLAPS the filter, which
     * is also what the slider's ends are built from, so the two always agree.
     */
    if (opts.minPrice != null || opts.maxPrice != null) {
      const range = productPriceRange(p);
      if (!range) return false;
      if (opts.minPrice != null && range.max < opts.minPrice) return false;
      if (opts.maxPrice != null && range.min > opts.maxPrice) return false;
    }
    if (hasAttrs && !matchesAttrs(p, attrs)) return false;
    if (tags.length > 0 && !p.tags.some((t) => tags.includes(t.slug))) return false;
    return true;
  });
}

export function applyProductQuery(
  products: ProductSummary[],
  opts: ProductQueryOptions = {},
): ProductQueryResult {
  const pageSize = Math.min(48, Math.max(1, opts.pageSize ?? 12));
  const page = Math.max(1, opts.page ?? 1);

  let items = filterProducts(products, opts);

  switch (opts.sort) {
    case 'price-asc':
      items = [...items].sort((a, b) => a.price - b.price);
      break;
    case 'price-desc':
      items = [...items].sort((a, b) => b.price - a.price);
      break;
    case 'name':
      items = [...items].sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'manual': {
      // Manual/menu order: lower first; unset (null) sorts after, keeping the
      // source (newest) order among the un-numbered tail. Stable.
      const rank = (p: ProductSummary) => (p.menuOrder == null ? Number.MAX_SAFE_INTEGER : p.menuOrder);
      items = items
        .map((p, i) => [p, i] as const)
        .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
        .map(([p]) => p);
      break;
    }
    default:
      // 'newest' — keep source order, but float featured products to the top.
      // An explicit price/name sort stays exactly what it says on the tin.
      if (items.some((p) => p.featured)) {
        items = [...items].sort((a, b) => Number(b.featured) - Number(a.featured));
      }
      break;
  }

  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pageSize };
}

// ── Categories ───────────────────────────────────────────────────────────────

export interface CategorySummary {
  slug: string;
  title: string;
  href: string;
}

/** All published categories, titles resolved for `locale`, deduped by slug. */
export async function listCategories(locale: string): Promise<CategorySummary[]> {
  const db = getDb();
  const rows = await db
    .select({ slug: schema.documents.slug, data: schema.documents.data })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, DEFAULT_CATEGORY_TYPE), eq(schema.documents.status, 'published')));

  const bySlug = new Map<string, CategorySummary>();
  for (const r of rows) {
    if (bySlug.has(r.slug)) continue;
    const data = r.data as Record<string, unknown>;
    bySlug.set(r.slug, {
      slug: r.slug,
      title: resolveLoc(data.title as Localized, locale) || r.slug,
      href: `${DEFAULT_PATH_PREFIX}/category/${r.slug}`,
    });
  }
  return [...bySlug.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Resolve a product's `categories` relation ids to display chips, order-preserved. */
export async function getCategoriesByIds(ids: number[], locale: string): Promise<CategorySummary[]> {
  const validIds = ids.filter((n) => Number.isInteger(n) && n > 0);
  if (validIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ id: schema.documents.id, slug: schema.documents.slug, data: schema.documents.data })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, DEFAULT_CATEGORY_TYPE), inArray(schema.documents.id, validIds)));

  const byId = new Map(rows.map((r) => [r.id, r]));
  return validIds
    .map((id) => byId.get(id))
    .filter((r): r is (typeof rows)[number] => Boolean(r))
    .map((r) => ({
      slug: r.slug,
      title: resolveLoc((r.data as Record<string, unknown>).title as Localized, locale) || r.slug,
      href: `${DEFAULT_PATH_PREFIX}/category/${r.slug}`,
    }));
}

export interface CategoryProducts {
  category: CategorySummary;
  /** The category document itself — the row the admin edits. */
  document: { type: string; id: number; locale: string };
  products: ProductSummary[];
}

/**
 * Products in a category (published, in `locale`), joined through
 * `document_relations`. Returns null when the category slug doesn't exist.
 *
 * Cached like every other published read: `generateMetadata` and the page
 * component both call this in the same request, so uncached it ran the category
 * lookup, the join, the currency read and the tag index twice per render on a
 * `force-dynamic` route. Tagged on both types it reads, so `revalidateType()`
 * on a product *or* a category write already purges it.
 */
export function listProductsByCategory(
  categorySlug: string,
  locale: string,
): Promise<CategoryProducts | null> {
  return unstable_cache(
    () => readProductsByCategory(categorySlug, locale),
    ['cms-products-by-category', categorySlug, locale],
    {
      tags: [typeTag(DEFAULT_PRODUCT_TYPE), typeTag(DEFAULT_CATEGORY_TYPE)],
      revalidate: CMS_CACHE_REVALIDATE,
    },
  )();
}

/**
 * The row of a category or tag to show for `locale`: that locale's row, or —
 * when the term was never translated — any row, so the page still resolves.
 *
 * The lookup used to be `LIMIT 1` by slug alone, so on a multilingual site it
 * could land on another locale's row: wrong title, wrong admin edit link, and a
 * join against a row this locale's products are not related to.
 */
export function pickTermRow<T extends { locale: string }>(rows: readonly T[], locale: string): T | undefined {
  return rows.find((row) => row.locale === locale) ?? rows[0];
}

async function readProductsByCategory(
  categorySlug: string,
  locale: string,
): Promise<CategoryProducts | null> {
  const db = getDb();
  // Every locale's row of the term: the page shows this locale's, and the
  // join below accepts a product related to any of them.
  const terms = await db
    .select({
      id: schema.documents.id,
      slug: schema.documents.slug,
      locale: schema.documents.locale,
      data: schema.documents.data,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, DEFAULT_CATEGORY_TYPE), eq(schema.documents.slug, categorySlug)));
  const cat = pickTermRow(terms, locale);
  if (!cat) return null;

  const [rows, currency, tagIndex] = await Promise.all([
    db
      .select({ doc: schema.documents })
      .from(schema.documents)
      .innerJoin(schema.documentRelations, eq(schema.documentRelations.fromId, schema.documents.id))
      .where(
        and(
          inArray(schema.documentRelations.toId, terms.map((t) => t.id)),
          eq(schema.documentRelations.fieldKey, 'categories'),
          eq(schema.documents.type, DEFAULT_PRODUCT_TYPE),
          eq(schema.documents.locale, locale),
          eq(schema.documents.status, 'published'),
        ),
      )
      .orderBy(desc(schema.documents.updatedAt)),
    getSiteCurrency(),
    loadTagIndex(locale),
  ]);

  return {
    category: {
      slug: cat.slug,
      title: resolveLoc((cat.data as Record<string, unknown>).title as Localized, locale) || cat.slug,
      href: `${DEFAULT_PATH_PREFIX}/category/${cat.slug}`,
    },
    document: { type: DEFAULT_CATEGORY_TYPE, id: cat.id, locale: cat.locale },
    products: rows.map((r) => toSummary(r.doc, DEFAULT_PATH_PREFIX, currency, locale, tagIndex)),
  };
}

// ── Tags (§6) ──────────────────────────────────────────────────────────────

const DEFAULT_TAG_TYPE = 'tag';

export interface TagSummary {
  slug: string;
  title: string;
  href: string;
}

/** All published tags, titles resolved for `locale`, deduped by slug. */
export async function listTags(locale: string): Promise<TagSummary[]> {
  const db = getDb();
  const rows = await db
    .select({ slug: schema.documents.slug, data: schema.documents.data })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, DEFAULT_TAG_TYPE), eq(schema.documents.status, 'published')));

  const bySlug = new Map<string, TagSummary>();
  for (const r of rows) {
    if (bySlug.has(r.slug)) continue;
    const data = r.data as Record<string, unknown>;
    bySlug.set(r.slug, {
      slug: r.slug,
      title: resolveLoc(data.title as Localized, locale) || r.slug,
      href: `${DEFAULT_PATH_PREFIX}/tag/${r.slug}`,
    });
  }
  return [...bySlug.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Tag-relation id → `{ slug, title }`, for projecting `data.tags` onto card
 * summaries (§6). A relation id points at one locale's row, so titles are taken
 * from the row matching `locale` (by slug) and fall back to the referenced row.
 */
async function loadTagIndex(locale: string): Promise<Map<number, ProductTagRef>> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.documents.id,
      slug: schema.documents.slug,
      locale: schema.documents.locale,
      data: schema.documents.data,
    })
    .from(schema.documents)
    .where(eq(schema.documents.type, DEFAULT_TAG_TYPE));

  const titleOf = (r: (typeof rows)[number]) =>
    resolveLoc((r.data as Record<string, unknown>).title as Localized, locale) || r.slug;

  const titleBySlug = new Map<string, string>();
  for (const r of rows) if (r.locale === locale) titleBySlug.set(r.slug, titleOf(r));

  const index = new Map<number, ProductTagRef>();
  for (const r of rows) index.set(r.id, { slug: r.slug, title: titleBySlug.get(r.slug) ?? titleOf(r) });
  return index;
}

/** Resolve a product's `tags` relation ids to display chips, order-preserved. */
export async function getTagsByIds(ids: number[], locale: string): Promise<TagSummary[]> {
  const validIds = ids.filter((n) => Number.isInteger(n) && n > 0);
  if (validIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ id: schema.documents.id, slug: schema.documents.slug, data: schema.documents.data })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, DEFAULT_TAG_TYPE), inArray(schema.documents.id, validIds)));

  const byId = new Map(rows.map((r) => [r.id, r]));
  return validIds
    .map((id) => byId.get(id))
    .filter((r): r is (typeof rows)[number] => Boolean(r))
    .map((r) => ({
      slug: r.slug,
      title: resolveLoc((r.data as Record<string, unknown>).title as Localized, locale) || r.slug,
      href: `${DEFAULT_PATH_PREFIX}/tag/${r.slug}`,
    }));
}

export interface TagProducts {
  tag: TagSummary;
  /** The tag document itself — the row the admin edits. */
  document: { type: string; id: number; locale: string };
  products: ProductSummary[];
}

/**
 * Products carrying a tag (published, in `locale`), joined through
 * `document_relations`. Returns null when the tag slug doesn't exist.
 *
 * Cached for the same reason as `listProductsByCategory` — see the note there.
 */
export function listProductsByTag(
  tagSlug: string,
  locale: string,
): Promise<TagProducts | null> {
  return unstable_cache(
    () => readProductsByTag(tagSlug, locale),
    ['cms-products-by-tag', tagSlug, locale],
    {
      tags: [typeTag(DEFAULT_PRODUCT_TYPE), typeTag(DEFAULT_TAG_TYPE)],
      revalidate: CMS_CACHE_REVALIDATE,
    },
  )();
}

async function readProductsByTag(
  tagSlug: string,
  locale: string,
): Promise<TagProducts | null> {
  const db = getDb();
  // Every locale's row of the term: the page shows this locale's, and the
  // join below accepts a product related to any of them.
  const terms = await db
    .select({
      id: schema.documents.id,
      slug: schema.documents.slug,
      locale: schema.documents.locale,
      data: schema.documents.data,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, DEFAULT_TAG_TYPE), eq(schema.documents.slug, tagSlug)));
  const tag = pickTermRow(terms, locale);
  if (!tag) return null;

  const [rows, currency, tagIndex] = await Promise.all([
    db
      .select({ doc: schema.documents })
      .from(schema.documents)
      .innerJoin(schema.documentRelations, eq(schema.documentRelations.fromId, schema.documents.id))
      .where(
        and(
          inArray(schema.documentRelations.toId, terms.map((t) => t.id)),
          eq(schema.documentRelations.fieldKey, 'tags'),
          eq(schema.documents.type, DEFAULT_PRODUCT_TYPE),
          eq(schema.documents.locale, locale),
          eq(schema.documents.status, 'published'),
        ),
      )
      .orderBy(desc(schema.documents.updatedAt)),
    getSiteCurrency(),
    loadTagIndex(locale),
  ]);

  return {
    tag: {
      slug: tag.slug,
      title: resolveLoc((tag.data as Record<string, unknown>).title as Localized, locale) || tag.slug,
      href: `${DEFAULT_PATH_PREFIX}/tag/${tag.slug}`,
    },
    document: { type: DEFAULT_TAG_TYPE, id: tag.id, locale: tag.locale },
    products: rows.map((r) => toSummary(r.doc, DEFAULT_PATH_PREFIX, currency, locale, tagIndex)),
  };
}

/** One published product document by slug (full `data`), or null. */
export function getProduct(
  slug: string,
  locale: string,
  opts: { type?: string } = {},
): Promise<DocumentRow | null> {
  return getPublishedDocument(opts.type ?? DEFAULT_PRODUCT_TYPE, slug, locale);
}

/**
 * The effective price for a product + optionally a selected variation (by its
 * `id`). Falls back to the base price when the variation has no price override.
 * Storefront variation *selection* (mapping chosen swatches → a variation) is
 * still to come; this resolves a price once a variation is identified.
 */
export function resolvePrice(data: Record<string, unknown>, variationId?: string): number {
  const base = Number(data.price ?? 0);
  if (!variationId) return base;
  const variations = Array.isArray(data.variations) ? (data.variations as ProductVariation[]) : [];
  const v = variations.find((x) => x.id === variationId);
  return v?.price != null ? Number(v.price) : base;
}

// ── Grouped products (§5) ──────────────────────────────────────────────────

export interface GroupedComponent {
  slug: string;
  title: string;
  quantity: number;
  price: number;
  currency: string;
  image?: GalleryImage;
  href: string;
  availability: string;
}

/** A raw grouped-component entry as stored on the product (`data.components`). */
export interface ComponentEntry {
  product?: number;
  quantity?: number;
}

/** Sum of `price × quantity` over resolved components (major units). Pure. */
export function groupedTotal(components: { price: number; quantity: number }[]): number {
  return components.reduce((sum, c) => sum + c.price * Math.max(1, c.quantity || 1), 0);
}

/**
 * Resolve a grouped product's component entries (a stored relation id + qty)
 * into locale-correct card summaries, order preserved. Because a relation id
 * points at one locale row, we resolve each through its (shared) slug to the
 * published row for `locale`. Missing / unpublished components are dropped.
 */
export async function getGroupedComponents(
  entries: ComponentEntry[],
  locale: string,
): Promise<GroupedComponent[]> {
  const valid = entries.filter((e) => Number.isInteger(e.product) && (e.product as number) > 0);
  if (valid.length === 0) return [];

  const db = getDb();
  const ids = [...new Set(valid.map((e) => e.product as number))];
  // id → slug (the referenced rows, any locale).
  const refRows = await db
    .select({ id: schema.documents.id, slug: schema.documents.slug })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, DEFAULT_PRODUCT_TYPE), inArray(schema.documents.id, ids)));
  const slugById = new Map(refRows.map((r) => [r.id, r.slug]));

  const slugs = [...new Set(refRows.map((r) => r.slug))];
  const [localeRows, currency] = await Promise.all([
    slugs.length
      ? db
          .select()
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.type, DEFAULT_PRODUCT_TYPE),
              eq(schema.documents.locale, locale),
              eq(schema.documents.status, 'published'),
              inArray(schema.documents.slug, slugs),
            ),
          )
      : Promise.resolve([]),
    getSiteCurrency(),
  ]);
  const docBySlug = new Map(localeRows.map((r) => [r.slug, r]));

  const out: GroupedComponent[] = [];
  for (const entry of valid) {
    const slug = slugById.get(entry.product as number);
    const doc = slug ? docBySlug.get(slug) : undefined;
    if (!doc) continue;
    const data = doc.data as Record<string, unknown>;
    const gallery = Array.isArray(data.gallery) ? (data.gallery as GalleryImage[]) : [];
    out.push({
      slug: doc.slug,
      title: String(data.title ?? doc.metaTitle ?? doc.slug),
      quantity: Math.max(1, Math.floor(Number(entry.quantity) || 1)),
      price: Number(data.price ?? 0),
      currency,
      image: gallery[0],
      href: `${DEFAULT_PATH_PREFIX}/${doc.slug}`,
      availability: String(data.availability ?? 'in-stock'),
    });
  }
  return out;
}

/** Locale-aware currency formatting. Falls back to `amount currency` on error. */
export function formatPrice(amount: number, currency: string, locale = 'el'): string {
  const intlLocale = locale === 'el' ? 'el-GR' : locale === 'en' ? 'en-US' : locale;
  try {
    return new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
