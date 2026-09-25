/**
 * Product reviews — guest-submitted, admin-moderated.
 *
 * Flow: a shopper posts a review from the PDP → it lands `pending` → an admin
 * approves it in the Reviews screen → it appears on the storefront and counts
 * toward the star average + the `AggregateRating` / `Review` JSON-LD (§7).
 *
 * Reviews are keyed by the product's `translationGroupId` (stable across
 * locales — see `db/.../schema/reviews.ts`), so a review shows on every language
 * of the same product.
 *
 * ## The "verified purchase" badge
 *
 * It is granted only when the reviewer supplies the **order reference** from
 * their confirmation email alongside the address that ordered — the same pair the
 * guest order-lookup authenticates on, and `lookupOrder` is literally the
 * function used, so there is one definition of "this person made this order".
 *
 * It used to be granted on the email alone: any non-cancelled order matching
 * `orders.email` for that product. Nothing proved the reviewer controlled the
 * address, so anyone holding a customer's email could post a review wearing the
 * badge — and, more to the point, the shop's own operators hold every customer
 * email in the admin, which made "verified purchase" a claim the site could
 * manufacture at will. Moderation does not close that: the badge exists to tell a
 * shopper that a purchase *record*, not a human's judgement, vouched for the
 * review, and a moderator cannot tell a real purchaser from someone who knew
 * their address.
 *
 * A review without a reference still publishes; it simply carries no badge. The
 * reference is ~50 bits of Crockford base32 (`orders.ts`), and this route is
 * capped at 3 submissions/minute, so guessing one is not a route in.
 *
 * Public submission rides the core route factory (same-origin + rate-limit +
 * zod + honeypot); moderation routes are guarded by the `reviews*` permissions.
 */
import 'server-only';

import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  createRoute,
  idParam,
  logAudit,
  notFound,
  ok,
  paginated,
} from '../../core';
import { adapter, getDb, schema } from '../../db';
import type { ReviewStatus } from '../../db/adapters/mysql/schema/reviews';
import { PERMISSIONS, requireApiPerm } from '../auth';
import { lookupOrder } from './orders';
import { DEFAULT_PRODUCT_TYPE, getProduct } from './read';
import { likeTerm } from '../../core/db/like';
import { localeOrDefault } from '../../core/paths';

export type { ReviewStatus } from '../../db/adapters/mysql/schema/reviews';

/** Order statuses that DON'T count as a purchase for the verified badge. */
const NON_PURCHASE_STATUSES = ['cancelled', 'refunded'] as const;

// ── Pure aggregate helper ─────────────────────────────────────────────────────

export interface RatingAggregate {
  count: number;
  /** Mean rating rounded to one decimal (0 when there are no reviews). */
  average: number;
}

/**
 * Average + count over a list of ratings, ignoring out-of-range values. Pure so
 * it unit-tests without a DB and can fold a fetched list when needed; the live
 * PDP aggregate is computed in SQL (`getRatingAggregate`).
 */
export function computeRatingAggregate(ratings: number[]): RatingAggregate {
  const valid = ratings.filter((r) => Number.isFinite(r) && r >= 1 && r <= 5);
  if (valid.length === 0) return { count: 0, average: 0 };
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  return { count: valid.length, average: Math.round(avg * 10) / 10 };
}

// ── Submission ────────────────────────────────────────────────────────────────

export interface ReviewInput {
  productSlug: string;
  rating: number;
  authorName: string;
  email: string;
  title?: string;
  body: string;
  locale?: string;
  /**
   * The order reference from the reviewer's confirmation email. Optional — supply
   * it and the review earns the "verified purchase" badge; omit it and the review
   * publishes without one.
   */
  orderReference?: string;
}

