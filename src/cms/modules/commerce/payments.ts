/**
 * Order payments — the `payments` rows, and the site's chosen provider.
 *
 * The provider contract itself lives in `@/cms/core` so commerce and booking
 * share it without depending on each other. This file used to carry its own
 * copy of the interface and a private registry, which meant a provider
 * registered with core reached booking only; the duplicate is gone and only the
 * rows — genuinely commerce's — remain here.
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import {
  conflict,
  ECOMMERCE_PAYMENT_PROVIDER_KEY,
  getPaymentProvider,
  getSetting,
  manualProvider,
  notFound,
  reconcileProviderRefund,
  refundedSoFar,
  refundTargetRef,
  resolveRefundAmount,
  withRefundClaim,
  type PaymentProvider,
  type PaymentStatus,
} from '../../core';
import { getDb, schema } from '../../db';
import type { RefundRequiredNote } from './order-admin';

export {
  getPaymentProvider,
  manualProvider,
  paymentProviderKeys,
  isOnlineProvider,
  canRefundOnline,
} from '../../core';
export type {
  PaymentProvider,
  PaymentStartContext,
  PaymentStartResult,
  PaymentStatus,
  PaymentRefundContext,
  PaymentRefundResult,
} from '../../core';

/** The provider configured in Settings → Ecommerce (defaults to manual). */
export async function getConfiguredPaymentProvider(): Promise<PaymentProvider> {
  const key = await getSetting<string>(ECOMMERCE_PAYMENT_PROVIDER_KEY);
  return getPaymentProvider(key);
}

export async function recordPayment(input: {
  orderId: number;
  provider: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  providerRef?: string;
  method?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.insert(schema.payments).values({
    orderId: input.orderId,
    provider: input.provider,
    providerRef: input.providerRef ?? null,
    status: input.status,
    amount: input.amount,
    currency: input.currency,
    method: input.method ?? null,
    error: input.error ?? null,
    metadata: input.metadata ?? null,
  });
}

export async function listPaymentsForOrder(orderId: number) {
  const db = getDb();
  return db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
}

/**
 * Settle an order's payment row from a verified provider event.
 *
 * Idempotent, because both gateways retry webhooks by design and a replayed
 * capture must not be counted twice. The row is located by `(provider,
 * providerRef)` — unique since migration 0009 — locked, and left alone if it
 * has already reached `captured`.
 *
 * Returns whether THIS call was the one that captured it, so the caller knows
 * whether to decrement stock and send the confirmation, or to do nothing.
 */
export async function capturePaymentByRef(input: {
  provider: string;
  providerRef: string;
  status: PaymentStatus;
  method?: string;
  metadata?: Record<string, unknown>;
  /** On a refund: the provider's running refunded total, minor units, if it stated one. */
  refundedTotal?: number;
}): Promise<{
  captured: boolean;
  orderId: number | null;
  /**
   * On a refund: what is left of the capture once it is reconciled with the
   * admin's claim. 0 means refunded in full; anything more is a partial refund,
   * which must not move the order (see `orderStatusAfterRefund`).
   */
  remaining?: number;
}> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.provider, input.provider),
          eq(schema.payments.providerRef, input.providerRef),
        ),
      )
      .for('update')
      .limit(1);

    // No row means the event refers to a payment this site never started —
    // a stale endpoint, or another environment pointed at the same webhook.
    if (!row) return { captured: false, orderId: null };
    if (row.status === input.status) {
      return { captured: false, orderId: row.orderId, ...(input.status === 'refunded' ? { remaining: 0 } : {}) };
    }

    /*
     * A refund of a captured payment may be PARTIAL — the admin can refund part
     * of it, and so can the provider's dashboard. The row keeps `captured`
     * (so the rest stays refundable) and records the running total under the
     * same claim key the admin path writes; only a refund of everything marks
     * it `refunded`. Taking the larger of the two totals makes this idempotent
     * with the admin refund and with replays of this event.
     */
    if (input.status === 'refunded' && row.status === 'captured') {
      const { refundedTotal, remaining } = reconcileProviderRefund({
        capturedAmount: row.amount,
        metadata: row.metadata,
        reportedTotal: input.refundedTotal,
      });
      await tx
        .update(schema.payments)
        .set({
          status: remaining <= 0 ? 'refunded' : row.status,
          metadata: withRefundClaim({ ...(row.metadata ?? {}), ...(input.metadata ?? {}) }, refundedTotal),
        })
        .where(eq(schema.payments.id, row.id));
      return { captured: false, orderId: row.orderId, remaining };
    }

    await tx
      .update(schema.payments)
      .set({
        status: input.status,
        method: input.method ?? row.method,
        metadata: { ...(row.metadata ?? {}), ...(input.metadata ?? {}) },
      })
      .where(eq(schema.payments.id, row.id));

    return {
      captured: input.status === 'captured',
      orderId: row.orderId,
      // A refund of a payment that was never captured: nothing to weigh, as before.
      ...(input.status === 'refunded' ? { remaining: 0 } : {}),
    };
  });
}

