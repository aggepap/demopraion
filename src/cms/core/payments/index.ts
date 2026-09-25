/**
 * The provider-agnostic payment seam.
 *
 * Promoted out of the commerce module when booking needed the same interface:
 * both modules must work with the other switched off, so neither can own the
 * contract. Core owns the interface and the registry; each module keeps its own
 * payment ROWS (`payments` for orders, `reservation_payments` for bookings),
 * because those genuinely differ.
 *
 * Registered providers live in sibling files (`stripe.ts`, `paypal.ts`) and are
 * attached by `register.ts`, which every route that resolves a provider imports
 * for its side effect. To add another:
 *   1. implement `PaymentProvider.start()` — create an intent, return a redirect
 *      URL, a client secret, and/or a provider ref,
 *   2. register it in `register.ts`,
 *   3. add its key to the relevant module's provider setting options,
 *   4. teach the webhook route its events.
 *
 * Pure data and functions — no DB, no `server-only`, no provider SDK — so a
 * module can import it without dragging in a database connection, and so the
 * admin settings form can reach it from the client. The provider files are
 * where secrets and network calls live; this file must stay importable
 * anywhere.
 */

export const PAYMENT_STATUSES = ['pending', 'authorized', 'captured', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Which module a payment belongs to.
 *
 * Carried through the provider (Stripe metadata, PayPal `custom_id`) and back
 * on the webhook, because one endpoint per provider serves both modules — the
 * gateway dashboard should not need a separate URL per feature.
 */
export const PAYMENT_SUBJECTS = ['order', 'reservation'] as const;
export type PaymentSubject = (typeof PAYMENT_SUBJECTS)[number];

export interface PaymentStartContext {
  /** Which module owns `subjectId` — an order, or a reservation. */
  subject: PaymentSubject;
  /** What is being paid for — an order id or a reservation id. */
  subjectId: number;
  /** The customer-facing reference, for the provider's own records. */
  reference: string;
  /** Amount in minor units (cents). */
  amount: number;
  currency: string;
  email: string;
  /** Where to send the customer afterwards, when the provider is hosted. */
  returnUrl?: string;
}

export interface PaymentStartResult {
  status: PaymentStatus;
  /** External payment/charge id, when the provider issues one. */
  providerRef?: string;
  /** URL to send the customer to; null for offline/manual settlement. */
  redirectUrl?: string | null;
  /**
   * Confirmation token for an in-page form (Stripe's Payment Element). Set
   * instead of `redirectUrl` by providers that collect details on our own page.
   * The two are alternatives: the caller mounts a form, or it navigates.
   */
  clientSecret?: string;
  method?: string;
  error?: string;
}

export interface PaymentRefundContext {
  /** The `providerRef` recorded when the money was taken. */
  providerRef: string;
  /** Minor units. Omit for a full refund. */
  amount?: number;
  currency: string;
  reason?: string;
}

export interface PaymentRefundResult {
  status: 'refunded' | 'failed';
  /** The refund's own id, distinct from the payment's. */
  providerRef?: string;
  error?: string;
}

export interface PaymentProvider {
  key: string;
  label: string;
  /**
   * Begin a payment. Manual/offline records a pending payment and returns no
   * redirect; a hosted provider creates an intent and returns one.
   */
  start(ctx: PaymentStartContext): Promise<PaymentStartResult>;
  /**
   * Send the money back. Optional: `manual` has nothing to call, and a provider
   * without it is refunded out of band, so callers must check before offering
   * the action rather than assume.
   */
  refund?(ctx: PaymentRefundContext): Promise<PaymentRefundResult>;
}

/**
 * The default: settle out of band — bank transfer, cash on arrival.
 *
 * This is what makes "pay later" and "instant booking" both work with no
 * gateway configured. The date is genuinely taken either way; only the money
 * moves differently.
 */
export const manualProvider: PaymentProvider = {
  key: 'manual',
  label: 'Manual / bank transfer',
  async start() {
    return { status: 'pending', redirectUrl: null };
  },
};

const PROVIDERS: Record<string, PaymentProvider> = {
  [manualProvider.key]: manualProvider,
};

/** Add a provider to the registry. Idempotent by key — last registration wins. */
export function registerPaymentProvider(provider: PaymentProvider): void {
  PROVIDERS[provider.key] = provider;
}

export function paymentProviderKeys(): string[] {
  return Object.keys(PROVIDERS);
}

/** Resolve a provider by key, falling back to manual rather than throwing. */
export function getPaymentProvider(key?: string | null): PaymentProvider {
  return (key && PROVIDERS[key]) || manualProvider;
}

/** Does this provider actually take money online? */
export function isOnlineProvider(provider: PaymentProvider): boolean {
  return provider.key !== manualProvider.key;
}

/** Can this provider send money back without someone visiting a bank? */
export function canRefundOnline(provider: PaymentProvider): boolean {
  return typeof provider.refund === 'function';
}

/**
 * Encode the subject for providers that give us one opaque string to round-trip
 * (PayPal's `custom_id`). Stripe gets structured metadata instead and does not
 * need this.
 */
export function encodePaymentSubject(subject: PaymentSubject, subjectId: number): string {
  return `${subject}:${subjectId}`;
}

/** Inverse of `encodePaymentSubject`. Returns null for anything unrecognised. */
export function decodePaymentSubject(
  value: string | null | undefined,
): { subject: PaymentSubject; subjectId: number } | null {
  if (!value) return null;
  const [subject, rawId] = value.split(':');
  if (!PAYMENT_SUBJECTS.includes(subject as PaymentSubject)) return null;
  const subjectId = Number(rawId);
  // A non-numeric or non-positive id is a malformed reference, not a lookup
  // that happens to miss — treat it the same as an unknown subject.
  if (!Number.isInteger(subjectId) || subjectId <= 0) return null;
  return { subject: subject as PaymentSubject, subjectId };
}