/** All document ids in a product's translation group (every locale row). */
async function productGroupDocIds(groupId: string): Promise<number[]> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.translationGroupId, groupId),
        eq(schema.documents.type, DEFAULT_PRODUCT_TYPE),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Does this order justify the badge?
 *
 * Pure, and separate from the lookup, because this is the rule — and a rule that
 * decides what a public trust marker claims is worth being able to test without a
 * database. Two conditions, both easy to get wrong:
 *
 * - the order must not be cancelled or refunded (`NON_PURCHASE_STATUSES`) — money
 *   that came back is not a purchase to vouch for;
 * - the order must contain *this* product. Holding a real reference proves you
 *   bought something, not that you bought the thing you are reviewing. Any locale
 *   row of the group counts, since one product has a row per language.
 *
 * `productId` is nullable (`on delete set null`), so a line whose product was
 * deleted matches nothing rather than matching everything.
 */
export function orderQualifiesForBadge(
  order: { status: string; items: ReadonlyArray<{ productId: number | null }> },
  docIds: readonly number[],
): boolean {
  if ((NON_PURCHASE_STATUSES as readonly string[]).includes(order.status)) return false;
  return order.items.some((item) => item.productId !== null && docIds.includes(item.productId));
}

/**
 * Whether `reference` + `email` identify an order that actually contains this
 * product — the "verified purchase" signal.
 *
 * `lookupOrder` is the authority on whether a reference/email pair belongs to
 * each other, and it is the same one the guest order-lookup endpoint uses. Two
 * implementations of "is this your order" is how the two drift apart, and this is
 * the one where the answer becomes a public trust marker.
 *
 * What is checked here on top of that is the *product*: holding a real order
 * reference proves you bought something, not that you bought this. Any locale row
 * of the product group counts, since the same product has one row per language.
 *
 * Best-effort: a DB hiccup resolves to `false`, so the review still saves and
 * simply arrives without the badge. Failing the other way would mint the claim on
 * an error.
 */
async function hasVerifiedPurchase(
  reference: string,
  email: string,
  docIds: number[],
): Promise<boolean> {
  if (docIds.length === 0 || reference.trim() === '') return false;
  try {
    const order = await lookupOrder(reference, email);
    if (!order) return false;
    return orderQualifiesForBadge(order, docIds);
  } catch (err) {
    console.error('[commerce/reviews] verified-purchase check failed', err);
    return false;
  }
}

export interface SubmitReviewResult {
  id: number;
  status: ReviewStatus;
  verified: boolean;
}

/**
 * Persist a `pending` review for the product identified by `input.productSlug`
 * (resolved against the published product for `locale`). Throws not-found when
 * the slug doesn't resolve to a product.
 */
export async function submitReview(input: ReviewInput, locale: string): Promise<SubmitReviewResult> {
  const doc = await getProduct(input.productSlug, locale);
  if (!doc) throw notFound('Product not found.');

  const groupId = doc.translationGroupId ?? '';
  const docIds = groupId ? await productGroupDocIds(groupId) : [doc.id];
  // No reference, no badge — and no lookup either, which is also what keeps this
  // route from being a way to probe whether an address is a customer.
  const verified = input.orderReference
    ? await hasVerifiedPurchase(input.orderReference, input.email, docIds.length ? docIds : [doc.id])
    : false;

  const db = getDb();
  const result = await db.insert(schema.productReviews).values({
    productGroupId: groupId || String(doc.id),
    productId: doc.id,
    productSlug: doc.slug,
    rating: input.rating,
    authorName: input.authorName,
    email: input.email,
    title: input.title ?? null,
    body: input.body,
    status: 'pending',
    verified,
    locale: input.locale ?? locale,
  });

  return { id: adapter.insertId(result), status: 'pending', verified };
}

// ── Storefront reads (approved only) ──────────────────────────────────────────

/** Public-safe projection — no email. */
export interface PublicReview {
  id: number;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  verified: boolean;
  locale: string | null;
  createdAt: Date;
}

/** Resolve a product's translation-group id from its slug + locale. */
export async function getProductGroupId(slug: string, locale: string): Promise<string | null> {
  const doc = await getProduct(slug, locale);
  if (!doc) return null;
  return doc.translationGroupId ?? String(doc.id);
}

