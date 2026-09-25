import 'server-only';

import { getSecret } from '../../../core/secrets/service';
import { BOXNOW_NOT_CONNECTED, COURIER_SECRET_DEFS, trackingUrlFor } from '../shipping-methods';
import type { CourierAdapter, Locker, VoucherRequest, VoucherResult } from './index';

/**
 * BoxNow: parcel lockers.
 *
 * The one courier here that is booked from the CMS, because its API is a plain
 * REST one with client credentials rather than a contract-specific portal.
 *
 * Two things this file is careful about:
 *
 * - **The access token is cached in memory**, because BoxNow's auth endpoint is
 *   rate limited and a token lasts an hour. A cold start simply fetches a new
 *   one, which is the correct behaviour for a cache that lives in a process.
 * - **The locker list is cached too.** It is thousands of entries that change
 *   monthly, and fetching it per checkout page load would be absurd.
 */

/** Entered in Settings → Ecommerce → Shipping → Couriers (see `COURIER_SECRET_DEFS`). */
export const BOXNOW_SECRET_KEYS = {
  clientId: COURIER_SECRET_DEFS[0].key,
  clientSecret: COURIER_SECRET_DEFS[1].key,
} as const;

/** Sandbox until the shop says otherwise: booking a real parcel by accident is
 *  a real parcel somebody has to cancel. */
function baseUrl(): string {
  return process.env.BOXNOW_API_URL?.trim() || 'https://api-stage.boxnow.gr/api/v1';
}

const TIMEOUT_MS = 10_000;
const LOCKER_TTL_MS = 24 * 60 * 60 * 1000;

let token: { value: string; expiresAt: number } | null = null;
let lockers: { value: Locker[]; fetchedAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  const [clientId, clientSecret] = await Promise.all([
    getSecret(BOXNOW_SECRET_KEYS.clientId),
    getSecret(BOXNOW_SECRET_KEYS.clientSecret),
  ]);
  if (!clientId || !clientSecret) {
    throw new Error(BOXNOW_NOT_CONNECTED);
  }

  const res = await fetch(`${baseUrl()}/auth-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
  } | null;
  if (!res.ok || !body?.access_token) throw new Error('BoxNow refused the credentials.');

  token = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return token.value;
}

async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await accessToken()}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok)
    throw new Error(`BoxNow ${res.status}: ${String(body?.message ?? 'request failed')}`);
  return body ?? {};
}

function toLocker(raw: Record<string, unknown>): Locker | null {
  const id = String(raw.id ?? '');
  if (!id) return null;
  const address = (raw.address ?? {}) as Record<string, unknown>;
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  return {
    id,
    name: String(raw.name ?? ''),
    address: [address.street, address.number, address.city].filter(Boolean).join(' '),
    postal: String(address.postalCode ?? ''),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

/** Every locker, cached for a day, filtered by postcode for the picker. */
async function listLockers(postal: string): Promise<Locker[]> {
  if (!lockers || Date.now() - lockers.fetchedAt > LOCKER_TTL_MS) {
    const body = await call('/destinations/');
    const raw = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
    lockers = {
      value: raw.map(toLocker).filter((locker): locker is Locker => locker !== null),
      fetchedAt: Date.now(),
    };
  }
  const wanted = postal.replace(/\s/g, '');
  if (!wanted) return lockers.value.slice(0, 50);
  // Prefix, not exact: a shopper types the first three digits of their area.
  return lockers.value
    .filter((locker) => locker.postal.replace(/\s/g, '').startsWith(wanted))
    .slice(0, 50);
}

async function createVoucher(request: VoucherRequest): Promise<VoucherResult> {
  if (!request.lockerId) throw new Error('A BoxNow delivery needs a chosen locker.');

  const body = await call('/delivery-requests', {
    method: 'POST',
    body: JSON.stringify({
      orderNumber: request.reference,
      paymentMode: request.codAmount ? 'cod' : 'prepaid',
      // Minor units here, major units there.
      amountToBeCollected: request.codAmount ? (request.codAmount / 100).toFixed(2) : undefined,
      destinationLocationId: request.lockerId,
      items: [
        {
          id: request.reference,
          name: request.reference,
          value: '0',
          weight: request.weightGrams ?? 1000,
        },
      ],
      recipient: {
        name: request.recipient.name,
        phoneNumber: request.recipient.phone,
        email: request.recipient.email,
      },
    }),
  });

  const data = (body.data ?? {}) as Record<string, unknown>;
  const parcels = Array.isArray(data.parcels) ? (data.parcels as Record<string, unknown>[]) : [];
  const voucher = String(parcels[0]?.id ?? data.id ?? '');
  if (!voucher) throw new Error('BoxNow accepted the request but returned no voucher.');

  return {
    voucher,
    trackingUrl: trackingUrlFor('boxnow', voucher),
    externalId: String(data.id ?? voucher),
  };
}

export const boxNowAdapter: CourierAdapter = {
  key: 'boxnow',
  label: 'BoxNow (locker)',
  createVoucher,
  listLockers,
  trackingUrl: (voucher) => trackingUrlFor('boxnow', voucher),
};

/** Test seam: the caches live for the life of the process otherwise. */
export function resetBoxNowCaches(): void {
  token = null;
  lockers = null;
}
