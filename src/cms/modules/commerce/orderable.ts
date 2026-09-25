/**
 * Whether a cart line may be bought at all — decided at checkout, from the
 * product documents, before it is priced.
 *
 * The storefront already hides or disables most of these (an unpublished
 * product has no page, a disabled variation cannot be picked, "Out of stock"
 * greys out Add to cart, an external product links away), but the checkout
 * body comes from the browser and names products by slug and variation id, so
 * none of that is a control. This is.
 *
 * Pure and dependency-free so it is unit-tested directly
 * (`test/commerce/orderable.test.ts`).
 */

interface RowLike {
  status: string;
  locale: string;
}

/**
 * The product row a checkout line is priced from: the published row in the
 * shopper's locale, else any published row (stock and price are shared across
 * locales). Never an unpublished one — a draft, or a product taken off sale by
 * unpublishing it, cannot be ordered by typing its slug.
 */
export function orderableRow<T extends RowLike>(rows: readonly T[], locale: string): T | undefined {
  return (
    rows.find((r) => r.status === 'published' && r.locale === locale) ??
    rows.find((r) => r.status === 'published')
  );
}

export type LineUnavailable = 'external' | 'unknown_variation' | 'variation_disabled' | 'out_of_stock';

interface VariationLike {
  id?: string;
  enabled?: boolean;
  stock?: number;
}

/**
 * Why this product (and chosen variation) cannot be sold, or null when it can.
 *
 * - `external`: an affiliate product has no checkout here.
 * - `unknown_variation`: a variation id that matches nothing. It used to be
 *   charged the base price.
 * - `variation_disabled`: the variation is switched off in the editor.
 * - `out_of_stock`: `availability` says so and stock is NOT tracked. With a
 *   stock number the quantity check (`ensureStock`) is the authority instead.
 */
export function lineUnavailableReason(
  data: Record<string, unknown>,
  variationId: string | undefined,
): LineUnavailable | null {
  if (data.productType === 'external') return 'external';

  const variations = (Array.isArray(data.variations) ? data.variations : []) as VariationLike[];
  const variation = variationId ? variations.find((v) => v.id === variationId) : undefined;
  if (variationId && !variation) return 'unknown_variation';
  if (variation && variation.enabled === false) return 'variation_disabled';

  const tracked = typeof data.stock === 'number' || typeof variation?.stock === 'number';
  if (!tracked && data.availability === 'out-of-stock') return 'out_of_stock';

  return null;
}
