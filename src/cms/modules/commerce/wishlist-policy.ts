/**
 * The wishlist, without a database.
 *
 * ## What is stored, and where
 *
 * Only product and variant ids. Prices, names and stock are read live when the
 * wishlist page is opened, so a saved item can never show a price the shop no
 * longer charges — and there is nothing in the stored value worth protecting.
 *
 * A guest's list lives in `localStorage`, with a first-party cookie as the
 * fallback for a browser that refuses it. The cookie is why the format is as
 * terse as it is: a cookie rides along with every request the site makes,
 * images included, so `12:red,34` beats JSON several times over.
 *
 * A signed-in customer's list lives in `wishlist_items` instead, and the device
 * list is merged into it once, at sign-in.
 */

export interface WishlistItem {
  productId: number;
  /** '' when the product has no variants — see the schema note on NULLs. */
  variationId: string;
}

export const DEFAULT_WISHLIST_MAX_ITEMS = 100;
const MAX_ALLOWED_ITEMS = 200;
const MAX_VARIATION_ID = 64;

/** Two entries are the same when the product AND the variant match. */
export function sameWishlistItem(
  a: { productId: number; variationId?: string },
  b: { productId: number; variationId?: string }
): boolean {
  return a.productId === b.productId && (a.variationId ?? '') === (b.variationId ?? '');
}

/**
 * `12:red,34` — product id, optional `:variant`, comma separated.
 *
 * The separators are stripped from the variant id rather than escaped: a
 * variant id containing a comma would otherwise decode as two entries, and an
 * id is a slug-like token that never legitimately contains one.
 */
export function encodeWishlistCookie(items: readonly WishlistItem[]): string {
  return items
    .slice(0, DEFAULT_WISHLIST_MAX_ITEMS)
    .map((item) => {
      const variation = item.variationId.replace(/[,:]/g, '').slice(0, MAX_VARIATION_ID);
      return variation ? `${item.productId}:${variation}` : String(item.productId);
    })
    .join(',');
}

/** The reverse, forgiving everything: the cookie is client-writable. */
export function decodeWishlistCookie(raw: string): WishlistItem[] {
  if (!raw) return [];
  const items: WishlistItem[] = [];
  for (const part of raw.split(',')) {
    if (!part) continue;
    const [idPart, variationPart = ''] = part.split(':');
    const productId = Number(idPart);
    if (!Number.isSafeInteger(productId) || productId <= 0) continue;
    const item = { productId, variationId: variationPart.slice(0, MAX_VARIATION_ID) };
    if (!items.some((existing) => sameWishlistItem(existing, item))) items.push(item);
    if (items.length >= DEFAULT_WISHLIST_MAX_ITEMS) break;
  }
  return items;
}

/**
 * One list out of two, at sign-in. The account's own list comes first and wins
 * the cap: what a customer deliberately saved to their account should not be
 * pushed out by whatever a shared browser happened to be holding.
 */
export function mergeWishlists(
  server: readonly WishlistItem[],
  device: readonly WishlistItem[],
  maxItems: number
): WishlistItem[] {
  const out: WishlistItem[] = [];
  for (const item of [...server, ...device]) {
    if (out.length >= maxItems) break;
    if (!out.some((existing) => sameWishlistItem(existing, item))) out.push(item);
  }
  return out;
}

export interface WishlistConfig {
  enabled: boolean;
  maxItems: number;
  /** Anonymous "added to wishlist" counts per product, for the admin. */
  trackStats: boolean;
}

/** The `site_settings` key holding the structured wishlist config. */
export const ECOMMERCE_WISHLIST_KEY = 'ecommerce.wishlist';

export function parseWishlistConfig(raw: unknown): WishlistConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  const rawMax = value.maxItems;
  const maxItems =
    typeof rawMax === 'number' && Number.isFinite(rawMax)
      ? Math.min(MAX_ALLOWED_ITEMS, Math.max(1, Math.floor(rawMax)))
      : DEFAULT_WISHLIST_MAX_ITEMS;
  return {
    enabled: value.enabled === true,
    maxItems,
    trackStats: value.trackStats === true,
  };
}
