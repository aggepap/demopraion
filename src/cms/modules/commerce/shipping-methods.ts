/**
 * Shipping methods a customer chooses between, and the rules behind them.
 *
 * The older `computeShipping` stays exactly as it was and remains the fallback:
 * a site that has never opened this screen keeps the shipping it has, to the
 * cent. When a shop defines methods, this decides what the checkout offers.
 *
 * Pure — the rows come from the database, the arithmetic happens here, and the
 * whole thing is testable without one.
 */

export type CourierKey = 'acs' | 'speedex' | 'elta' | 'boxnow' | 'pickup' | 'custom';
export type MethodKind = 'address' | 'locker' | 'pickup';

export interface ShippingZoneRow {
  id: number;
  name: string;
  /** ISO-3166 alpha-2. Matched case-insensitively. */
  countries: string[];
  sort: number;
}

export interface WeightTier {
  minWeight: number;
  charge: number;
}

export interface ShippingMethodRow {
  id: number;
  zoneId: number;
  name: string;
  courier: CourierKey;
  kind: MethodKind;
  /** Minor units. */
  cost: number;
  /** Free above this subtotal (minor units). `null` = never free. */
  freeThreshold: number | null;
  weightTiers?: WeightTier[];
  etaMinDays: number | null;
  etaMaxDays: number | null;
  /** Whether cash on delivery may be used with this method. */
  codAllowed: boolean;
  active: boolean;
  sort: number;
  /** For `kind: 'pickup'` — which store. */
  pickupLocationId: string | null;
}

export interface QuoteContext {
  country: string;
  subtotalCents: number;
  totalWeight: number;
  /** The payment provider key, for the surcharge. */
  paymentProvider: string;
  /** Per-provider surcharges, as configured today in `ShippingConfig`. */
  surcharges?: Record<string, number>;
  /** True when the shopper picked cash on delivery. */
  codSelected?: boolean;
  /** A cart of downloads has nothing to ship. */
  allVirtual?: boolean;
}

export interface QuotedMethod {
  id: number;
  name: string;
  courier: CourierKey;
  kind: MethodKind;
  /** What shipping costs, after any free-shipping threshold. */
  cost: number;
  /** The payment surcharge, which the threshold never discounts. */
  surcharge: number;
  /** What the customer actually pays for this choice. */
  total: number;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  pickupLocationId: string | null;
}

/**
 * What the courier must collect on delivery, in minor units, or undefined when
 * the parcel is prepaid.
 *
 * The shop has one payment provider. An order pays on delivery when that
 * provider is offline (`manual`) and a courier delivers it — not a download,
 * not a store pickup. `amountDue` is what is left after gift cards. Written to
 * `orders.metadata.codAmount`, which the voucher reads (and ignores once the
 * order is `paid`, e.g. a bank transfer confirmed before shipping).
 */
export function codAmountFor(args: { online: boolean; delivered: boolean; amountDue: number }): number | undefined {
  if (args.online || !args.delivered || args.amountDue <= 0) return undefined;
  return args.amountDue;
}

/**
 * `codAmount` after an admin edit changed the total: what gift cards paid
 * (`prevTotal − prevCod`) stays paid, and the rest is collected. Undefined when
 * the order never had a COD amount.
 */
export function rebaseCodAmount(args: {
  prevCod: unknown;
  prevTotal: number;
  total: number;
}): number | undefined {
  if (typeof args.prevCod !== 'number' || !Number.isFinite(args.prevCod)) return undefined;
  const paidOtherwise = Math.max(0, args.prevTotal - args.prevCod);
  return Math.max(0, args.total - paidOtherwise);
}

/** The zone whose country list contains this country. */
function zoneFor(zones: readonly ShippingZoneRow[], country: string): ShippingZoneRow | undefined {
  const wanted = country.trim().toUpperCase();
  return [...zones]
    .sort((a, b) => a.sort - b.sort)
    .find((zone) => zone.countries.some((entry) => entry.trim().toUpperCase() === wanted));
}

/** The dearest tier whose minimum weight this order reaches. */
function weightCharge(tiers: readonly WeightTier[] | undefined, weight: number): number {
  if (!tiers?.length) return 0;
  return tiers
    .filter((tier) => weight >= tier.minWeight)
    .reduce((highest, tier) => Math.max(highest, tier.charge), 0);
}

/**
 * What this order may be shipped by, and what each choice costs.
 *
 * The free-shipping threshold discounts the SHIPPING and never the payment
 * surcharge: cash on delivery costs the shop the same whatever the basket is
 * worth, and a threshold that wiped it would quietly give that money away.
 */