/**
 * Send an order's money back through the provider that took it.
 *
 * Written as its own row rather than by mutating the capture — the two are
 * separate events. The order is moved to `refunded`, which is what puts the
 * stock back (see `updateOrderStatus`).
 */
export async function refundOrderPayment(input: {
  paymentId: number;
  /**
   * The order the caller is acting on. Checked under the lock, BEFORE the
   * provider is called: checking it afterwards (as the route used to) refunded
   * another order's payment and only then said "that belongs to another order".
   */
  orderId?: number;
  amount?: number;
  reason?: string;
}): Promise<{ refunded: number; orderId: number; providerRef: string | null; remaining: number }> {
  const db = getDb();

  /*
   * Claim the refund BEFORE calling the provider, with the row locked.
   *
   * `status` cannot be the guard here: the capture row is deliberately left
   * alone (a refund is its own row), so `status === 'captured'` is still true
   * after a refund and a second request passed the same check. With no
   * transaction and no lock, two requests did not even have to be sequential —
   * both read `captured`, both called the gateway, and whether the money went
   * twice was the gateway's business rather than ours. Writing the running total
   * under a lock makes the second request wait, then find nothing left.
   *
   * See `core/payments/refunds.ts`; the booking sibling does the same.
   */
  const claim = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, input.paymentId))
      .for('update')
      .limit(1);
    if (!row) throw notFound('Payment not found.');
    if (input.orderId !== undefined && row.orderId !== input.orderId) {
      throw notFound('Payment not found.');
    }
    if (row.status !== 'captured') throw conflict('Only a captured payment can be refunded.');

    const provider = getPaymentProvider(row.provider);
    if (!provider.refund) {
      throw conflict(`${provider.label} refunds are arranged outside this system.`);
    }

    const alreadyRefunded = refundedSoFar(row.metadata);
    const amount = resolveRefundAmount({
      capturedAmount: row.amount,
      alreadyRefunded,
      requested: input.amount,
    });

    await tx
      .update(schema.payments)
      .set({ metadata: withRefundClaim(row.metadata, alreadyRefunded + amount) })
      .where(eq(schema.payments.id, row.id));

    // The refund fn travels with the claim, so the call below needs no non-null
    // assertion on a check that happened in here.
    return { row, amount, refund: provider.refund, remaining: row.amount - (alreadyRefunded + amount) };
  });

  const { row, amount, refund, remaining } = claim;

  /**
   * Give the claim back, so a *definitely* failed attempt does not consume the
   * balance and leave the operator unable to retry.
   *
   * Called only where it is certain no money moved: before the provider is
   * called at all, or after the provider explicitly said no. NOT called when the
   * call throws — see below.
   */
  const releaseClaim = async (): Promise<void> => {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, row.id))
        .for('update')
        .limit(1);
      if (!current) return;
      await tx
        .update(schema.payments)
        .set({ metadata: withRefundClaim(current.metadata, Math.max(0, refundedSoFar(current.metadata) - amount)) })
        .where(eq(schema.payments.id, row.id));
    });
  };

  // PayPal refunds target the capture and Viva the transaction, both recorded
  // on the row by the webhook; Stripe refunds target the intent, which is the
  // row's own ref. See `refundTargetRef`.
  const target = refundTargetRef(row);
  if (!target) {
    await releaseClaim();
    throw conflict('That payment has no provider reference to refund against.');
  }

  let result: Awaited<ReturnType<typeof refund>>;
  try {
    result = await refund({
      providerRef: target,
      amount,
      currency: row.currency,
      reason: input.reason,
    });
  } catch (err) {
    /*
     * The claim is deliberately KEPT here.
     *
     * A thrown error is ambiguous: a socket timeout or a dropped connection can
     * mean the gateway never saw the request, or that it processed the refund
     * and we lost the answer. Releasing the claim on that would let a retry send
     * the money a second time. Holding it means a genuinely-failed refund needs a
     * human to look at the gateway and clear `metadata.refundedAmount` — which is
     * the recoverable half of the two, and the money has not moved twice.
     */
    console.error('[commerce/payments] refund call failed; claim held for review', {
      paymentId: row.id,
      amount,
      err,
    });
    throw err;
  }
  if (result.status === 'failed') {
    // Unambiguous: the provider answered, and the answer was no.
    await releaseClaim();
    throw conflict(result.error ?? 'The provider refused the refund.');
  }

  await db.insert(schema.payments).values({
    orderId: row.orderId,
    provider: row.provider,
    providerRef: result.providerRef ?? null,
    status: 'refunded',
    // Negative, so an order's rows still sum to what it holds.
    amount: -amount,
    currency: row.currency,
    method: row.method,
    metadata: { refundOf: row.id, ...(input.reason ? { reason: input.reason } : {}) },
  });

  return {
    refunded: amount,
    orderId: row.orderId,
    providerRef: result.providerRef ?? null,
    remaining: Math.max(0, remaining),
  };
}

