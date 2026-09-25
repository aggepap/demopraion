/**
 * Viva.com (Viva Wallet) provider — Smart Checkout, hosted redirect.
 *
 * `start()` creates a payment order and returns the Smart Checkout link. The
 * customer pays on Viva's pages and comes back; the money is only ours once a
 * webhook arrives AND we have re-read the transaction from Viva, so `start()`
 * reports `pending`.
 *
 * Two things make Viva different from Stripe and PayPal, and both are handled
 * deliberately rather than papered over:
 *
 *  1. **Webhook POSTs carry no signature.** Viva verifies the *endpoint* once,
 *     at registration, by GETting it and expecting a key back — after that,
 *     notifications are unauthenticated HTTP. Viva's own guidance is therefore
 *     to treat the payload as a hint and re-read the transaction over the
 *     authenticated API before believing it. `confirmTransaction` below is that
 *     read, and the webhook route trusts nothing else.
 *  2. **`orderCode` is a 16-digit number.** That exceeds
 *     `Number.MAX_SAFE_INTEGER` (9007199254740991), so `JSON.parse` can silently
 *     round it and hand back an id that matches no order. Every order code is
 *     therefore pulled out of the raw response text as a string and kept as one.
 *
 * Required env (server-only — never `NEXT_PUBLIC_`):
 *   VIVA_CLIENT_ID / VIVA_CLIENT_SECRET  — Smart Checkout OAuth2 credentials
 *   VIVA_ENV                             — `demo` (default) or `live`
 *   VIVA_MERCHANT_ID / VIVA_API_KEY      — Basic-auth pair, refunds only
 *   VIVA_WEBHOOK_VERIFICATION_KEY        — answered to Viva's GET handshake
 */
import 'server-only';

import {
  type PaymentProvider,
  type PaymentRefundContext,
  type PaymentRefundResult,
  type PaymentStartContext,
  type PaymentStartResult,
} from './index';

export const VIVA_PROVIDER_KEY = 'viva';

/** `F` — the only `statusId` Viva uses for a payment that actually succeeded. */
export const VIVA_STATUS_SUCCESS = 'F';

interface VivaHosts {
  /** OAuth2 token issuance. */
  accounts: string;
  /** REST API. */
  api: string;
  /** Where the customer is sent to pay. */
  checkout: string;
}

const HOSTS: Record<'demo' | 'live', VivaHosts> = {
  demo: {
    accounts: 'https://demo-accounts.vivapayments.com',
    api: 'https://demo-api.vivapayments.com',
    checkout: 'https://demo.vivapayments.com',
  },
  live: {
    accounts: 'https://accounts.vivapayments.com',
    api: 'https://api.vivapayments.com',
    checkout: 'https://www.vivapayments.com',
  },
};

/** Anything other than an explicit `live` stays on demo — defaulting the other
 *  way would let a missing variable quietly move real money. */
export function vivaHosts(): VivaHosts {
  return process.env.VIVA_ENV === 'live' ? HOSTS.live : HOSTS.demo;
}

interface VivaEnv {
  clientId: string;
  clientSecret: string;
}

function readEnv(): VivaEnv {
  const clientId = process.env.VIVA_CLIENT_ID;
  const clientSecret = process.env.VIVA_CLIENT_SECRET;

  const missing = [
    ['VIVA_CLIENT_ID', clientId],
    ['VIVA_CLIENT_SECRET', clientSecret],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(`Missing Viva env vars: ${missing.join(', ')}`);
  }
  return { clientId: clientId!, clientSecret: clientSecret! };
}

/**
 * The key Viva expects back when it GETs the webhook URL to verify it.
 *
 * Held as configuration rather than fetched: it is generated once from Viva's
 * own "generate webhook verification key" call and never changes, and reading
 * it from the environment means the handshake cannot fail because an API call
 * did.
 */
