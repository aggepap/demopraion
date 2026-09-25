/**
 * Shipping cost engine — admin-configurable (Settings → Shipping).
 *
 * Config is stored as a structured JSON blob under `ecommerce.shipping`. The
 * checkout re-computes shipping server-side (never trusts the client), the same
 * way the storefront quote endpoint does. Charges are authored in MAJOR units;
 * this module returns MINOR units (cents) to match the orders tables. VAT is
 * included in prices, so there is no tax line.
 */
import 'server-only';

import { z } from 'zod';

import { createRoute, ECOMMERCE_SHIPPING_KEY, getSetting, ok } from '../../core';
import { getConfiguredPaymentProvider } from './payments';
import { getProduct, getSiteCurrency, resolvePrice } from './read';

export type ShippingMethod = 'flat' | 'weight' | 'zone';

/** How the order reaches the customer: delivered, or collected in store (§8). */
export type DeliveryMethod = 'ship' | 'pickup';

/** Additional charge applied when total cart weight ≥ `minWeight`. */
export interface ShippingWeightTier {
  minWeight: number;
  charge: number;
}
/** Flat charge for a set of destination countries. */
export interface ShippingZone {
  name: string;
  countries: string[];
  charge: number;
}
/** Extra fee for a specific payment provider (e.g. cash-on-delivery). */
export interface PaymentSurcharge {
  provider: string;
  charge: number;
}

/** A store the customer can collect from (§8). `id` is stored on the order. */
export interface PickupLocation {
  id: string;
  name: string;
  address?: string;
  /** Free-text opening hours, shown at checkout. */
  hours?: string;
}

/** Store-pickup option — off by default, so nothing changes for existing sites. */
export interface PickupConfig {
  enabled: boolean;
  /** Handling charge for collecting in store (major units; normally 0). */
  charge: number;
  locations: PickupLocation[];
}

export interface ShippingConfig {
  method: ShippingMethod;
  /** Standard charge (major units). */
  baseCharge: number;
  /** Free shipping when subtotal ≥ this (major units). 0 = disabled. */
  freeThreshold: number;
  weightTiers: ShippingWeightTier[];
  zones: ShippingZone[];
  paymentSurcharges: PaymentSurcharge[];
  pickup: PickupConfig;
}

export const DEFAULT_PICKUP_CONFIG: PickupConfig = { enabled: false, charge: 0, locations: [] };

export const DEFAULT_SHIPPING_CONFIG: ShippingConfig = {
  method: 'flat',
  baseCharge: 0,
  freeThreshold: 0,
  weightTiers: [],
  zones: [],
  paymentSurcharges: [],
  pickup: DEFAULT_PICKUP_CONFIG,
};

const toCents = (major: number): number => Math.round((Number(major) || 0) * 100);

/**
 * Normalise the stored pickup block. Locations need a name to be selectable;
 * a missing `id` falls back to the index so older/hand-edited settings still
 * resolve to a stable key.
 */
export function normalisePickup(raw: unknown): PickupConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_PICKUP_CONFIG;
  const cfg = raw as Partial<PickupConfig>;
  const locations = (Array.isArray(cfg.locations) ? cfg.locations : [])
    .map((loc, i) => ({
      id: String(loc?.id ?? '').trim() || `loc-${i + 1}`,
      name: String(loc?.name ?? '').trim(),
      address: String(loc?.address ?? '').trim() || undefined,
      hours: String(loc?.hours ?? '').trim() || undefined,
    }))
    .filter((loc) => loc.name.length > 0);
  return { enabled: cfg.enabled === true, charge: Number(cfg.charge) || 0, locations };
}

/** Read + normalise the stored shipping config (falls back to defaults). */
export async function getShippingConfig(): Promise<ShippingConfig> {
  const raw = await getSetting<Partial<ShippingConfig>>(ECOMMERCE_SHIPPING_KEY);
  if (!raw || typeof raw !== 'object') return DEFAULT_SHIPPING_CONFIG;
  return {
    method: raw.method === 'weight' || raw.method === 'zone' ? raw.method : 'flat',
    baseCharge: Number(raw.baseCharge) || 0,
    freeThreshold: Number(raw.freeThreshold) || 0,
    weightTiers: Array.isArray(raw.weightTiers) ? raw.weightTiers : [],
    zones: Array.isArray(raw.zones) ? raw.zones : [],
    paymentSurcharges: Array.isArray(raw.paymentSurcharges) ? raw.paymentSurcharges : [],
    pickup: normalisePickup(raw.pickup),
  };
}

/**
 * Whether this cart may be collected in store: the option is on, and there's
 * something physical to collect (a digital-only cart has nothing to hand over).
 */
export function pickupAvailable(config: ShippingConfig): boolean {
  return config.pickup.enabled;
}

/**
 * The chosen pickup location. With locations configured an unknown/absent id
 * resolves to nothing (the caller rejects it); with none configured there is a
 * single implicit "the store", so `undefined` is a valid answer.
 */
export function findPickupLocation(
  config: ShippingConfig,
  id: string | undefined,
): PickupLocation | undefined {
  const list = config.pickup.locations;
  if (list.length === 0) return undefined;
  const wanted = (id ?? '').trim();
  return list.find((loc) => loc.id === wanted);
}

