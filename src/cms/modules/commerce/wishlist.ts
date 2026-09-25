import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { createRoute } from '../../core/api/handler';
import { ok } from '../../core/api/respond';
import { badRequest } from '../../core/errors';
import { getSetting } from '../../core/settings';
import { incrementCounter } from '../../core/stats/counters';
import { getDb, schema } from '../../db';
import { listPublishedDocuments } from '../../core/read';
import { getSiteCurrency, resolvePrice } from './read';
import {
  ECOMMERCE_WISHLIST_KEY,
  mergeWishlists,
  parseWishlistConfig,
  sameWishlistItem,
  type WishlistConfig,
  type WishlistItem,
} from './wishlist-policy';

/**
 * The wishlist's server half: the setting, the live resolve, and the rows a
 * signed-in customer's list is kept in.
 */

/** The scope `stat_counters` records anonymous "added to wishlist" counts under. */
export const WISHLIST_STAT_SCOPE = 'wishlist';

export async function getWishlistConfig(): Promise<WishlistConfig> {
  return parseWishlistConfig(await getSetting(ECOMMERCE_WISHLIST_KEY));
}

export interface WishlistEntry {
  productId: number;
  variationId: string;
  slug: string;
  title: string;
  href: string;
  image?: string;
  price: number;
  currency: string;
  /** What the shopper can do about it right now. */
  availability: 'in-stock' | 'out-of-stock';
  variantLabel?: string;
}

/**
 * Turn saved ids into something worth showing: the current price, the current
 * stock, and nothing at all for a product that has been unpublished or deleted.
 *
 * Silently dropping those is the point — a wishlist that lists a product nobody
 * can buy any more is worse than a shorter wishlist.
 */
export async function resolveWishlistItems(
  items: readonly WishlistItem[],
  locale: string,
  config: WishlistConfig
): Promise<WishlistEntry[]> {
  const wanted = items.slice(0, config.maxItems);
  if (wanted.length === 0) return [];

  const [docs, currency] = await Promise.all([
    listPublishedDocuments('product', locale, { limit: 1000 }),
    getSiteCurrency(),
  ]);
  const byId = new Map(docs.map((doc) => [doc.id, doc]));

  const entries: WishlistEntry[] = [];
  for (const item of wanted) {
    const doc = byId.get(item.productId);
    if (!doc) continue; // unpublished, deleted, or another locale's copy
    const data = doc.data as Record<string, unknown>;
    const variations = Array.isArray(data.variations)
      ? (data.variations as { id: string; stock?: number; enabled?: boolean }[])
      : [];
    const variation = item.variationId
      ? variations.find((v) => v.id === item.variationId)
      : undefined;
    // A variant that no longer exists is not shown as "the base product".
    if (item.variationId && !variation) continue;

    const stock = variation?.stock ?? (typeof data.stock === 'number' ? data.stock : undefined);
    const gallery = Array.isArray(data.gallery) ? (data.gallery as { image?: string }[]) : [];
    entries.push({
      productId: doc.id,
      variationId: item.variationId,
      slug: doc.slug,
      title: String(data.title ?? ''),
      href: `/shop/${doc.slug}`,
      image: gallery[0]?.image
        ? `/api/cms/media/file/${encodeURIComponent(gallery[0].image)}`
        : undefined,
      price: resolvePrice(data, item.variationId || undefined),
      currency,
      availability:
        (stock !== undefined && stock <= 0) || data.availability === 'out-of-stock'
          ? 'out-of-stock'
          : 'in-stock',
    });
  }
  return entries;
}

// ── A signed-in customer's rows ─────────────────────────────────────────────

export async function listWishlist(customerId: number): Promise<WishlistItem[]> {
  const rows = await getDb()
    .select({
      productId: schema.wishlistItems.productId,
      variationId: schema.wishlistItems.variationId,
    })
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.customerId, customerId))
    .orderBy(schema.wishlistItems.id);
  return rows;
}

export async function addToWishlist(
  customerId: number,
  item: WishlistItem,
  config: WishlistConfig
): Promise<WishlistItem[]> {
  const current = await listWishlist(customerId);
  if (current.some((existing) => sameWishlistItem(existing, item))) return current;
  if (current.length >= config.maxItems) return current;
  await getDb()
    .insert(schema.wishlistItems)
    .values({ customerId, productId: item.productId, variationId: item.variationId })
    // A double click is not an error; the unique key makes this a no-op.
    .onDuplicateKeyUpdate({ set: { variationId: item.variationId } });
  return listWishlist(customerId);
}

export async function removeFromWishlist(
  customerId: number,
  item: WishlistItem
): Promise<WishlistItem[]> {
  await getDb()
    .delete(schema.wishlistItems)
    .where(
      and(
        eq(schema.wishlistItems.customerId, customerId),
        eq(schema.wishlistItems.productId, item.productId),
        eq(schema.wishlistItems.variationId, item.variationId)
      )
    );
  return listWishlist(customerId);
}