export function readVivaWebhookKey(): string | null {
  const key = process.env.VIVA_WEBHOOK_VERIFICATION_KEY;
  return key && key.trim() ? key.trim() : null;
}

/**
 * The Basic-auth pair, used only for refunds.
 *
 * Viva's cancel/refund call predates its OAuth surface and still authenticates
 * with the merchant id and API key, which are separate credentials from the
 * Smart Checkout client pair. Kept apart from `readEnv` so that TAKING money
 * never fails because the refund credentials were not configured.
 */
function readRefundCredentials(): { merchantId: string; apiKey: string } | null {
  const merchantId = process.env.VIVA_MERCHANT_ID;
  const apiKey = process.env.VIVA_API_KEY;
  if (!merchantId || !apiKey) return null;
  return { merchantId, apiKey };
}

/**
 * Pull an order code out of raw JSON as a STRING.
 *
 * Never `JSON.parse(...).orderCode`: a 16-digit code can exceed
 * `Number.MAX_SAFE_INTEGER`, and the rounded result matches no order. Matches
 * both `orderCode` (API responses) and `OrderCode` (webhook payloads), quoted
 * or bare.
 */
export function extractOrderCode(rawJson: string): string | null {
  const match = rawJson.match(/"orderCode"\s*:\s*"?(\d{1,25})"?/i);
  return match ? match[1] : null;
}

/** As above, for the transaction id Viva puts on a webhook payload. */
export function extractTransactionId(rawJson: string): string | null {
  const match = rawJson.match(/"transactionId"\s*:\s*"([^"]+)"/i);
  return match ? match[1] : null;
}

let token: { value: string; expiresAt: number } | null = null;