/** Approved reviews for a product group, newest first. */
export async function listApprovedReviews(
  productGroupId: string,
  limit = 50,
): Promise<PublicReview[]> {
  const db = getDb();
  return db
    .select({
      id: schema.productReviews.id,
      authorName: schema.productReviews.authorName,
      rating: schema.productReviews.rating,
      title: schema.productReviews.title,
      body: schema.productReviews.body,
      verified: schema.productReviews.verified,
      locale: schema.productReviews.locale,
      createdAt: schema.productReviews.createdAt,
    })
    .from(schema.productReviews)
    .where(
      and(
        eq(schema.productReviews.productGroupId, productGroupId),
        eq(schema.productReviews.status, 'approved'),
      ),
    )
    .orderBy(desc(schema.productReviews.createdAt))
    .limit(limit);
}

/** Count + average of a product's approved reviews (computed in SQL). */
export async function getRatingAggregate(productGroupId: string): Promise<RatingAggregate> {
  const db = getDb();
  const [row] = await db
    .select({
      count: sql<number>`count(*)`,
      avg: sql<number | null>`avg(${schema.productReviews.rating})`,
    })
    .from(schema.productReviews)
    .where(
      and(
        eq(schema.productReviews.productGroupId, productGroupId),
        eq(schema.productReviews.status, 'approved'),
      ),
    );
  const count = Number(row?.count ?? 0);
  if (count === 0) return { count: 0, average: 0 };
  return { count, average: Math.round(Number(row?.avg ?? 0) * 10) / 10 };
}

// ── Admin (moderation) ────────────────────────────────────────────────────────

export interface ReviewSummary extends PublicReview {
  email: string;
  status: ReviewStatus;
  productSlug: string | null;
}

export interface ListReviewsOptions {
  status?: ReviewStatus;
  /** Substring match against author, email, body + product slug. */
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListReviewsResult {
  items: ReviewSummary[];
  page: number;
  pageSize: number;
  total: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function listReviews(opts: ListReviewsOptions = {}): Promise<ListReviewsResult> {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));

  const conditions = [];
  if (opts.status) conditions.push(eq(schema.productReviews.status, opts.status));
  if (opts.search) {
    const term = likeTerm(opts.search);
    const match = or(
      like(schema.productReviews.authorName, term),
      like(schema.productReviews.email, term),
      like(schema.productReviews.body, term),
      like(schema.productReviews.productSlug, term),
    );
    if (match) conditions.push(match);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.productReviews)
    .where(where);

  const items = await db
    .select({
      id: schema.productReviews.id,
      authorName: schema.productReviews.authorName,
      email: schema.productReviews.email,
      rating: schema.productReviews.rating,
      title: schema.productReviews.title,
      body: schema.productReviews.body,
      verified: schema.productReviews.verified,
      status: schema.productReviews.status,
      productSlug: schema.productReviews.productSlug,
      locale: schema.productReviews.locale,
      createdAt: schema.productReviews.createdAt,
    })
    .from(schema.productReviews)
    .where(where)
    .orderBy(desc(schema.productReviews.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items, page, pageSize, total: Number(total) };
}

export interface ReviewStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

/** Counts per status — drives the moderation queue badges. */
export async function reviewStats(): Promise<ReviewStats> {
  const db = getDb();
  const rows = await db
    .select({ status: schema.productReviews.status, count: sql<number>`count(*)` })
    .from(schema.productReviews)
    .groupBy(schema.productReviews.status);
  const stats: ReviewStats = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const r of rows) {
    const n = Number(r.count);
    stats[r.status] = n;
    stats.total += n;
  }
  return stats;
}

/**
 * Both of these report whether they matched a row.
 *
 * They used to return void, so the routes answered `ok: true` for an id that
 * does not exist — and then wrote an audit entry saying a review had been
 * approved or deleted. Two moderators working the queue at once would each see
 * success while only one of them did anything, and the log would agree with
 * both. A moderation trail that records actions which never happened is worse
 * than no trail; the routes turn a miss into a 404.
 */
