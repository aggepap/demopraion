import 'server-only';

import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { createRoute } from '../../core/api/handler';
import { idParam } from '../../core/api/params';
import { ok } from '../../core/api/respond';
import { logAudit } from '../../core/audit';
import { badRequest, notFound } from '../../core/errors';
import { getDb, schema } from '../../db';
import { PERMISSIONS, requireApiPerm } from '../auth';
import { secretsRoutes } from '../../core/secrets/service';
import { courierFor, type VoucherResult } from './couriers';
import { getShippingConfig } from './shipping';
import {
  COURIER_SECRET_DEFS,
  checkShippingMethod,
  normalizeCountry,
  quoteMethods,
  trackingUrlFor,
  type QuoteContext,
  type ShippingMethodRow,
  type ShippingZoneRow,
} from './shipping-methods';

/**
 * Shipping methods against the database, plus the parcels that come out of them.
 *
 * `resolveShippingChoices` is the seam checkout uses: a shop with no methods
 * defined gets an empty list and the old flat/weight/zone calculation keeps
 * running exactly as before.
 */

export async function listShippingZones(): Promise<ShippingZoneRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.shippingZones)
    .orderBy(asc(schema.shippingZones.sort));
  return rows.map((row) => ({ ...row, countries: row.countries ?? [] }));
}

export async function listShippingMethods(): Promise<ShippingMethodRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.shippingMethods)
    .orderBy(asc(schema.shippingMethods.sort));
  return rows.map((row) => ({
    ...row,
    weightTiers: row.weightTiers ?? [],
  })) as ShippingMethodRow[];
}

/** What this basket may be shipped by. Empty = the site has not defined any. */
export async function resolveShippingChoices(ctx: Omit<QuoteContext, 'surcharges'>) {
  const [zones, methods, config] = await Promise.all([
    listShippingZones(),
    listShippingMethods(),
    getShippingConfig(),
  ]);
  if (methods.length === 0) return [];

  // The surcharges stay where they already are — one place for "cash on
  // delivery costs extra", whichever shipping engine is in use.
  const surcharges: Record<string, number> = {};
  for (const entry of config.paymentSurcharges ?? []) {
    surcharges[entry.provider] = Math.round((entry.charge ?? 0) * 100);
  }

  const country = normalizeCountry(ctx.country) ?? ctx.country;
  return quoteMethods(methods, zones, { ...ctx, country, surcharges });
}

/** One method by id, for checkout to validate the customer's choice against. */
export async function getShippingMethod(id: number): Promise<ShippingMethodRow | null> {
  const [row] = await getDb()
    .select()
    .from(schema.shippingMethods)
    .where(eq(schema.shippingMethods.id, id))
    .limit(1);
  return row ? ({ ...row, weightTiers: row.weightTiers ?? [] } as ShippingMethodRow) : null;
}

// ── Shipments ───────────────────────────────────────────────────────────────

export async function listShipments(orderId: number) {
  return getDb().select().from(schema.shipments).where(eq(schema.shipments.orderId, orderId));
}

/**
 * Record a parcel: either one the courier's API just created, or one an admin
 * booked in the courier's own portal and typed the number of.
 */