/** An OAuth access token, reused until shortly before it lapses. */
async function getAccessToken(): Promise<string> {
  const env = readEnv();
  // 60s of headroom: a token that expires in flight would fail the call it was
  // fetched for.
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  const basic = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64');
  const res = await fetch(`${vivaHosts().accounts}/connect/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Viva token request failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Viva token response had no access_token.');

  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** Test seam — drops the memoised token. */
export function resetVivaToken(): void {
  token = null;
}

/** Authenticated call returning the RAW body, so order codes survive intact. */
async function vivaFetchRaw(
  path: string,
  init: { method: string; body?: unknown },
): Promise<string> {
  const accessToken = await getAccessToken();
  const res = await fetch(`${vivaHosts().api}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Viva ${init.method} ${path} failed (${res.status}): ${text}`);
  }
  return text;
}

/** The Smart Checkout page for an order code. */
export function checkoutUrl(orderCode: string): string {
  return `${vivaHosts().checkout}/web/checkout?ref=${encodeURIComponent(orderCode)}`;
}

export interface VivaTransaction {
  orderCode: string | null;
  statusId: string | null;
  /** As Viva reported it — see `amountMatches` for why this is not normalised. */
  amount: number | null;
  currencyCode: string | null;
}

/**
 * Does a reported amount correspond to what we charged?
 *
 * Viva takes the order amount in cents but reports transaction amounts in major
 * units, and which of the two a given endpoint uses has moved between API
 * versions. Accepting either reading is deliberate: the alternative is a
 * validation that rejects perfectly good payments after the money has moved.
 * The order code is the strong binding; this is a sanity check on top of it.
 */
export function amountMatches(expectedMinor: number, reported: number | null): boolean {
  if (reported == null) return false;
  return Math.abs(reported - expectedMinor) < 1 || Math.abs(Math.round(reported * 100) - expectedMinor) < 1;
}

/**
 * Read a transaction back from Viva.
 *
 * This is the security boundary for the whole Viva integration. A webhook POST
 * proves nothing — it is unsigned, and anyone who learns the URL can send one —
 * so nothing is believed until it has been read back from an authenticated API
 * call and checked against what we expected.
 */
export async function confirmTransaction(transactionId: string): Promise<VivaTransaction> {
  const raw = await vivaFetchRaw(`/checkout/v2/transactions/${encodeURIComponent(transactionId)}`, {
    method: 'GET',
  });
  const parsed = JSON.parse(raw) as { statusId?: string; amount?: number; currencyCode?: string };
  return {
    // From the raw text, not the parsed object — precision again.
    orderCode: extractOrderCode(raw),
    statusId: parsed.statusId ?? null,
    amount: typeof parsed.amount === 'number' ? parsed.amount : null,
    currencyCode: parsed.currencyCode ?? null,
  };
}

export const vivaProvider: PaymentProvider = {
  key: VIVA_PROVIDER_KEY,
  label: 'Viva.com (card)',

  async start(ctx: PaymentStartContext): Promise<PaymentStartResult> {
    const raw = await vivaFetchRaw('/checkout/v2/orders', {
      method: 'POST',
      body: {
        // Cents, which is what this codebase stores throughout.
        amount: ctx.amount,
        customerTrns: ctx.reference,
        // Shown on the merchant's own statements and in the Viva portal, which
        // is what makes a payment traceable back to a booking or order.
        merchantTrns: ctx.reference,
        customer: {
          email: ctx.email,
          requestLang: 'el-GR',
        },
        // Viva expires the order itself if the customer wanders off, so an
        // abandoned checkout does not leave a payable link lying around.
        paymentTimeout: 1800,
        // Viva has no `custom_id` equivalent that survives to the webhook, and
        // the webhook is re-read from the API anyway — so the subject is not
        // round-tripped through Viva at all. The order code recorded on the
        // payment row is what ties an event back to what was bought. The tags
        // are for a human reading the Viva portal, nothing more.
        tags: [ctx.subject, String(ctx.subjectId)],
      },
    });
    // NOTE: `ctx.returnUrl` is deliberately not sent. Unlike PayPal, Viva takes
    // its success and failure redirects from the payment SOURCE configured in
    // the Viva portal, not from the order — so the return URL is set up there,
    // once, against the source code these credentials belong to.

    const orderCode = extractOrderCode(raw);
    if (!orderCode) {
      return { status: 'failed', error: 'Viva returned no order code.' };
    }

    return {
      status: 'pending',
      // The ORDER code, as a string. Every webhook for this payment resolves
      // back to it, so it is what the payment row is matched on.
      providerRef: orderCode,
      redirectUrl: checkoutUrl(orderCode),
      method: 'card',
    };
  },

  async refund(ctx: PaymentRefundContext): Promise<PaymentRefundResult> {
    const credentials = readRefundCredentials();
    if (!credentials) {
      return {
        status: 'failed',
        error: 'Viva refunds need VIVA_MERCHANT_ID and VIVA_API_KEY to be set.',
      };
    }

    try {
      // Note this takes the TRANSACTION id, not the order code — the caller
      // resolves it from the payment row's `metadata.transactionId`, recorded
      // when the capture was confirmed.
      const basic = Buffer.from(`${credentials.merchantId}:${credentials.apiKey}`).toString('base64');
      const params = new URLSearchParams();
      if (ctx.amount != null) params.set('amount', String(ctx.amount));
      params.set('currencyCode', ctx.currency.toUpperCase());

      const res = await fetch(
        `${vivaHosts().api}/api/transactions/${encodeURIComponent(ctx.providerRef)}?${params}`,
        { method: 'DELETE', headers: { Authorization: `Basic ${basic}` } },
      );

      const text = await res.text();
      if (!res.ok) {
        return { status: 'failed', error: `Viva refused the refund (${res.status}): ${text}` };
      }

      const parsed = JSON.parse(text) as { TransactionId?: string; ErrorCode?: number };
      if (parsed.ErrorCode) {
        return { status: 'failed', error: `Viva refund error ${parsed.ErrorCode}.` };
      }
      return { status: 'refunded', providerRef: parsed.TransactionId ?? undefined };
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : 'Viva refund failed.' };
    }
  },
};
