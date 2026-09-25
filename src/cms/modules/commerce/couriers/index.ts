import 'server-only';

import type { CourierKey } from '../shipping-methods';
import { COURIER_LABELS, trackingUrlFor } from '../shipping-methods';
import { boxNowAdapter } from './boxnow';

/**
 * What a courier can do for us.
 *
 * Deliberately small. Every courier can be tracked, because tracking is a URL.
 * Only some can create a voucher from here — the rest need a contract, a
 * portal login and a printer, so the admin types the number in and the order
 * carries it. An adapter that pretended to book a parcel it cannot book would
 * be worse than no adapter.
 */

export interface VoucherRequest {
  orderId: number;
  reference: string;
  /** Minor units; only set when the customer pays on delivery. */
  codAmount?: number;
  recipient: {
    name: string;
    phone: string;
    email: string;
    address1: string;
    city: string;
    postal: string;
    country: string;
  };
  /** For a locker delivery: which locker the customer chose. */
  lockerId?: string;
  weightGrams?: number;
}

export interface VoucherResult {
  voucher: string;
  trackingUrl: string | null;
  externalId: string | null;
}

export interface Locker {
  id: string;
  name: string;
  address: string;
  postal: string;
  latitude: number | null;
  longitude: number | null;
}

export interface CourierAdapter {
  key: CourierKey;
  label: string;
  /** Present only for a courier we can actually book with. */
  createVoucher?: (request: VoucherRequest) => Promise<VoucherResult>;
  /** Present only for a locker network. */
  listLockers?: (postal: string) => Promise<Locker[]>;
  trackingUrl: (voucher: string) => string | null;
}

/** ACS, Speedex and ELTA: tracked from here, booked in their own portal. */
function manualAdapter(key: CourierKey, label: string): CourierAdapter {
  return { key, label, trackingUrl: (voucher) => trackingUrlFor(key, voucher) };
}

export const COURIERS: Record<CourierKey, CourierAdapter> = {
  acs: manualAdapter('acs', COURIER_LABELS.acs),
  speedex: manualAdapter('speedex', COURIER_LABELS.speedex),
  elta: manualAdapter('elta', COURIER_LABELS.elta),
  boxnow: boxNowAdapter,
  pickup: { key: 'pickup', label: COURIER_LABELS.pickup, trackingUrl: () => null },
  custom: { key: 'custom', label: COURIER_LABELS.custom, trackingUrl: () => null },
};

export function courierFor(key: string): CourierAdapter | null {
  return Object.hasOwn(COURIERS, key) ? COURIERS[key as CourierKey] : null;
}

export { boxNowAdapter };