export function quoteMethods(
  methods: readonly ShippingMethodRow[],
  zones: readonly ShippingZoneRow[],
  ctx: QuoteContext
): QuotedMethod[] {
  if (ctx.allVirtual) return [];
  const zone = zoneFor(zones, ctx.country);
  if (!zone) return [];

  const surcharge = ctx.surcharges?.[ctx.paymentProvider] ?? 0;

  return methods
    .filter((method) => method.active && method.zoneId === zone.id)
    .filter((method) => !(ctx.codSelected && !method.codAllowed))
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .map((method) => {
      const base = method.cost + weightCharge(method.weightTiers, ctx.totalWeight);
      const free = method.freeThreshold !== null && ctx.subtotalCents >= method.freeThreshold;
      const cost = free ? 0 : base;
      return {
        id: method.id,
        name: method.name,
        courier: method.courier,
        kind: method.kind,
        cost,
        surcharge,
        total: cost + surcharge,
        etaMinDays: method.etaMinDays,
        etaMaxDays: method.etaMaxDays,
        pickupLocationId: method.pickupLocationId,
      };
    });
}

/**
 * The country field used to be free text, and old orders still hold whatever
 * was typed. Zones match ISO codes, so this maps the handful of spellings that
 * actually occur — and gives up rather than guessing at anything else.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  gr: 'GR',
  greece: 'GR',
  ελλαδα: 'GR',
  ελλάδα: 'GR',
  hellas: 'GR',
  cy: 'CY',
  cyprus: 'CY',
  κυπρος: 'CY',
  κύπρος: 'CY',
};

export function normalizeCountry(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  const key = value.toLowerCase();
  return COUNTRY_ALIASES[key] ?? null;
}

/** Where a customer follows their parcel. */
const TRACKING_URLS: Partial<Record<CourierKey, string>> = {
  acs: 'https://www.acscourier.net/el/track-and-trace?trackingNumber=',
  speedex: 'https://www.speedex.gr/speedex/NewTrackAndTrace.aspx?number=',
  elta: 'https://www.elta-courier.gr/search?br=',
  boxnow: 'https://boxnow.gr/track/',
};

export function trackingUrlFor(courier: CourierKey, voucher: string): string | null {
  const base = TRACKING_URLS[courier];
  // Encoded: a voucher number reaches this from an admin form.
  return base ? `${base}${encodeURIComponent(voucher)}` : null;
}

/** What the admin calls each courier. Client-safe twin of the adapters' labels. */
export const COURIER_LABELS: Record<CourierKey, string> = {
  acs: 'ACS',
  speedex: 'Speedex',
  elta: 'ELTA Courier',
  boxnow: 'BoxNow (locker)',
  pickup: 'Collection from the shop',
  custom: 'Other',
};

/** Couriers with a locker network: the only ones a `locker` method can use. */
const LOCKER_COURIERS: readonly CourierKey[] = ['boxnow'];

/**
 * The combinations the schema allows and checkout cannot honour.
 *
 * `null` when the method is fine; otherwise one sentence naming the problem.
 */
export function checkShippingMethod(
  input: {
    courier: string;
    kind: string;
    etaMinDays: number | null;
    etaMaxDays: number | null;
    pickupLocationId: string | null;
  },
  pickupLocationIds: readonly string[],
): string | null {
  if (input.etaMinDays !== null && input.etaMaxDays !== null && input.etaMaxDays < input.etaMinDays) {
    return 'The delivery days are the wrong way round: the slowest cannot be quicker than the fastest.';
  }
  if (input.kind === 'locker' && !LOCKER_COURIERS.includes(input.courier as CourierKey)) {
    return 'A locker method needs a courier with lockers (BoxNow).';
  }
  if (input.kind === 'pickup' && (!input.pickupLocationId || !pickupLocationIds.includes(input.pickupLocationId))) {
    return 'A store pickup method needs one of the pickup locations set under Store pickup.';
  }
  return null;
}

/** The integration secrets couriers need, as `core/secrets` declares them. */
export const COURIER_SECRET_DEFS = [
  {
    key: 'courier.boxnow.clientId',
    label: 'BoxNow client ID',
    module: 'commerce',
    description: 'From your BoxNow partner account.',
  },
  {
    key: 'courier.boxnow.clientSecret',
    label: 'BoxNow client secret',
    module: 'commerce',
    description: 'From your BoxNow partner account. Stored encrypted and never shown again.',
  },
] as const satisfies readonly { key: string; label: string; module: string; description: string }[];

/** What a voucher request says when the credentials are missing. */
export const BOXNOW_NOT_CONNECTED =
  'BoxNow is not connected. Add the client ID and secret in Settings → Ecommerce → Shipping → Couriers.';

/**
 * What the Shipments section offers for an order.
 *
 * Only BoxNow is booked from here; every other courier is booked in its own
 * portal and the number typed back in. Collection from the shop has no parcel.
 */
export function shipmentActions(orderCourier: string | null): {
  createVoucher: boolean;
  trackingCouriers: CourierKey[];
} {
  return {
    createVoucher: orderCourier === 'boxnow',
    trackingCouriers: ['acs', 'speedex', 'elta', 'custom'],
  };
}
