import 'server-only';

import { getSecret } from '../../core/secrets/service';

/**
 * Talking to Google.
 *
 * Two APIs, two shapes of credential:
 *
 * - **Places (New)** needs an API key and returns at most five reviews for a
 *   place. It works the day it is switched on, which is why it exists here at
 *   all — the other one can take weeks.
 * - **Business Profile** needs OAuth against the owner's own Google account and
 *   returns every review, with the owner's replies. Google gates access to the
 *   API behind an application, so a site can be configured long before it is
 *   allowed to call it.
 *
 * The refresh token and the API key live in `integration_secrets`, encrypted.
 * Every response is `unknown` until it has been through `mapping.ts`.
 */

export const GOOGLE_SECRET_KEYS = {
  placesApiKey: 'google.places.apiKey',
  oauthRefreshToken: 'google.gbp.refreshToken',
} as const;

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1';
const OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GBP_ENDPOINT = 'https://mybusiness.googleapis.com/v4';

/** The scope that reads reviews. Business Profile has no read-only variant. */
export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';

const TIMEOUT_MS = 10_000;

async function getJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    // Google's own message, which is the only useful thing when a quota or a
    // permission is the problem. Shown in the admin, not to a visitor.
    const error = (body?.error ?? {}) as Record<string, unknown>;
    throw new Error(`Google API ${res.status}: ${String(error.message ?? 'request failed')}`);
  }
  return body ?? {};
}

/** Up to five reviews for one place. */
export async function fetchPlacesReviews(placeId: string): Promise<Record<string, unknown>[]> {
  const key = await getSecret(GOOGLE_SECRET_KEYS.placesApiKey);
  if (!key) throw new Error('No Places API key is set (Settings → Integrations).');
  const body = await getJson(`${PLACES_ENDPOINT}/places/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': key,
      // Asking for exactly what is used — the field mask is also what Google
      // bills on, so a wider one costs money for data nobody reads.
      'X-Goog-FieldMask': 'reviews,rating,userRatingCount',
    },
  });
  return Array.isArray(body.reviews) ? (body.reviews as Record<string, unknown>[]) : [];
}

/** A short-lived access token from the stored refresh token. */
export async function getGbpAccessToken(): Promise<string> {
  const refreshToken = await getSecret(GOOGLE_SECRET_KEYS.oauthRefreshToken);
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!refreshToken) throw new Error('Google Business Profile is not connected.');
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set.');
  }

  const res = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string } | null;
  if (!res.ok || !body?.access_token) {
    // A revoked connection lands here, and the admin has to reconnect.
    throw new Error('Google refused the stored connection. Reconnect the account.');
  }
  return body.access_token;
}

/** Every review for one location, following Google's paging. */
export async function fetchGbpReviews(resourceName: string): Promise<Record<string, unknown>[]> {
  const token = await getGbpAccessToken();
  const reviews: Record<string, unknown>[] = [];
  let pageToken: string | undefined;

  // Bounded: a location with tens of thousands of reviews must not hold a cron
  // job open indefinitely, and the newest pages are the ones that matter.
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${GBP_ENDPOINT}/${resourceName}/reviews`);
    url.searchParams.set('pageSize', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = await getJson(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (Array.isArray(body.reviews)) reviews.push(...(body.reviews as Record<string, unknown>[]));
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined;
    if (!pageToken) break;
  }
  return reviews;
}

/** Where the owner is sent to connect their account. */
export function gbpAuthorizeUrl(opts: { redirectUri: string; state: string }): string {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID is not set.');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GBP_SCOPE);
  // `offline` + `consent` is what actually returns a refresh token: without
  // the prompt, a second connection returns none and the sync dies overnight.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', opts.state);
  return url.toString();
}

/** Exchange the one-time code for a refresh token. */
export async function exchangeGbpCode(opts: {
  code: string;
  redirectUri: string;
}): Promise<{ refreshToken: string }> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google OAuth is not configured.');

  const res = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as { refresh_token?: string } | null;
  if (!res.ok || !body?.refresh_token) {
    throw new Error('Google did not return a refresh token. Try connecting again.');
  }
  return { refreshToken: body.refresh_token };
}
