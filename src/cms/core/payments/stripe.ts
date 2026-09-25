/**
 * Stripe provider — card payments collected in-page with the Payment Element.
 *
 * `start()` creates a PaymentIntent and hands back its client secret; the
 * browser mounts the Element against it and confirms. No card data reaches this
 * server. The money is not ours until `payment_intent.succeeded` arrives at the
 * webhook, so `start()` deliberately reports `pending`.
 *
 * Required env (server-only — never `NEXT_PUBLIC_`):
 *   STRIPE_SECRET_KEY     — `sk_…`, the account's secret key
 *   STRIPE_WEBHOOK_SECRET — `whsec_…`, the signing secret for the webhook
 *                           endpoint (read separately; only the webhook needs it)
 *
 * The publishable key is NOT read here. It is browser-safe by design and
 * reaches the client as `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, so routing it
 * through this file would only add a hop.
 */
import 'server-only';

import Stripe from 'stripe';

import {
  encodePaymentSubject,
  type PaymentProvider,
  type PaymentRefundContext,
  type PaymentRefundResult,
  type PaymentStartContext,
  type PaymentStartResult,
} from './index';

/**
 * Pinned rather than left to the account default: the SDK's types describe this
 * exact version, and an account-level upgrade in the Stripe dashboard would
 * otherwise change payload shapes under code that still type-checks.
 */
const STRIPE_API_VERSION = '2026-08-26.dahlia';

export const STRIPE_PROVIDER_KEY = 'stripe';

function readSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing Stripe env vars: STRIPE_SECRET_KEY');
  return key;
}

/**
 * The webhook signing secret, read on its own.
 *
 * Kept apart from `readSecretKey` so that taking a payment does not fail merely
 * because the webhook endpoint has not been registered yet — they are
 * configured at different times, and one missing should not mask the other.
 */
export function readStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('Missing Stripe env vars: STRIPE_WEBHOOK_SECRET');
  return secret;
}

let client: Stripe | null = null;

/** The shared Stripe client, built on first use so an unconfigured deployment
 *  fails at call time rather than at import. */
export function getStripeClient(): Stripe {
  if (!client) {
    client = new Stripe(readSecretKey(), { apiVersion: STRIPE_API_VERSION, typescript: true });
  }
  return client;
}

/** Test seam — drops the memoised client so a changed key is picked up. */
export function resetStripeClient(): void {
  client = null;
}

export const stripeProvider: PaymentProvider = {
  key: STRIPE_PROVIDER_KEY,
  label: 'Card (Stripe)',

  async start(ctx: PaymentStartContext): Promise<PaymentStartResult> {
    const stripe = getStripeClient();

    const intent = await stripe.paymentIntents.create(
      {
        amount: ctx.amount,
        currency: ctx.currency.toLowerCase(),
        receipt_email: ctx.email,
        // Lets Stripe present whatever the account has enabled (cards, wallets)
        // without this code enumerating payment method types.
        automatic_payment_methods: { enabled: true },
        description: ctx.reference,
        metadata: {
          subject: ctx.subject,
          subjectId: String(ctx.subjectId),
          reference: ctx.reference,
        },
      },
      {
        // Retrying `start()` for the same subject and amount must return the
        // SAME intent, so the `(provider, provider_ref)` row stays unique and
        // the customer is never shown two live intents for one booking.
        idempotencyKey: `${encodePaymentSubject(ctx.subject, ctx.subjectId)}:${ctx.amount}`,
      },
    );

    return {
      status: 'pending',
      providerRef: intent.id,
      clientSecret: intent.client_secret ?? undefined,
      method: 'card',
      redirectUrl: null,
    };
  },

  async refund(ctx: PaymentRefundContext): Promise<PaymentRefundResult> {
    const stripe = getStripeClient();
    try {
      const refund = await stripe.refunds.create({
        payment_intent: ctx.providerRef,
        ...(ctx.amount != null ? { amount: ctx.amount } : {}),
      });
      // A refund can come back `pending` (some methods settle asynchronously);
      // the webhook is what finally confirms it, so anything not outright
      // failed is reported as refunded here and reconciled later.
      return refund.status === 'failed'
        ? { status: 'failed', providerRef: refund.id, error: 'Stripe rejected the refund.' }
        : { status: 'refunded', providerRef: refund.id };
    } catch (err) {
      // The message may name the account or the customer; keep it for the admin
      // audit trail but never surface it to a storefront visitor.
      return { status: 'failed', error: err instanceof Error ? err.message : 'Stripe refund failed.' };
    }
  },
};