/** Fold a device list into the account's, once, at sign-in. */
export async function mergeDeviceWishlist(
  customerId: number,
  device: readonly WishlistItem[],
  config: WishlistConfig
): Promise<WishlistItem[]> {
  const server = await listWishlist(customerId);
  const merged = mergeWishlists(server, device, config.maxItems);
  const added = merged.filter(
    (item) => !server.some((existing) => sameWishlistItem(existing, item))
  );
  if (added.length === 0) return server;

  // Only ids the shop actually has: the device list is client-supplied.
  const real = await getDb()
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      inArray(
        schema.documents.id,
        added.map((item) => item.productId)
      )
    );
  const known = new Set(real.map((row) => row.id));

  for (const item of added) {
    if (!known.has(item.productId)) continue;
    await getDb()
      .insert(schema.wishlistItems)
      .values({ customerId, productId: item.productId, variationId: item.variationId })
      .onDuplicateKeyUpdate({ set: { variationId: item.variationId } });
  }
  return listWishlist(customerId);
}

// ── Routes ──────────────────────────────────────────────────────────────────

const itemSchema = z.object({
  productId: z.coerce.number().int().positive(),
  variationId: z.string().trim().max(64).default(''),
});

const listSchema = z.object({ items: z.array(itemSchema).max(200) });

/**
 * `POST /api/cms/wishlist/resolve` — ids in, current prices and stock out.
 *
 * Public and unauthenticated, because a guest's list lives in their browser.
 * It reads published products only, so it cannot be used to discover drafts.
 */
export function wishlistResolveRoute(opts: { defaultLocale: string }) {
  return createRoute({
    rateLimit: { scope: 'wishlist-resolve', max: 60, windowMs: 60_000 },
    input: listSchema.extend({ locale: z.string().trim().max(8).optional() }),
    handler: async ({ input }) => {
      const config = await getWishlistConfig();
      if (!config.enabled) throw badRequest('Wishlist is not available.');
      const entries = await resolveWishlistItems(
        input.items,
        input.locale ?? opts.defaultLocale,
        config
      );
      return ok({ items: entries });
    },
  });
}

/**
 * `POST /api/cms/wishlist/track` — the anonymous "added to wishlist" counter.
 *
 * No visitor id, no session, no IP: one number per product per day, and only
 * when the shop has asked for the statistic.
 */
export function wishlistTrackRoute() {
  return createRoute({
    rateLimit: { scope: 'wishlist-track', max: 60, windowMs: 60_000 },
    input: itemSchema,
    handler: async ({ input }) => {
      const config = await getWishlistConfig();
      if (!config.enabled || !config.trackStats) return ok({ counted: false });
      await incrementCounter({
        scope: WISHLIST_STAT_SCOPE,
        subjectId: input.productId,
        metric: 'add',
      });
      return ok({ counted: true });
    },
  });
}

/**
 * The signed-in customer's list. The customer is resolved by the binder (this
 * module must not depend on the customers module), and every call is scoped to
 * whoever that is.
 */
export function customerWishlistRoutes(opts: {
  currentCustomerId: () => Promise<number | null>;
  defaultLocale: string;
}) {
  const requireCustomer = async () => {
    const id = await opts.currentCustomerId();
    if (id === null) throw badRequest('Sign in to use your wishlist.');
    return id;
  };

  return {
    GET: createRoute({
      handler: async ({ req }) => {
        const config = await getWishlistConfig();
        if (!config.enabled) throw badRequest('Wishlist is not available.');
        const customerId = await requireCustomer();
        const locale = new URL(req.url).searchParams.get('locale') ?? opts.defaultLocale;
        const items = await listWishlist(customerId);
        return ok({ items, entries: await resolveWishlistItems(items, locale, config) });
      },
    }),
    POST: createRoute({
      rateLimit: { scope: 'wishlist-write', max: 60, windowMs: 60_000 },
      input: z.union([
        itemSchema.extend({ action: z.literal('add') }),
        itemSchema.extend({ action: z.literal('remove') }),
        listSchema.extend({ action: z.literal('merge') }),
      ]),
      handler: async ({ input }) => {
        const config = await getWishlistConfig();
        if (!config.enabled) throw badRequest('Wishlist is not available.');
        const customerId = await requireCustomer();

        if (input.action === 'merge') {
          return ok({ items: await mergeDeviceWishlist(customerId, input.items, config) });
        }
        const item = { productId: input.productId, variationId: input.variationId };
        return ok({
          items:
            input.action === 'add'
              ? await addToWishlist(customerId, item, config)
              : await removeFromWishlist(customerId, item),
        });
      },
    }),
  };
}
