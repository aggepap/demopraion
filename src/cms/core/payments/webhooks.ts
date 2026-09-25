/**
 * Gateway webhooks — where a payment actually becomes real.
 *
 * One endpoint per provider rather than per module: a gateway dashboard should
 * carry one URL, not one per feature. Which module an event belongs to travels
 * with the payment (Stripe metadata, PayPal `custom_id`) and comes back on the
 * event, so the handler dispatches on that.
 *
 * Two things force these routes to be written differently from every other
 * route in the codebase, and both are deliberate:
 *
 *  - **No `input:` schema.** `createRoute` parses the body with `req.json()`,
 *    which consumes it; a signature is computed over the RAW bytes, and the
 *    request is single-use. So the body is read here with `req.text()` and
 *    parsed only after it has been verified.
 *  - **`sameOrigin: false`.** A gateway posts server-to-server with no `Origin`
 *    header, which `isSameOrigin` happens to allow — but relying on that would
 *    be relying on an accident. The check is switched off explicitly, and the
 *    signature is what authenticates the request instead.
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import { createRoute, ok } from '../api';
import { getDb, schema } from '../../db';
import {
  PAYPAL_PROVIDER_KEY,
  paypalOutcome,
  stripeOutcome,
  subjectFromResource,
  VIVA_PROVIDER_KEY,
  vivaEventKind,
  type PaymentOutcome,
  type PayPalEventLike,
  type VivaEventLike,
} from './events';
import { capturePayPalOrder, verifyPayPalWebhook } from './paypal';
import { getStripeClient, readStripeWebhookSecret } from './stripe';
import {
  amountMatches,
  confirmTransaction,
  extractTransactionId,
  readVivaWebhookKey,
  VIVA_STATUS_SUCCESS,
} from './viva';

/**
 * Apply a verified outcome to whichever module owns it.
 *
 * The module code is imported lazily and only for the subject in hand: the
 * booking and commerce modules must each work with the other switched off, so
 * a static import of both would make one endpoint depend on two features.
 */
async function applyOutcome(outcome: PaymentOutcome): Promise<{ handled: boolean }> {
  if (outcome.subject === 'reservation') return applyToReservation(outcome);
  if (outcome.subject === 'order') return applyToOrder(outcome);

  // Subject unknown. Viva has no field that round-trips one to the webhook, so
  // the payment ROW is what says which module owns the money — and our own row
  // is a better authority than anything a gateway echoes back. Each capture
  // reports no id when nothing matched, so trying both is a lookup, not a
  // guess: at most one table can hold this `(provider, provider_ref)`.
  const asReservation = await applyToReservation(outcome);
  if (asReservation.handled) return asReservation;
  return applyToOrder(outcome);
}

async function applyToReservation(outcome: PaymentOutcome): Promise<{ handled: boolean }> {
  const { captureReservationPaymentByRef } = await import('../../modules/booking/payments');
  const result = await captureReservationPaymentByRef({
    provider: outcome.provider,
    providerRef: outcome.providerRef,
    status: outcome.status,
    method: outcome.method,
    metadata: outcome.metadata,
  });

  // The status email is sent outside the transaction, and only by the call
  // that actually moved the reservation — a replayed webhook must not send a
  // second receipt.
  if (result.captured && result.reservationId && result.from && result.to) {
    const { sendStatusEmail } = await import('../../modules/booking/emails');
    await sendStatusEmail(result.reservationId, result.from, result.to);
  }
  return { handled: result.reservationId != null };
}

async function applyToOrder(outcome: PaymentOutcome): Promise<{ handled: boolean }> {
  const { capturePaymentByRef } = await import('../../modules/commerce/payments');
  const { orderStatusAfterRefund } = await import('../../modules/commerce/order-admin');
  const result = await capturePaymentByRef({
    provider: outcome.provider,
    providerRef: outcome.providerRef,
    status: outcome.status,
    method: outcome.method,
    metadata: outcome.metadata,
    refundedTotal: outcome.refundedTotal,
  });
  if (result.orderId == null) return { handled: false };

  if (outcome.status === 'refunded') {
    // Only a refund of everything moves the order — the same rule the admin
    // refund route applies. A partial refund (now possible from the admin) used
    // to be flipped to `refunded` here, restocking every line, restoring gift
    // card balances and emailing the customer a full refund.
    const next = orderStatusAfterRefund({ remaining: result.remaining ?? 0 });
    if (next) {
      // `updateOrderStatus` puts the stock back itself, on the transition into
      // `refunded` — so this must NOT also call `restockOrder`, or a refund
      // would return every unit twice. `unlessAlready`, because the admin route
      // that issued the refund has usually made this move already, and a second
      // one would email the customer again.
      const { updateOrderStatus } = await import('../../modules/commerce/orders');
      await updateOrderStatus(result.orderId, next, { unlessAlready: true });
    }
    return { handled: true };
  }

  if (result.captured) {
    await settleCapturedOrder(result.orderId, {
      provider: outcome.provider,
      providerRef: outcome.providerRef,
    });
  }
  return { handled: true };
}

