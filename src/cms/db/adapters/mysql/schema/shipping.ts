/**
 * Shipping methods a customer chooses between, and the parcels that result.
 *
 * The older JSON `ecommerce.shipping` config is untouched and still works: a
 * shop that never opens this screen keeps exactly the shipping it has. Rows
 * here take over only once a shop defines them.
 *
 * `shipments` is a table rather than a field on the order because one order can
 * genuinely become two parcels, and because a voucher has its own history.
 */
import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';

import { adminUsers } from './auth';
import { orders } from './commerce';

export const courierValues = ['acs', 'speedex', 'elta', 'boxnow', 'pickup', 'custom'] as const;
export const methodKindValues = ['address', 'locker', 'pickup'] as const;

export const shippingZones = mysqlTable(
  'shipping_zones',
  {
    id: int('id').autoincrement().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    /** ISO-3166 alpha-2 codes. */
    countries: json('countries').$type<string[]>().notNull(),
    sort: int('sort').notNull().default(0),
  },
  (t) => ({ nameUniq: unique('uniq_shipping_zones_name').on(t.name) })
);

export const shippingMethods = mysqlTable(
  'shipping_methods',
  {
    id: int('id').autoincrement().primaryKey(),
    zoneId: int('zone_id')
      .notNull()
      .references(() => shippingZones.id, { onDelete: 'cascade' }),
    /** What the customer sees: "ACS — next day". */
    name: varchar('name', { length: 120 }).notNull(),
    courier: mysqlEnum('courier', courierValues).notNull().default('custom'),
    kind: mysqlEnum('kind', methodKindValues).notNull().default('address'),
    /** Minor units. */
    cost: int('cost').notNull().default(0),
    /** Free above this subtotal (minor units); null = never free. */
    freeThreshold: int('free_threshold'),
    weightTiers: json('weight_tiers').$type<{ minWeight: number; charge: number }[]>(),
    etaMinDays: int('eta_min_days'),
    etaMaxDays: int('eta_max_days'),
    /** Cash on delivery is not offered by every courier or every contract. */
    codAllowed: boolean('cod_allowed').notNull().default(true),
    /** For a pickup method: which store, matching the pickup config's id. */
    pickupLocationId: varchar('pickup_location_id', { length: 64 }),
    active: boolean('active').notNull().default(true),
    sort: int('sort').notNull().default(0),
  },
  (t) => ({ zoneIdx: index('idx_shipping_methods_zone').on(t.zoneId) })
);

export const shipments = mysqlTable(
  'shipments',
  {
    id: int('id').autoincrement().primaryKey(),
    orderId: int('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    courier: mysqlEnum('courier', courierValues).notNull(),
    /** The courier's own number, entered by hand or returned by their API. */
    voucher: varchar('voucher', { length: 64 }).notNull(),
    trackingUrl: varchar('tracking_url', { length: 500 }),
    /** The courier's id for the shipment, when their API gave us one. */
    externalId: varchar('external_id', { length: 191 }),
    status: varchar('status', { length: 40 }).notNull().default('created'),
    createdBy: int('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index('idx_shipments_order').on(t.orderId),
    // One row per voucher: a double-clicked "create voucher" must not book two.
    voucherUniq: unique('uniq_shipments_courier_voucher').on(t.courier, t.voucher),
  })
);

export type ShippingZoneRecord = typeof shippingZones.$inferSelect;
export type ShippingMethodRecord = typeof shippingMethods.$inferSelect;
export type ShipmentRecord = typeof shipments.$inferSelect;
