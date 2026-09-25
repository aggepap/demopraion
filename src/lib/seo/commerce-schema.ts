/**
 * Commerce JSON-LD builders (schema.org `Product` / `Offer` / `ItemList`).
 *
 * Kept beside the general `schemas.ts` AEO helpers but in its own file so the
 * commerce concern stays isolated — these are the only builders that reason
 * about price, currency and stock. Pure and dependency-light (only `SITE_URL`
 * and the `Locale` type), so they unit-test without a DB and compose into the
 * same `@graph` the rest of the site emits.
 *
 * Source of truth for field intent: `docs/ECOMMERCE-ADDENDUM.md` §7.
 * Prices are MAJOR units (e.g. 49.99) — the same unit product `data.price`
 * stores and the storefront displays.
 */
import { localePrefix } from '@/cms/core/paths';
import { defaultLocale, type Locale } from '@/lib/i18n/config';

import { SITE_URL } from './schemas';

/** Absolute URL for a site-relative path, with the locale prefix Google expects. */
export function localeUrl(path: string, locale: Locale): string {
  return `${SITE_URL}${localePrefix(locale, defaultLocale)}${path.replace(/\/+$/, '')}`;
}

/**
 * Product availability enum → schema.org `ItemAvailability`. `made-to-order`
 * has no exact schema.org member; `PreOrder` is the closest honest mapping
 * ("orderable now, not shipping immediately").
 */
export function availabilityToSchema(availability: string): string {
  switch (availability) {
    case 'out-of-stock':
      return 'https://schema.org/OutOfStock';
    case 'preorder':
      return 'https://schema.org/PreOrder';
    case 'made-to-order':
      return 'https://schema.org/PreOrder';
    default:
      return 'https://schema.org/InStock';
  }
}

/**
 * Product availability enum → the Open Graph `product:availability` /
 * `og:availability` vocabulary (Facebook, Pinterest). Distinct from the
 * schema.org mapping — the OG vocab is a different, smaller set of strings.
 */
export function availabilityToOg(availability: string): string {
  switch (availability) {
    case 'out-of-stock':
      return 'out of stock';
    case 'preorder':
      return 'preorder';
    case 'made-to-order':
      return 'available for order';
    default:
      return 'in stock';
  }
}

/** Product condition enum → schema.org `OfferItemCondition`. */
export function conditionToSchema(condition: string | undefined): string {
  switch (condition) {
    case 'refurbished':
      return 'https://schema.org/RefurbishedCondition';
    case 'used':
      return 'https://schema.org/UsedCondition';
    default:
      return 'https://schema.org/NewCondition';
  }
}

/** schema.org wants prices as a plain decimal string with 2 places. */
export function priceString(amount: number): string {
  return amount.toFixed(2);
}

export interface AggregateRatingInput {
  ratingValue: number;
  reviewCount: number;
}

export interface ReviewInput {
  author: string;
  ratingValue: number;
  body?: string;
  title?: string;
  /** ISO date (or any `Date`-parseable string). */
  datePublished?: string;
}

export interface ProductSchemaArgs {
  name: string;
  description?: string;
  /** Site-relative path with leading slash, no locale prefix — e.g. `/shop/x`. */
  path: string;
  locale: Locale;
  /** Absolute image URLs (gallery), first is primary. */
  images?: string[];
  sku?: string;
  gtin?: string;
  mpn?: string;
  brand?: string;
  /** `new` | `refurbished` | `used`. */
  condition?: string;
  currency: string;
  availability: string;
  /** Base price (major units). */
  price: number;
  /**
   * Enabled variation prices (major units). When two or more distinct values
   * exist the offer becomes an `AggregateOffer` with low/high; otherwise a
   * single `Offer` at `price`.
   */
  variantPrices?: number[];
  /** Resolved category name, surfaced as `category`. */
  category?: string;
  /**
   * Approved-review aggregate. Emitted only when there is at least one review —
   * inventing ratings is a structured-data policy violation.
   */
  aggregateRating?: AggregateRatingInput;
  /** Individual approved reviews (a bounded sample), emitted as `review` nodes. */
  reviews?: ReviewInput[];
}

function offerFragment(args: ProductSchemaArgs) {
  const url = localeUrl(args.path, args.locale);
  const common = {
    priceCurrency: args.currency,
    availability: availabilityToSchema(args.availability),
    itemCondition: conditionToSchema(args.condition),
    url,
  };

  const distinct = [...new Set((args.variantPrices ?? []).filter((p) => Number.isFinite(p) && p > 0))];
  if (distinct.length > 1) {
    return {
      '@type': 'AggregateOffer',
      offerCount: distinct.length,
      lowPrice: priceString(Math.min(...distinct)),
      highPrice: priceString(Math.max(...distinct)),
      ...common,
    };
  }

  return {
    '@type': 'Offer',
    price: priceString(distinct[0] ?? args.price),
    ...common,
  };
}

/**
 * A `Product` node with a nested `Offer` / `AggregateOffer`. Emitted per PDP so
 * search + AI engines that read structured data (not just OG tags) get price,
 * availability, condition and the merchant identifiers from §1.
 */
export function productSchema(args: ProductSchemaArgs): Record<string, unknown> {
  const url = localeUrl(args.path, args.locale);
  const node: Record<string, unknown> = {
    '@type': 'Product',
    '@id': `${url}#product`,
    name: args.name,
    ...(args.description ? { description: args.description } : {}),
    ...(args.images?.length ? { image: args.images } : {}),
    ...(args.sku ? { sku: args.sku } : {}),
    ...(args.gtin ? { gtin: args.gtin } : {}),
    ...(args.mpn ? { mpn: args.mpn } : {}),
    ...(args.brand ? { brand: { '@type': 'Brand', name: args.brand } } : {}),
    ...(args.category ? { category: args.category } : {}),
    inLanguage: args.locale,
    offers: offerFragment(args),
    ...(args.aggregateRating && args.aggregateRating.reviewCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: args.aggregateRating.ratingValue,
            reviewCount: args.aggregateRating.reviewCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(args.reviews?.length
      ? {
          review: args.reviews.map((r) => ({
            '@type': 'Review',
            author: { '@type': 'Person', name: r.author },
            reviewRating: {
              '@type': 'Rating',
              ratingValue: r.ratingValue,
              bestRating: 5,
              worstRating: 1,
            },
            ...(r.title ? { name: r.title } : {}),
            ...(r.body ? { reviewBody: r.body } : {}),
            ...(r.datePublished ? { datePublished: r.datePublished } : {}),
          })),
        }
      : {}),
  };
  return node;
}

export interface ItemListEntry {
  name: string;
  /** Site-relative path with leading slash, no locale prefix. */
  path: string;
}

/**
 * An `ItemList` of products for a listing page (shop / category), ordered as
 * shown. Uses `url` items rather than embedded `Product` nodes to keep the
 * payload light — the linked PDP carries the full product graph.
 */
export function itemListSchema(items: ReadonlyArray<ItemListEntry>, locale: Locale): Record<string, unknown> {
  return {
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      url: localeUrl(item.path, locale),
    })),
  };
}