export async function createShipment(input: {
  orderId: number;
  courier: string;
  voucher?: string;
  userId: number | null;
}) {
  const adapter = courierFor(input.courier);
  if (!adapter) throw badRequest('Unknown courier.');

  const db = getDb();
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, input.orderId))
    .limit(1);
  if (!order) throw notFound();

  let voucher = input.voucher?.trim() ?? '';
  let trackingUrl = voucher ? adapter.trackingUrl(voucher) : null;
  let externalId: string | null = null;

  if (!voucher) {
    if (!adapter.createVoucher) {
      throw badRequest(
        `${adapter.label} vouchers are created in their own system — paste the number here.`
      );
    }
    const metadata = (order.metadata ?? {}) as Record<string, unknown>;
    const shipping = (metadata.shipping ?? {}) as Record<string, unknown>;
    const locker = (shipping.locker ?? {}) as Record<string, unknown>;
    const request = {
      orderId: order.id,
      reference: order.reference,
      // Cash on delivery only: a prepaid parcel must not ask for money again.
      codAmount: order.status === 'paid' ? undefined : Number(metadata.codAmount) || undefined,
      recipient: {
        name: order.customerName ?? '',
        phone: String(shipping.phone ?? ''),
        email: order.email,
        address1: String(shipping.address1 ?? ''),
        city: String(shipping.city ?? ''),
        postal: String(shipping.postal ?? ''),
        country: String(shipping.country ?? ''),
      },
      lockerId: typeof locker.id === 'string' ? locker.id : undefined,
    };
    let result: VoucherResult;
    try {
      result = await adapter.createVoucher(request);
    } catch (err) {
      /*
       * The courier's own words, to an admin: "not connected", "needs a chosen
       * locker" or the courier API's refusal are all things they can act on,
       * where the route's generic "Internal error." was not.
       */
      console.error('[commerce/shipments] voucher request failed', err);
      throw badRequest(err instanceof Error ? err.message : `${adapter.label} refused the request.`);
    }
    voucher = result.voucher;
    trackingUrl = result.trackingUrl;
    externalId = result.externalId;
  }

  await db.insert(schema.shipments).values({
    orderId: order.id,
    courier: adapter.key,
    voucher,
    trackingUrl: trackingUrl ?? trackingUrlFor(adapter.key, voucher),
    externalId,
    createdBy: input.userId,
  });

  await logAudit({
    userId: input.userId,
    action: 'order.shipment',
    subjectType: 'order',
    subjectId: order.id,
    after: { courier: adapter.key, voucher },
  });

  return listShipments(order.id);
}

// ── Routes ──────────────────────────────────────────────────────────────────

const zoneBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    countries: z.array(z.string().trim().length(2)).min(1).max(100),
    sort: z.coerce.number().int().min(0).max(999).default(0),
  })
  .strict();

const methodBody = z
  .object({
    zoneId: z.coerce.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    courier: z.enum(['acs', 'speedex', 'elta', 'boxnow', 'pickup', 'custom']),
    kind: z.enum(['address', 'locker', 'pickup']),
    cost: z.coerce.number().int().min(0),
    freeThreshold: z.coerce.number().int().min(0).nullable().default(null),
    etaMinDays: z.coerce.number().int().min(0).max(90).nullable().default(null),
    etaMaxDays: z.coerce.number().int().min(0).max(90).nullable().default(null),
    codAllowed: z.boolean().default(true),
    pickupLocationId: z.string().trim().max(64).nullable().default(null),
    active: z.boolean().default(true),
    sort: z.coerce.number().int().min(0).max(999).default(0),
  })
  .strict();

export function shippingZonesRoute() {
  return {
    GET: createRoute({
      guard: () => requireApiPerm(PERMISSIONS.settingsRead),
      handler: async () =>
        ok({ zones: await listShippingZones(), methods: await listShippingMethods() }),
    }),
    POST: createRoute({
      guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
      input: zoneBody,
      handler: async ({ input, auth }) => {
        await getDb()
          .insert(schema.shippingZones)
          .values({ ...input, countries: input.countries.map((c) => c.toUpperCase()) })
          .onDuplicateKeyUpdate({
            set: { countries: input.countries.map((c) => c.toUpperCase()), sort: input.sort },
          });
        await logAudit({
          userId: auth.userId,
          action: 'shipping.zone.save',
          subjectType: 'shipping_zone',
          subjectId: input.name,
        });
        return ok({ zones: await listShippingZones(), methods: await listShippingMethods() });
      },
    }),
  };
}

/** Refuse a method checkout could never honour (see `checkShippingMethod`). */
async function assertMethodUsable(input: z.infer<typeof methodBody>): Promise<void> {
  const config = await getShippingConfig();
  const problem = checkShippingMethod(
    input,
    config.pickup.locations.map((location) => location.id)
  );
  if (problem) throw badRequest(problem);
  const [zone] = await getDb()
    .select({ id: schema.shippingZones.id })
    .from(schema.shippingZones)
    .where(eq(schema.shippingZones.id, input.zoneId))
    .limit(1);
  if (!zone) throw badRequest('That shipping zone no longer exists.');
}

