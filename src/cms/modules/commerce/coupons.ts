/**
 * Coupon / discount codes — admin-configurable (Settings → Coupons).
 *
 * Codes are stored as a structured JSON list under `ecommerce.coupons`. The
 * checkout re-validates + re-computes the discount server-side (never trusts a
 * client-supplied amount). Discount applies to the items subtotal only (not
 * shipping). Values are authored in MAJOR units; results are MINOR (cents).
 */
import 'server-only';

import { and, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { createRoute, ECOMMERCE_COUPONS_KEY, getSetting, ok } from '../../core';
import { getDb, schema } from '../../db';
import { getProduct, getSiteCurrency, resolvePrice } from './read';

/** Just enough of drizzle's transaction handle for the locking count below. */
type MySqlTransactionLike = Pick<ReturnType<typeof getDb>, 'select'>;

export type CouponType = 'percent' | 'fixed';

export interface Coupon {
  code: string;
  type: CouponType;
  /** Percent (0–100) or fixed amount in major units. */
  value: number;
  /** Minimum items subtotal (major units) required. 0 = none. */
  minSubtotal: number;
  /** ISO date (YYYY-MM-DD) after which the coupon is invalid. Empty = never. */
  expiresAt: string;
  /** Max total redemptions across all customers. 0 = unlimited. */
  usageLimit: number;
  /** Max redemptions per customer (by email). 0 = unlimited. */
  perCustomerLimit: number;
  active: boolean;
}

const toCents = (major: number): number => Math.round((Number(major) || 0) * 100);

/**
 * One stored entry, coerced into a `Coupon`.
 *
 * Structured settings keys are not validated when they are written — the settings
 * API says as much, leaving their shape to "their existing sanitisers", which is
 * this function, on read. So this is the only place the stored list is made to
 * mean anything, and the only place a bad value can be corrected.
 *
 * The percentage clamp is the one that matters in practice. `value` was
 * documented as "Percent (0-100)" and nothing enforced it: the authoring form set
 * only a minimum. A coupon intended as 15% and typed as 150 was stored as 150,
 * shown back as 150, and discounted the whole subtotal — `computeDiscount` caps at
 * the subtotal, so the order came out free rather than visibly wrong. Clamping
 * here means the admin sees what will actually happen, and an already-stored 150
 * reads as 100 rather than pretending to be something it cannot be.
 */
export function normaliseCoupon(raw: Record<string, unknown>): Coupon {
  const type: CouponType = raw.type === 'fixed' ? 'fixed' : 'percent';
  const value = Number(raw.value) || 0;
  return {
    code: String(raw.code ?? ''),
    type,
    value: type === 'percent' ? Math.min(100, Math.max(0, value)) : Math.max(0, value),
    minSubtotal: Number(raw.minSubtotal) || 0,
    expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : '',
    usageLimit: Number(raw.usageLimit) || 0,
    perCustomerLimit: Number(raw.perCustomerLimit) || 0,
    active: raw.active !== false,
  };
}

/** Read + normalise the stored coupon list. */
export async function getCoupons(): Promise<Coupon[]> {
  const raw = await getSetting<unknown>(ECOMMERCE_COUPONS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map(normaliseCoupon)
    .filter((c) => c.code);
}

export type CouponReason =
  | 'not_found'
  | 'expired'
  | 'inactive'
  | 'min_subtotal'
  | 'usage_limit'
  | 'customer_limit';

export type CouponResult =
  | { valid: true; code: string; discount: number }
  | { valid: false; reason: CouponReason };

/**
 * Discount (cents) for a coupon against a subtotal, capped at the subtotal.
 *
 * The percentage clamp here is belt-and-braces and changes no result on its own:
 * the cap at the subtotal already made 150% and 100% identical. It is stated
 * anyway so the invariant lives next to the arithmetic that depends on it, for
 * any future caller that reaches for `coupon.value` directly. Bounding the value
 * where it is authored and where it is read (`normaliseCoupon`) is what actually
 * stops a mistyped 150 from meaning "free".
 */
export function computeDiscount(coupon: Coupon, subtotalCents: number): number {
  const percent = Math.min(100, Math.max(0, coupon.value));
  const raw = coupon.type === 'percent' ? Math.round((subtotalCents * percent) / 100) : toCents(coupon.value);
  return Math.max(0, Math.min(raw, subtotalCents));
}

/** Resolve + validate a coupon code against a subtotal. */
export function validateCoupon(coupons: Coupon[], code: string, subtotalCents: number): CouponResult {
  const norm = code.trim().toLowerCase();
  const coupon = coupons.find((c) => c.code.trim().toLowerCase() === norm);
  if (!coupon) return { valid: false, reason: 'not_found' };
  if (!coupon.active) return { valid: false, reason: 'inactive' };
  if (coupon.expiresAt) {
    const exp = Date.parse(coupon.expiresAt);
    if (!Number.isNaN(exp) && Date.now() > exp + 86_400_000) return { valid: false, reason: 'expired' };
  }
  if (coupon.minSubtotal > 0 && subtotalCents < toCents(coupon.minSubtotal)) {
    return { valid: false, reason: 'min_subtotal' };
  }
  return { valid: true, code: coupon.code, discount: computeDiscount(coupon, subtotalCents) };
}

/**
 * How many times a coupon has been redeemed (derived from orders — no separate
 * table). Cancelled/refunded orders free the redemption. Pass `email` for the
 * per-customer count.
 */
export async function countCouponRedemptions(code: string, email?: string): Promise<number> {
  const db = getDb();
  const conds = [
    sql`json_unquote(json_extract(${schema.orders.metadata}, '$.coupon')) = ${code}`,
    notInArray(schema.orders.status, ['cancelled', 'refunded']),
  ];
  if (email) conds.push(sql`lower(${schema.orders.email}) = ${email.trim().toLowerCase()}`);
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(schema.orders).where(and(...conds));
  return Number(row?.n ?? 0);
}

/**
 * The same two counts, but taken INSIDE a checkout transaction under
 * `FOR UPDATE` — the authoritative enforcement.
 *
 * `couponUsageError()` runs before the transaction opens, so it can only ever
 * be advisory: two checkouts for the last redemption of a single-use code both
 * counted 0, both passed, and both committed. Redemptions are derived from the
 * `orders` table rather than a counter row, so there is nothing to lock by id —
 * the locking read over the matching orders is what serialises the two
 * transactions, making the second one count the first's row and be refused.
 *
 * It is deliberately only reached when a coupon is actually applied.
 */
export async function couponUsageErrorLocked(
  tx: MySqlTransactionLike,
  coupon: Coupon,
  email?: string,
): Promise<'usage_limit' | 'customer_limit' | null> {
  const count = async (withEmail: boolean): Promise<number> => {
    const conds = [
      sql`json_unquote(json_extract(${schema.orders.metadata}, '$.coupon')) = ${coupon.code}`,
      notInArray(schema.orders.status, ['cancelled', 'refunded']),
    ];
    if (withEmail && email) conds.push(sql`lower(${schema.orders.email}) = ${email.trim().toLowerCase()}`);
    const [row] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(schema.orders)
      .where(and(...conds))
      .for('update');
    return Number(row?.n ?? 0);
  };

  if (coupon.usageLimit > 0 && (await count(false)) >= coupon.usageLimit) return 'usage_limit';
  if (coupon.perCustomerLimit > 0 && email && (await count(true)) >= coupon.perCustomerLimit) {
    return 'customer_limit';
  }
  return null;
}

/** Whichever usage limit the coupon has hit for this customer, or null. */
export async function couponUsageError(
  coupon: Coupon,
  email?: string,
): Promise<'usage_limit' | 'customer_limit' | null> {
  if (coupon.usageLimit > 0 && (await countCouponRedemptions(coupon.code)) >= coupon.usageLimit) {
    return 'usage_limit';
  }
  if (
    coupon.perCustomerLimit > 0 &&
    email &&
    (await countCouponRedemptions(coupon.code, email)) >= coupon.perCustomerLimit
  ) {
    return 'customer_limit';
  }
  return null;
}

interface QuoteLine {
  slug: string;
  variationId?: string;
  quantity: number;
  locale: string;
}

async function cartSubtotalCents(lines: QuoteLine[]): Promise<number> {
  let subtotal = 0;
  for (const line of lines) {
    const qty = Math.max(1, Math.floor(line.quantity));
    const doc = await getProduct(line.slug, line.locale);
    if (!doc) continue;
    subtotal += Math.round(resolvePrice(doc.data as Record<string, unknown>, line.variationId) * 100) * qty;
  }
  return subtotal;
}

/**
 * Validate a code against a cart (server-side subtotal) + the coupon's GLOBAL
 * usage limit.
 *
 * Deliberately does not take an email, and so never evaluates the per-customer
 * limit. It backs an unauthenticated endpoint, where the email is whatever the
 * caller typed rather than whoever they are: running the per-customer count on
 * it turned the route into an oracle — post a live code plus a candidate
 * address, and the valid/invalid answer told you whether that person had
 * ordered with that coupon before. Any address, no account, 30 tries a minute.
 *
 * Nothing is weakened by dropping it, because this check was always advisory.
 * The per-customer limit is enforced where it can be trusted: inside the
 * checkout transaction, under `FOR UPDATE`, against the email the order is
 * actually placed with (`couponUsageErrorLocked`, used by `orders.ts`). The
 * only visible change is that a returning customer re-using a one-per-person
 * code is now told at submission instead of at apply.
 */
export async function quoteCoupon(
  code: string,
  lines: QuoteLine[],
): Promise<CouponResult & { currency: string }> {
  const [coupons, currency, subtotal] = await Promise.all([
    getCoupons(),
    getSiteCurrency(),
    cartSubtotalCents(lines),
  ]);
  const base = validateCoupon(coupons, code, subtotal);
  if (!base.valid) return { ...base, currency };
  const coupon = coupons.find((c) => c.code.trim().toLowerCase() === code.trim().toLowerCase());
  if (coupon) {
    // No email argument: the global exhaustion of a code is the same fact for
    // every caller, so reporting it leaks nothing about anyone.
    const usage = await couponUsageError(coupon);
    if (usage) return { valid: false, reason: usage, currency };
  }
  return { ...base, currency };
}

const couponBody = z.object({
  code: z.string().trim().min(1).max(64),
  email: z.string().trim().email().max(254).optional(),
  locale: z.string().trim().max(8),
  items: z
    .array(
      z.object({
        slug: z.string().trim().max(191),
        variationId: z.string().trim().max(64).optional(),
        quantity: z.coerce.number().int().positive().max(999),
      }),
    )
    .max(100),
});

/** Public POST — validate a coupon for the current cart. Module-gated by the binder. */
export function createCouponRoute() {
  return createRoute({
    rateLimit: { scope: 'commerce-coupon', max: 30, windowMs: 60_000 },
    input: couponBody,
    handler: async ({ input }) => {
      // `input.email` is accepted (the checkout client sends it) and ignored —
      // see `quoteCoupon` for why an unauthenticated caller's asserted address
      // must not drive a per-customer check.
      const result = await quoteCoupon(
        input.code,
        input.items.map((it) => ({ ...it, locale: input.locale })),
      );
      return ok(result);
    },
  });
}