export async function updateReviewStatus(id: number, status: ReviewStatus): Promise<boolean> {
  const db = getDb();
  const res = await db.update(schema.productReviews).set({ status }).where(eq(schema.productReviews.id, id));
  return adapter.affectedRows(res) > 0;
}

export async function deleteReview(id: number): Promise<boolean> {
  const db = getDb();
  const res = await db.delete(schema.productReviews).where(eq(schema.productReviews.id, id));
  return adapter.affectedRows(res) > 0;
}

// ── Route factories ───────────────────────────────────────────────────────────

const reviewBody = z.object({
  /** Honeypot — a non-empty value means a bot. */
  _hp: z.string().optional(),
  productSlug: z.string().trim().min(1).max(191),
  rating: z.coerce.number().int().min(1).max(5),
  authorName: z.string().trim().min(1).max(191),
  email: z.string().trim().email().max(254),
  title: z.string().trim().max(191).optional(),
  body: z.string().trim().min(1).max(4000),
  locale: z.string().trim().max(8).optional(),
  /** Bounded to the reference column's width; an empty string means "not given". */
  orderReference: z.string().trim().max(32).optional(),
});

export interface ReviewRouteOptions {
  /** Notified after a review is stored (e.g. email a moderator). Failures swallowed. */
  notify?: (review: ReviewInput & { verified: boolean }) => Promise<void>;
  /** Rate-limit ceiling per IP per minute. Default 3. */
  maxPerMinute?: number;
  /** The site's default locale (`config.defaultLocale`), stored when a review arrives without one. */
  defaultLocale: string;
}

/** Public POST — submit a review. Mount from a thin, module-gated site route. */
export function createReviewRoute(opts: ReviewRouteOptions) {
  return createRoute({
    rateLimit: { scope: 'commerce-review', max: opts.maxPerMinute ?? 3, windowMs: 60_000 },
    input: reviewBody,
    handler: async ({ input }) => {
      // Honeypot: pretend success so the bot can't tell it was caught.
      if (input._hp) return ok({ ok: true, status: 'pending' as const });

      const locale = localeOrDefault(input.locale, opts.defaultLocale);
      const review: ReviewInput = {
        productSlug: input.productSlug,
        rating: input.rating,
        authorName: input.authorName,
        email: input.email,
        title: input.title,
        body: input.body,
        locale: input.locale,
        orderReference: input.orderReference,
      };
      const result = await submitReview(review, locale);

      if (opts.notify) {
        try {
          await opts.notify({ ...review, verified: result.verified });
        } catch (err) {
          console.error('[commerce/reviews] notify failed', err);
        }
      }
      return ok({ ok: true, status: result.status });
    },
  });
}

const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

/** GET /api/cms/reviews — moderation list. */
export function reviewsListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reviewsRead),
    query: listQuery,
    handler: async ({ query }) => {
      const result = await listReviews(query ?? {});
      return paginated(result.items, {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      });
    },
  });
}

/** GET /api/cms/reviews/stats — moderation counts. */
export function reviewStatsRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reviewsRead),
    handler: async () => ok(await reviewStats()),
  });
}

const updateReviewBody = z.object({ status: z.enum(['pending', 'approved', 'rejected']) });

/** PATCH /api/cms/reviews/:id — approve / reject. */
export function reviewUpdateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reviewsWrite),
    input: updateReviewBody,
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      if (!(await updateReviewStatus(id, input.status))) throw notFound('Review not found.');
      await logAudit({
        userId: auth.userId,
        action: 'review.status',
        subjectType: 'review',
        subjectId: id,
        after: { status: input.status },
      });
      return ok({ ok: true });
    },
  });
}

/** DELETE /api/cms/reviews/:id. */
export function reviewDeleteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reviewsWrite),
    handler: async ({ params, auth }) => {
      const id = idParam(params.id);
      if (!(await deleteReview(id))) throw notFound('Review not found.');
      await logAudit({
        userId: auth.userId,
        action: 'review.delete',
        subjectType: 'review',
        subjectId: id,
      });
      return ok({ ok: true });
    },
  });
}