/**
 * An order whose money has landed: take the stock, then mark it paid.
 *
 * Two ways the money can land on an order that will not be filled, and both
 * leave the order closed and flag it for a refund (`metadata.refundRequired`,
 * shown in the admin panel with the Refund action under Payments):
 *
 * - **The order was already closed.** The stale-order job cancels a `pending`
 *   order whose payment never came, restocking it and giving back any gift
 *   card balance it used. A capture that arrives after that used to revive it
 *   to `paid` and take the stock again, while the gift card stayed returned.
 *   Now a cancelled or refunded order is not touched: no stock, no status.
 * - **The stock ran out** between checkout and capture. Nothing is taken and the
 *   order is cancelled, as before, and it is now flagged as well.
 *
 * The refund itself is not automatic. It would run inside this webhook, where a
 * thrown provider call holds the refund claim with nobody told, and the capture
 * row has only just been written. The admin refund is the safe, audited path.
 */
async function settleCapturedOrder(
  orderId: number,
  payment: { provider: string; providerRef: string },
): Promise<void> {
  const { decrementStockForOrder } = await import('../../modules/commerce/stock');
  const { updateOrderStatus } = await import('../../modules/commerce/orders');
  const { flagOrderRefundRequired } = await import('../../modules/commerce/payments');
  const { CLOSED_ORDER_STATUSES } = await import('../../modules/commerce/order-admin');
  const closed: readonly string[] = CLOSED_ORDER_STATUSES;

  const flagLateCapture = async (orderStatus: string) => {
    await flagOrderRefundRequired(orderId, { reason: 'captured_after_close', orderStatus, ...payment });
    console.error(
      `[cms/payments] order ${orderId} was ${orderStatus} when its payment was captured; flagged for refund`,
    );
  };

  // Refused under the order's lock when the order is closed, so a cancellation
  // cannot slip in between the check and the stock move.
  const stock = await decrementStockForOrder(orderId, { unlessStatus: CLOSED_ORDER_STATUSES });
  if (stock.refusedStatus) {
    await flagLateCapture(stock.refusedStatus);
    return;
  }

  if (stock.short.length > 0) {
    await flagOrderRefundRequired(
      orderId,
      { reason: 'stock_short', ...payment },
      { stockFailure: { at: new Date().toISOString(), lines: stock.short } },
    );

    // Cancelling (not refunding) because nothing was taken off the shelf, so
    // there is nothing to put back. The refund itself is the admin's call;
    // the flag above is what tells them.
    await updateOrderStatus(orderId, 'cancelled');
    console.error(
      `[cms/payments] order ${orderId} captured but could not be stocked; flagged for refund`,
      stock.short,
    );
    return;
  }

  /*
   * Only from `pending`. An order an admin already marked paid (or fulfilled)
   * stays where it is, and one the stale job cancelled after the stock move
   * above — which restocked it, since `stockTaken` was set — stays cancelled
   * and is flagged instead.
   */
  const moved = await updateOrderStatus(orderId, 'paid', { onlyFrom: 'pending' });
  if (!moved) {
    const db = getDb();
    const [order] = await db
      .select({ status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    if (order && closed.includes(order.status)) {
      await flagLateCapture(order.status);
      return;
    }
  }

  /*
   * The money is confirmed, so any gift cards this order bought can be minted.
   * Idempotent through the unique key on the order line — a replayed webhook
   * must not mint a second card.
   */
  try {
    const { issueGiftCardsForOrder } = await import('../../modules/commerce/giftcards/service');
    await issueGiftCardsForOrder(orderId);
  } catch (err) {
    console.error('[cms/payments] gift card issue failed', orderId, err);
  }
}

/* ── Stripe ───────────────────────────────────────────────────────────────── */

/** `POST /api/cms/payments/webhooks/stripe` */
export function stripeWebhookRoute() {
  return createRoute({
    sameOrigin: false,
    rateLimit: { scope: 'webhook-stripe', max: 120, windowMs: 60_000 },
    handler: async ({ req }) => {
      const signature = req.headers.get('stripe-signature');
      if (!signature) return ok({ received: false });

      const raw = await req.text();

      let event;
      try {
        // Stripe's own verification: signed-payload construction, timing-safe
        // compare, replay-window tolerance and secret rotation, all handled.
        event = getStripeClient().webhooks.constructEvent(raw, signature, readStripeWebhookSecret());
      } catch (err) {
        // A bad signature is not our error to explain. Log it and answer 400 so
        // Stripe retries if it was genuinely ours and transient.
        console.error('[cms/payments] stripe webhook verification failed', err);
        return new Response(JSON.stringify({ ok: false, error: 'invalid_signature' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const outcome = stripeOutcome(event);
      if (!outcome) return ok({ received: true, ignored: event.type });

      const { handled } = await applyOutcome(outcome);
      // 200 either way: an event for a payment this site does not know about is
      // not a failure Stripe should retry, it is one it should stop sending.
      return ok({ received: true, handled });
    },
  });
}

/* ── Viva ─────────────────────────────────────────────────────────────────── */

/**
 * What we charged for this order code, from our own records.
 *
 * Looked up across both modules because a Viva event does not say which one it
 * belongs to. Used only to sanity-check the amount Viva reports; the order code
 * is the binding that matters.
 */
async function expectedAmountFor(providerRef: string): Promise<number | null> {
  const db = getDb();

  const [reservationRow] = await db
    .select({ amount: schema.reservationPayments.amount })
    .from(schema.reservationPayments)
    .where(
      and(
        eq(schema.reservationPayments.provider, VIVA_PROVIDER_KEY),
        eq(schema.reservationPayments.providerRef, providerRef),
      ),
    )
    .limit(1);
  if (reservationRow) return reservationRow.amount;

  const [orderRow] = await db
    .select({ amount: schema.payments.amount })
    .from(schema.payments)
    .where(
      and(eq(schema.payments.provider, VIVA_PROVIDER_KEY), eq(schema.payments.providerRef, providerRef)),
    )
    .limit(1);
  return orderRow?.amount ?? null;
}

/**
 * `GET /api/cms/payments/webhooks/viva` — the registration handshake.
 *
 * Viva verifies an endpoint by GETting it once and expecting a key back. It is
 * the only reason any of our webhook URLs answer GET, and it is why this
 * integration needs `VIVA_WEBHOOK_VERIFICATION_KEY` set BEFORE the webhook can
 * be registered in the Viva portal.
 */
export function vivaWebhookKeyRoute() {
  return createRoute({
    rateLimit: { scope: 'webhook-viva-key', max: 30, windowMs: 60_000 },
    handler: async () => {
      const key = readVivaWebhookKey();
      if (!key) {
        // 404 rather than an explanatory error: an unconfigured endpoint should
        // look like no endpoint, not like one waiting to be configured.
        return new Response(JSON.stringify({ ok: false, error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Viva expects exactly `{"Key": "..."}` — not the site's usual envelope.
      return new Response(JSON.stringify({ Key: key }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

/**
 * `POST /api/cms/payments/webhooks/viva`
 *
 * The notification is unsigned and unauthenticated — anyone who learns this URL
 * can post to it. So the payload is treated as nothing more than "go and look
 * at transaction X": the status, the order it belongs to and the amount are all
 * taken from an authenticated read of Viva's API, never from the request body.
 * This is Viva's own documented guidance, and it is the only thing standing
 * between this endpoint and a forged capture.
 */
export function vivaWebhookRoute() {
  return createRoute({
    sameOrigin: false,
    rateLimit: { scope: 'webhook-viva', max: 120, windowMs: 60_000 },
    handler: async ({ req }) => {
      const raw = await req.text();

      let event: VivaEventLike;
      try {
        event = JSON.parse(raw) as VivaEventLike;
      } catch {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const kind = vivaEventKind(event);
      // Viva sends far more than payments down this pipe (payouts, account
      // events). Anything we do not act on is acknowledged and dropped.
      if (!kind) return ok({ received: true, ignored: event.EventTypeId ?? null });

      const transactionId = extractTransactionId(raw) ?? event.EventData?.TransactionId ?? null;
      if (!transactionId) return ok({ received: true, handled: false });

      // ── The security boundary ──
      let confirmed;
      try {
        confirmed = await confirmTransaction(transactionId);
      } catch (err) {
        // Could not reach Viva, so we cannot know. 500 so Viva retries rather
        // than treating an unverifiable notification as handled.
        console.error('[cms/payments] viva transaction confirmation failed', err);
        return new Response(JSON.stringify({ ok: false, error: 'confirmation_failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!confirmed.orderCode) return ok({ received: true, handled: false });

      // Viva's reality, not the payload's claim: a success is `F` and nothing
      // else, and a "failed" event whose transaction actually succeeded is a
      // contradiction we refuse rather than act on.
      const succeeded = confirmed.statusId === VIVA_STATUS_SUCCESS;
      if ((kind === 'captured' || kind === 'refunded') && !succeeded) {
        return ok({ received: true, handled: false, reason: 'not_settled' });
      }
      if (kind === 'failed' && succeeded) {
        return ok({ received: true, handled: false, reason: 'contradicted' });
      }

      // Belt to the order code's braces: catches a partial capture being
      // reported against an order we billed in full.
      const expected = await expectedAmountFor(confirmed.orderCode);
      if (expected != null && !amountMatches(expected, confirmed.amount)) {
        console.error(
          `[cms/payments] viva amount mismatch for order ${confirmed.orderCode}: expected ${expected}, got ${confirmed.amount}`,
        );
        return ok({ received: true, handled: false, reason: 'amount_mismatch' });
      }

      const { handled } = await applyOutcome({
        provider: VIVA_PROVIDER_KEY,
        // The order code, which is what `start()` recorded on the payment row.
        providerRef: confirmed.orderCode,
        status: kind,
        method: 'card',
        // Kept because a refund is issued against the TRANSACTION, while the
        // row is keyed by the order code (see `refundTargetRef`). A reversal
        // has a transaction id of its own, stored under another key so it
        // cannot overwrite the capture's: that one is the refund target.
        metadata: kind === 'refunded' ? { reversalTransactionId: transactionId } : { transactionId },
        // A reversal only gets this far when its amount matched the whole
        // capture (above), so it is a refund of all of it. A partial reversal is
        // refused as a mismatch and never moves the order.
        ...(kind === 'refunded' && expected != null ? { refundedTotal: expected } : {}),
      });
      return ok({ received: true, handled });
    },
  });
}

/* ── PayPal ───────────────────────────────────────────────────────────────── */

/** `POST /api/cms/payments/webhooks/paypal` */
export function paypalWebhookRoute() {
  return createRoute({
    sameOrigin: false,
    rateLimit: { scope: 'webhook-paypal', max: 120, windowMs: 60_000 },
    handler: async ({ req }) => {
      const raw = await req.text();

      // Unlike Stripe there is no local signature to check — the transmission
      // headers go back to PayPal, which answers. Any failure (including a
      // network one) returns false, so an unreachable PayPal can never be
      // mistaken for a verified event.
      if (!(await verifyPayPalWebhook(req.headers, raw))) {
        console.error('[cms/payments] paypal webhook verification failed');
        return new Response(JSON.stringify({ ok: false, error: 'invalid_signature' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let event: PayPalEventLike;
      try {
        event = JSON.parse(raw) as PayPalEventLike;
      } catch {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // An approved order still holds no money — PayPal waits to be asked.
      if (event.event_type === 'CHECKOUT.ORDER.APPROVED' && event.resource?.id) {
        const { captureId, status } = await capturePayPalOrder(event.resource.id);
        const subject = subjectFromResource(event.resource);
        if (!subject) return ok({ received: true, handled: false });

        const { handled } = await applyOutcome({
          provider: PAYPAL_PROVIDER_KEY,
          providerRef: event.resource.id,
          status: status === 'COMPLETED' ? 'captured' : 'failed',
          subject: subject.subject,
          subjectId: subject.subjectId,
          method: 'paypal',
          // Kept because a refund must target the CAPTURE, while the row is
          // keyed by the order id that was known when payment started.
          metadata: captureId ? { captureId } : undefined,
        });
        return ok({ received: true, handled });
      }

      const outcome = paypalOutcome(event);
      if (!outcome) return ok({ received: true, ignored: event.event_type });

      const { handled } = await applyOutcome(outcome);
      return ok({ received: true, handled });
    },
  });
}

