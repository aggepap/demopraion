/**
 * Provider events, reduced to what we act on.
 *
 * Deliberately pure and DB-free, separate from `webhooks.ts`: deciding what an
 * event *means* is the part with all the shapes and edge cases, and it should
 * be testable without a database or a network. `webhooks.ts` verifies and
 * applies; this file only interprets.
 */

import { decodePaymentSubject, type PaymentSubject } from './index';

export const STRIPE_PROVIDER_KEY = 'stripe';
export const PAYPAL_PROVIDER_KEY = 'paypal';
export const VIVA_PROVIDER_KEY = 'viva';

/**
 * What a verified event asks us to do, once provider differences are stripped
 * away. Both gateways reduce to this, so the module dispatch is written once.
 */
export interface PaymentOutcome {
  provider: string;
  /** Matches the `provider_ref` on the payment row written when payment began. */
  providerRef: string;
  status: 'captured' | 'failed' | 'refunded';
  /**
   * Which module owns the payment, when the gateway can carry it there and
   * back. Absent for Viva, which has no field that survives to the webhook —
   * there, the payment row is looked up instead.
   */
  subject?: PaymentSubject;
  subjectId?: number;
  method?: string;
  metadata?: Record<string, unknown>;
  /**
   * On a refund: how much of the capture has gone back IN TOTAL, in minor
   * units, when the provider states it. Absent when it does not — the applier
   * then falls back on what this site claimed (see `reconcileProviderRefund`),
   * so a partial refund is never read as a full one just for lacking a figure.
   */
  refundedTotal?: number;
}

/* ── Viva ─────────────────────────────────────────────────────────────────── */

/**
 * The Viva event types this integration acts on.
 *
 * Viva identifies events by number rather than name. These three are the
 * transaction lifecycle; every other id (payouts, account events, price
 * calculations) is ignored.
 */
export const VIVA_EVENT_PAYMENT_CREATED = 1796;
export const VIVA_EVENT_REVERSAL_CREATED = 1797;
export const VIVA_EVENT_TRANSACTION_FAILED = 1798;

export interface VivaEventLike {
  EventTypeId?: number;
  EventData?: {
    /** Viva's own id for the movement — what a refund is issued against. */
    TransactionId?: string;
    /**
     * Present, but NOT read from the parsed object: a 16-digit order code can
     * exceed `Number.MAX_SAFE_INTEGER`, so it is extracted from the raw text
     * instead (see `viva.ts#extractOrderCode`).
     */
    OrderCode?: number;
    StatusId?: string;
    Amount?: number;
  };
}

/**
 * What kind of movement a Viva event describes — or null to ignore it.
 *
 * This is all the interpretation a Viva payload gets. Unlike Stripe and PayPal
 * there is no signature, so the payload cannot establish that anything actually
 * happened; it only says which transaction to go and READ. The status is then
 * decided by `confirmTransaction`, not by anything here.
 */
export function vivaEventKind(event: VivaEventLike): 'captured' | 'failed' | 'refunded' | null {
  switch (event.EventTypeId) {
    case VIVA_EVENT_PAYMENT_CREATED:
      return 'captured';
    case VIVA_EVENT_REVERSAL_CREATED:
      return 'refunded';
    case VIVA_EVENT_TRANSACTION_FAILED:
      return 'failed';
    default:
      return null;
  }
}

interface StripeEventLike {
  type: string;
  data: { object: unknown };
}

/** Reduce a Stripe event to an outcome, or null if it is not one we act on. */
export function stripeOutcome(event: StripeEventLike): PaymentOutcome | null {
  const object = event.data.object as {
    id?: string;
    payment_intent?: string;
    /** On a charge: the running total refunded, in minor units. */
    amount_refunded?: number;
    metadata?: Record<string, string>;
    payment_method_types?: string[];
  };

  // Stripe gives us structured metadata, so the subject is two fields rather
  // than one packed string.
  const meta = object.metadata;
  const subject =
    meta?.subject && meta?.subjectId
      ? decodePaymentSubject(`${meta.subject}:${meta.subjectId}`)
      : null;
  if (!subject) return null;

  const base = { provider: STRIPE_PROVIDER_KEY, subject: subject.subject, subjectId: subject.subjectId };

  switch (event.type) {
    case 'payment_intent.succeeded':
      return object.id
        ? {
            ...base,
            providerRef: object.id,
            status: 'captured',
            method: object.payment_method_types?.[0] ?? 'card',
          }
        : null;

    case 'payment_intent.payment_failed':
      return object.id ? { ...base, providerRef: object.id, status: 'failed' } : null;

    case 'charge.refunded':
      // A charge names its intent, and the intent is what the payment row holds.
      return object.payment_intent
        ? {
            ...base,
            providerRef: object.payment_intent,
            status: 'refunded',
            ...(typeof object.amount_refunded === 'number' ? { refundedTotal: object.amount_refunded } : {}),
          }
        : null;

    default:
      return null;
  }
}

export interface PayPalEventLike {
  event_type?: string;
  resource?: {
    id?: string;
    custom_id?: string;
    status?: string;
    purchase_units?: { custom_id?: string }[];
    supplementary_data?: { related_ids?: { order_id?: string } };
    /** On a refund: the running total refunded on the capture, in major units. */
    seller_payable_breakdown?: { total_refunded_amount?: { value?: string; currency_code?: string } };
  };
}

/** PayPal's major-unit string ("12.50") in minor units, or undefined. Mirrors `toPayPalAmount`. */
function paypalMinor(value: string | undefined): number | undefined {
  if (value == null || !/^\d+(\.\d+)?$/.test(value.trim())) return undefined;
  return Math.round(Number(value) * 100);
}

/**
 * Pull our subject back out of a PayPal resource.
 *
 * A capture carries `custom_id` directly; an order event carries it on the
 * purchase unit instead. Both shapes arrive, so both are read.
 */
export function subjectFromResource(
  resource: PayPalEventLike['resource'],
): { subject: PaymentSubject; subjectId: number } | null {
  return (
    decodePaymentSubject(resource?.custom_id) ??
    decodePaymentSubject(resource?.purchase_units?.[0]?.custom_id)
  );
}

/** Reduce a PayPal event to an outcome, or null if it is not one we act on. */
export function paypalOutcome(event: PayPalEventLike): PaymentOutcome | null {
  const resource = event.resource;
  if (!resource) return null;

  const subject = subjectFromResource(resource);
  if (!subject) return null;

  // The payment row was written with the ORDER id, which is what existed when
  // payment started. A capture event names that order in `supplementary_data`;
  // without it there is nothing to match the row on.
  const orderId = resource.supplementary_data?.related_ids?.order_id;
  if (!orderId) return null;

  const base = {
    provider: PAYPAL_PROVIDER_KEY,
    providerRef: orderId,
    subject: subject.subject,
    subjectId: subject.subjectId,
  };

  switch (event.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED':
      return {
        ...base,
        status: 'captured',
        method: 'paypal',
        // Kept because a refund must target the capture, not the order.
        ...(resource.id ? { metadata: { captureId: resource.id } } : {}),
      };

    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.DECLINED':
      return { ...base, status: 'failed' };

    case 'PAYMENT.CAPTURE.REFUNDED': {
      const refundedTotal = paypalMinor(resource.seller_payable_breakdown?.total_refunded_amount?.value);
      return { ...base, status: 'refunded', ...(refundedTotal != null ? { refundedTotal } : {}) };
    }

    default:
      return null;
  }
}