/**
 * Keep MANUAL payment rows in step when an admin toggles the order status.
 *
 * Restricted to `manual` deliberately. A gateway's rows are the record of what
 * actually happened at the provider, and are written by the webhook; letting an
 * admin's status toggle relabel them would mean the payment history reports the
 * order's status rather than the money's.
 */
export async function syncPaymentsForOrderStatus(orderId: number, orderStatus: string): Promise<void> {
  const map: Record<string, PaymentStatus | undefined> = { paid: 'captured', refunded: 'refunded' };
  const next = map[orderStatus];
  if (!next) return;
  const db = getDb();
  await db
    .update(schema.payments)
    .set({ status: next })
    .where(
      and(eq(schema.payments.orderId, orderId), eq(schema.payments.provider, manualProvider.key)),
    );
}

/**
 * Flag an order whose customer was charged for something that will not be
 * filled, so the admin panel asks for a refund (see `refundStillOwed`).
 *
 * Written under the order's row lock and merged into the CURRENT metadata, so
 * it cannot drop `stockTaken` or anything else written in between. `extra`
 * lands in the same write (the stock-short path records `stockFailure` with it).
 */
export async function flagOrderRefundRequired(
  orderId: number,
  note: Omit<RefundRequiredNote, 'at'>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select({ metadata: schema.orders.metadata })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .for('update')
      .limit(1);
    if (!order) return;
    const refundRequired: RefundRequiredNote = { at: new Date().toISOString(), ...note };
    await tx
      .update(schema.orders)
      .set({ metadata: { ...((order.metadata as Record<string, unknown>) ?? {}), ...extra, refundRequired } })
      .where(eq(schema.orders.id, orderId));
  });
}
