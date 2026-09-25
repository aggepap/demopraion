/**
 * PayPal provider — hosted redirect (Orders v2).
 *
 * `start()` creates an order and returns the link PayPal wants the customer
 * sent to. They approve on PayPal's own pages and come back; the money is only
 * ours once `PAYMENT.CAPTURE.COMPLETED` reaches the webhook, so `start()`
 * reports `pending`.
 *
 * Raw `fetch` rather than a PayPal SDK, matching `core/email/graph.ts`: the
 * three calls involved are plain JSON, and PayPal's webhook verification is a
 * remote API call rather than local crypto, so an SDK would carry almost
 * nothing here.
 *
 * Required env (server-only — never `NEXT_PUBLIC_`):
 *   PAYPAL_CLIENT_ID     — REST app client id
 *   PAYPAL_CLIENT_SECRET — REST app secret
 *   PAYPAL_WEBHOOK_ID    — the registered webhook's id (verification needs it;
 *                          read separately, only by the webhook path)
 *   PAYPAL_ENV           — `sandbox` (default) or `live`
 */
import 'server-only';

import {
  encodePaymentSubject,
  type PaymentProvider,
  type PaymentRefundContext,
  type PaymentRefundResult,
  type PaymentStartContext,
  type PaymentStartResult,
} from './index';

export const PAYPAL_PROVIDER_KEY = 'paypal';

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const LIVE_BASE = 'https://api-m.paypal.com';

interface PayPalEnv {
  clientId: string;
  clientSecret: string;
  base: string;
}

function readEnv(): PayPalEnv {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  const missing = [
    ['PAYPAL_CLIENT_ID', clientId],
    ['PAYPAL_CLIENT_SECRET', clientSecret],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(`Missing PayPal env vars: ${missing.join(', ')}`);
  }

  // Anything other than an explicit `live` stays on sandbox. Defaulting the
  // other way would mean a missing variable quietly moves real money.
  const base = process.env.PAYPAL_ENV === 'live' ? LIVE_BASE : SANDBOX_BASE;
  return { clientId: clientId!, clientSecret: clientSecret!, base };
}

/** The registered webhook's id. Separate from `readEnv` so taking a payment
 *  does not fail merely because the webhook has not been registered yet. */
export function readPayPalWebhookId(): string {
  const id = process.env.PAYPAL_WEBHOOK_ID;
  if (!id) throw new Error('Missing PayPal env vars: PAYPAL_WEBHOOK_ID');
  return id;
}

export function paypalBaseUrl(): string {
  return readEnv().base;
}

let token: { value: string; expiresAt: number } | null = null;