export function shippingMethodsRoute() {
  return {
    POST: createRoute({
      guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
      input: methodBody,
      handler: async ({ input, auth }) => {
        await assertMethodUsable(input);
        await getDb().insert(schema.shippingMethods).values(input);
        await logAudit({
          userId: auth.userId,
          action: 'shipping.method.create',
          subjectType: 'shipping_method',
          subjectId: input.name,
        });
        return ok({ methods: await listShippingMethods() });
      },
    }),
    /** Edit a method — also how it is switched on or off, and re-ordered. */
    PATCH: createRoute({
      guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
      input: methodBody,
      handler: async ({ input, params, auth }) => {
        const id = idParam(params.id);
        await assertMethodUsable(input);
        const result = await getDb()
          .update(schema.shippingMethods)
          .set(input)
          .where(eq(schema.shippingMethods.id, id));
        const { adapter } = await import('../../db');
        if (adapter.affectedRows(result) === 0 && !(await getShippingMethod(id))) throw notFound();
        await logAudit({
          userId: auth.userId,
          action: 'shipping.method.update',
          subjectType: 'shipping_method',
          subjectId: id,
        });
        return ok({ methods: await listShippingMethods() });
      },
    }),
    DELETE: createRoute({
      guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
      handler: async ({ params, auth }) => {
        const id = idParam(params.id);
        await getDb().delete(schema.shippingMethods).where(eq(schema.shippingMethods.id, id));
        await logAudit({
          userId: auth.userId,
          action: 'shipping.method.delete',
          subjectType: 'shipping_method',
          subjectId: id,
        });
        return ok({ methods: await listShippingMethods() });
      },
    }),
  };
}

/** Edit or remove one zone. Removing a zone removes its methods (FK cascade). */
export function shippingZoneRoute() {
  return {
    PATCH: createRoute({
      guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
      input: zoneBody,
      handler: async ({ input, params, auth }) => {
        const id = idParam(params.id);
        await getDb()
          .update(schema.shippingZones)
          .set({ ...input, countries: input.countries.map((c) => c.toUpperCase()) })
          .where(eq(schema.shippingZones.id, id));
        await logAudit({
          userId: auth.userId,
          action: 'shipping.zone.update',
          subjectType: 'shipping_zone',
          subjectId: id,
        });
        return ok({ zones: await listShippingZones(), methods: await listShippingMethods() });
      },
    }),
    DELETE: createRoute({
      guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
      handler: async ({ params, auth }) => {
        const id = idParam(params.id);
        await getDb().delete(schema.shippingZones).where(eq(schema.shippingZones.id, id));
        await logAudit({
          userId: auth.userId,
          action: 'shipping.zone.delete',
          subjectType: 'shipping_zone',
          subjectId: id,
        });
        return ok({ zones: await listShippingZones(), methods: await listShippingMethods() });
      },
    }),
  };
}

/**
 * Courier credentials (BoxNow's client id and secret). Write-only: the list
 * says whether each is set and shows at most its last four characters.
 */
export function courierCredentialsRoute() {
  return secretsRoutes({ defs: () => COURIER_SECRET_DEFS });
}

/** An order's parcels, for the admin order panel. */
export function orderShipmentsListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersRead),
    handler: async ({ params }) => ok({ shipments: await listShipments(idParam(params.id)) }),
  });
}

export function orderShipmentsRoute() {
  return createRoute({
    rateLimit: { scope: 'order-shipments', max: 30, windowMs: 60_000 },
    guard: () => requireApiPerm(PERMISSIONS.ordersWrite),
    input: z
      .object({
        courier: z.enum(['acs', 'speedex', 'elta', 'boxnow', 'pickup', 'custom']),
        /** Absent asks the courier's API to create one, where that is possible. */
        voucher: z.string().trim().max(64).optional(),
      })
      .strict(),
    handler: async ({ input, params, auth }) =>
      ok({
        shipments: await createShipment({
          orderId: idParam(params.id),
          courier: input.courier,
          voucher: input.voucher,
          userId: auth.userId,
        }),
      }),
  });
}

/** Public: the lockers near a postcode, for the checkout picker. */
export function boxNowLockersRoute() {
  return createRoute({
    rateLimit: { scope: 'boxnow-lockers', max: 60, windowMs: 60_000 },
    query: z.object({ postal: z.string().trim().max(10).default('') }),
    handler: async ({ query }) => {
      const adapter = courierFor('boxnow');
      if (!adapter?.listLockers) throw notFound();
      return ok({ lockers: await adapter.listLockers(query.postal) });
    },
  });
}
