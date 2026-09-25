/**
 * Instant-search / autocomplete (addendum §6).
 *
 * A thin public endpoint over the existing catalog read — reuses `listProducts`
 * (cached) + `applyProductQuery` (the same keyword/sort logic the shop grid
 * uses), so suggestions match the full search exactly. Returns a slim
 * projection for the typeahead dropdown. Search-only + visible products qualify
 * (a keyword makes this a search context, like the shop page).
 */
import 'server-only';

import { z } from 'zod';

import { createRoute, ok } from '../../core';
import { localeOrDefault } from '../../core/paths';
import { applyProductQuery, filterByVisibility, listProducts } from './read';

export interface SearchSuggestion {
  slug: string;
  title: string;
  subtitle?: string;
  price: number;
  currency: string;
  /** Gallery-image uuid (the client builds the media URL). */
  image?: string;
  href: string;
}

/** Top matches for `q`, newest-relevant first. Empty for a blank query. */
export async function searchProducts(
  locale: string,
  q: string,
  limit = 8,
): Promise<SearchSuggestion[]> {
  if (!q.trim()) return [];
  const all = filterByVisibility(await listProducts(locale, { limit: 1000 }), 'search');
  const { items } = applyProductQuery(all, { q, pageSize: limit, page: 1 });
  return items.map((p) => ({
    slug: p.slug,
    title: p.title,
    subtitle: p.subtitle,
    price: p.price,
    currency: p.currency,
    image: p.image?.image,
    href: p.href,
  }));
}

const searchQuery = z.object({
  q: z.string().max(200).optional(),
  locale: z.string().max(8).optional(),
});

/** Public GET — suggestions for the typeahead. Mount from a module-gated binder. */
export function createProductSearchRoute(opts: {
  /** The site's default locale (`config.defaultLocale`), searched when the request names none. */
  defaultLocale: string;
}) {
  return createRoute({
    rateLimit: { scope: 'commerce-search', max: 60, windowMs: 60_000 },
    query: searchQuery,
    handler: async ({ query }) =>
      ok(await searchProducts(localeOrDefault(query?.locale, opts.defaultLocale), query?.q || '')),
  });
}