/** An OAuth access token, reused until shortly before it lapses. */
async function getAccessToken(): Promise<string> {
  const env = readEnv();
  // 60s of headroom: a token that expires in flight would fail the call it was
  // fetched for.
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  const basic = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64');
  const res = await fetch(`${env.base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`PayPal token request failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('PayPal token response had no access_token.');

  token = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return token.value;
}

/** Test seam — drops the memoised token. */
export function resetPayPalToken(): void {
  token = null;
}

/** Authenticated JSON call against the PayPal REST API. */
async function payPalFetch<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  const env = readEnv();
  const accessToken = await getAccessToken();

  const res = await fetch(`${env.base}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`PayPal ${init.method} ${path} failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as T;
}

/**
 * Minor units to PayPal's decimal string.
 *
 * Every currency this site offers (EUR/USD/GBP — `ECOMMERCE_CURRENCIES`) has
 * two decimal places. A zero-decimal currency such as JPY would need a
 * different divisor, so adding one to that list means revisiting this.
 */
export function toPayPalAmount(minor: number): string {
  return (minor / 100).toFixed(2);
}

interface PayPalOrderResponse {
  id: string;
  status?: string;
  links?: { href: string; rel: string; method?: string }[];
}

/**
 * The link the customer must be sent to.
 *
 * `payer-action` is what the `payment_source` flow returns; `approve` is the
 * older shape. Accepting either means the integration survives PayPal moving
 * between them.
 */
export function approvalLink(order: PayPalOrderResponse): string | null {
  const links = order.links ?? [];
  const match = links.find((l) => l.rel === 'payer-action') ?? links.find((l) => l.rel === 'approve');
  return match?.href ?? null;
}

export const paypalProvider: PaymentProvider = {
  key: PAYPAL_PROVIDER_KEY,
  label: 'PayPal',

  async start(ctx: PaymentStartContext): Promise<PaymentStartResult> {
    const order = await payPalFetch<PayPalOrderResponse>('/v2/checkout/orders', {
      method: 'POST',
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: ctx.reference,
            // Round-trips through PayPal untouched and comes back on the
            // capture event — this is how the webhook knows what was paid for.
            custom_id: encodePaymentSubject(ctx.subject, ctx.subjectId),
            amount: {
              currency_code: ctx.currency.toUpperCase(),
              value: toPayPalAmount(ctx.amount),
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: 'PAY_NOW',
              ...(ctx.returnUrl ? { return_url: ctx.returnUrl, cancel_url: ctx.returnUrl } : {}),
            },
          },
        },
      },
    });

    const redirectUrl = approvalLink(order);
    if (!redirectUrl) {
      return { status: 'failed', providerRef: order.id, error: 'PayPal returned no approval link.' };
    }

    return {
      status: 'pending',
      // The ORDER id, not a capture id — it is known now and is what the
      // capture event refers back to, so the payment row can be matched later.
      providerRef: order.id,
      redirectUrl,
      method: 'paypal',
    };
  },

  async refund(ctx: PaymentRefundContext): Promise<PaymentRefundResult> {
    try {
      // Note this takes the CAPTURE id, not the order id — the caller resolves
      // it from the payment row's `metadata.captureId`.
      const refund = await payPalFetch<{ id: string; status?: string }>(
        `/v2/payments/captures/${encodeURIComponent(ctx.providerRef)}/refund`,
        {
          method: 'POST',
          ...(ctx.amount != null
            ? {
                body: {
                  amount: { currency_code: ctx.currency.toUpperCase(), value: toPayPalAmount(ctx.amount) },
                },
              }
            : {}),
        },
      );
      return refund.status === 'FAILED'
        ? { status: 'failed', providerRef: refund.id, error: 'PayPal rejected the refund.' }
        : { status: 'refunded', providerRef: refund.id };
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : 'PayPal refund failed.' };
    }
  },
};

/**
 * Capture an approved order. PayPal's redirect only means the customer said
 * yes; the money moves when we ask for it.
 */
export async function capturePayPalOrder(orderId: string): Promise<{
  captureId: string | null;
  status: string | null;
}> {
  const captured = await payPalFetch<{
    status?: string;
    purchase_units?: { payments?: { captures?: { id: string; status?: string }[] } }[];
  }>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST' });

  const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
  return { captureId: capture?.id ?? null, status: capture?.status ?? captured.status ?? null };
}

/**
 * Ask PayPal whether this delivery really came from them.
 *
 * Unlike Stripe there is no local signature to check — the transmission headers
 * go back to PayPal and it answers. Returns false on any error, so a network
 * failure cannot be mistaken for a valid event.
 */
export async function verifyPayPalWebhook(
  headers: Headers,
  rawBody: string,
): Promise<boolean> {
  const required = [
    'paypal-transmission-id',
    'paypal-transmission-time',
    'paypal-cert-url',
    'paypal-auth-algo',
    'paypal-transmission-sig',
  ];
  if (required.some((h) => !headers.get(h))) return false;

  try {
    const result = await payPalFetch<{ verification_status?: string }>(
      '/v1/notifications/verify-webhook-signature',
      {
        method: 'POST',
        body: {
          transmission_id: headers.get('paypal-transmission-id'),
          transmission_time: headers.get('paypal-transmission-time'),
          cert_url: headers.get('paypal-cert-url'),
          auth_algo: headers.get('paypal-auth-algo'),
          transmission_sig: headers.get('paypal-transmission-sig'),
          webhook_id: readPayPalWebhookId(),
          webhook_event: JSON.parse(rawBody),
        },
      },
    );
    return result.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}