export interface ShippingContext {
  subtotalCents: number;
  /** Total cart weight in the product weight unit (assumed kg). */
  totalWeight: number;
  country: string;
  providerKey: string;
  /** `pickup` charges the store-pickup fee instead of shipping. Default `ship`. */
  delivery?: DeliveryMethod;
}

/** Compute shipping + payment surcharge, both in minor units (cents). */
export function computeShipping(
  config: ShippingConfig,
  ctx: ShippingContext,
): { shipping: number; surcharge: number } {
  // Store pickup replaces the shipping calculation with its own (usually zero)
  // handling fee — no zones, no weight tiers, no free-shipping threshold. An
  // unavailable pickup falls back to shipping (the write path rejects it too).
  if (ctx.delivery === 'pickup' && pickupAvailable(config)) {
    return {
      shipping: toCents(config.pickup.charge),
      surcharge: toCents(
        config.paymentSurcharges.find((p) => p.provider === ctx.providerKey)?.charge ?? 0,
      ),
    };
  }

  let shipping = 0;
  const free = config.freeThreshold > 0 && ctx.subtotalCents >= toCents(config.freeThreshold);
  if (!free) {
    if (config.method === 'flat') {
      shipping = toCents(config.baseCharge);
    } else if (config.method === 'weight') {
      shipping = toCents(config.baseCharge);
      const tier = [...config.weightTiers]
        .filter((t) => typeof t.minWeight === 'number')
        .sort((a, b) => b.minWeight - a.minWeight)
        .find((t) => ctx.totalWeight >= t.minWeight);
      if (tier) shipping += toCents(tier.charge);
    } else {
      const country = ctx.country.trim().toLowerCase();
      const zone = config.zones.find((z) =>
        (z.countries ?? []).some((c) => c.trim().toLowerCase() === country),
      );
      shipping = toCents(zone ? zone.charge : config.baseCharge);
    }
  }
  const surcharge = toCents(
    config.paymentSurcharges.find((p) => p.provider === ctx.providerKey)?.charge ?? 0,
  );
  return { shipping, surcharge };
}

/** Weight of one line's product (variation weight overrides product weight). */
export function lineWeight(data: Record<string, unknown>, variationId?: string): number {
  const variations = (Array.isArray(data.variations) ? data.variations : []) as {
    id?: string;
    weight?: number;
  }[];
  const v = variationId ? variations.find((x) => x.id === variationId) : undefined;
  if (typeof v?.weight === 'number') return v.weight;
  return typeof data.weight === 'number' ? data.weight : 0;
}

export interface QuoteLine {
  slug: string;
  variationId?: string;
  quantity: number;
  locale: string;
}

/** Storefront shipping estimate for a cart + destination country (or pickup). */
export async function quoteShipping(
  lines: QuoteLine[],
  country: string,
  delivery: DeliveryMethod = 'ship',
): Promise<{ shipping: number; surcharge: number; currency: string }> {
  const [config, currency, provider] = await Promise.all([
    getShippingConfig(),
    getSiteCurrency(),
    getConfiguredPaymentProvider(),
  ]);
  let subtotalCents = 0;
  let totalWeight = 0;
  for (const line of lines) {
    const qty = Math.max(1, Math.floor(line.quantity));
    const doc = await getProduct(line.slug, line.locale);
    if (!doc) continue;
    const data = doc.data as Record<string, unknown>;
    subtotalCents += Math.round(resolvePrice(data, line.variationId) * 100) * qty;
    totalWeight += lineWeight(data, line.variationId) * qty;
  }
  const { shipping, surcharge } = computeShipping(config, {
    subtotalCents,
    totalWeight,
    country,
    providerKey: provider.key,
    delivery,
  });
  return { shipping, surcharge, currency };
}

const quoteBody = z.object({
  country: z.string().trim().max(64).optional(),
  /** Used by the method list's free-shipping thresholds. */
  subtotalCents: z.coerce.number().int().min(0).optional(),
  delivery: z.enum(['ship', 'pickup']).optional(),
  locale: z.string().trim().max(8),
  items: z
    .array(
      z.object({
        slug: z.string().trim().max(191),
        variationId: z.string().trim().max(64).optional(),
        quantity: z.coerce.number().int().positive().max(999),
      }),
    )
    .max(100),
});

/** Public POST — live shipping estimate for the checkout. Module-gated by the binder. */
export function createShippingQuoteRoute() {
  return createRoute({
    rateLimit: { scope: 'commerce-shipping-quote', max: 60, windowMs: 60_000 },
    input: quoteBody,
    handler: async ({ input }) => {
      const quote = await quoteShipping(
        input.items.map((it) => ({ ...it, locale: input.locale })),
        input.country ?? '',
        input.delivery ?? 'ship',
      );
      /*
       * The single estimate AND the list of methods, in one response. A shop
       * with no methods defined gets an empty list and the checkout shows no
       * chooser — which is exactly how it behaved before methods existed.
       */
      const { resolveShippingChoices } = await import('./shipping-service');
      const { getConfiguredPaymentProvider, isOnlineProvider } = await import('./payments');
      const provider = await getConfiguredPaymentProvider();
      const methods = await resolveShippingChoices({
        country: input.country ?? '',
        subtotalCents: input.subtotalCents ?? 0,
        totalWeight: 0,
        paymentProvider: provider.key,
        // Same rule as checkout: an offline provider pays on delivery, so a
        // method that does not allow cash on delivery is not offered.
        codSelected: !isOnlineProvider(provider),
      });
      return ok({ ...quote, methods });
    },
  });
}
