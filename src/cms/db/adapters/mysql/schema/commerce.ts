/**
 * Commerce tables — orders, line items, payments.
 *
 * Written by the shop's checkout (`modules/commerce/orders.ts`), the payment
 * webhooks and the admin order screens. The payment rows are provider-agnostic:
 * `provider` + `provider_ref` identify the gateway's record, whatever it is.
 *
 * Products themselves are `documents` (type = 'product'), so they reuse the
 * whole content stack (admin CRUD, versioning, publishing, read layer). An
 * order line references a product by its document id AND snapshots the
 * purchased data, so an order stays immutable even if the product is edited
 * or unpublished afterwards. Money is stored in minor units (e.g. cents) as
 * integers to avoid floating-point drift.
 */
import { index, int, json, mysqlEnum, mysqlTable, text, timestamp, unique, varchar } from 'drizzle-orm/mysql-core';

import { customers } from './customers';
import { documents } from './documents';

export const orderStatusValues = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'] as const;
export type OrderStatus = (typeof orderStatusValues)[number];

export const paymentStatusValues = [
  'pending',
  'authorized',
  'captured',
  'failed',
  'refunded',
] as const;
export type PaymentStatus = (typeof paymentStatusValues)[number];

export const orders = mysqlTable(
  'orders',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Human-facing order number (e.g. `ORD-2026-000123`). */
    reference: varchar('reference', { length: 32 }).notNull().unique(),
    status: mysqlEnum('status', orderStatusValues).notNull().default('pending'),
    email: varchar('email', { length: 255 }).notNull(),
    /*
     * The account this order belongs to, when there is one. Nullable and
     * `set null` on delete because guest checkout stays, and because deleting
     * an account must not delete its orders — they are business records with
     * their own retention period (see `schema/customers.ts`).
     */
    customerId: int('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    /** The chosen shipping method, when the shop offers a choice. The name and
     *  cost are also snapshotted into `metadata.shipping` — a method that is
     *  renamed later must not rewrite what an old order says it paid for. */
    shippingMethodId: int('shipping_method_id'),
    customerName: varchar('customer_name', { length: 191 }),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    /** Minor units (cents). */
    subtotal: int('subtotal').notNull().default(0),
    total: int('total').notNull().default(0),
    locale: varchar('locale', { length: 8 }),
    notes: text('notes'),
    metadata: json('metadata').$type<Record<string, unknown>>(),
    /**
     * Incremented on every admin save, and sent back by the editor to prove which copy
     * it edited.
     *
     * A save replaces the order outright — every line item deleted and the caller's
     * list reinserted — so without this the second of two admins on one order silently
     * undid the first (F-068). `updated_at` was tried as the token first and is not
     * good enough: it is a TIMESTAMP with second resolution, so two saves inside the
     * same second are indistinguishable, and that is exactly when a collision happens.
     * A counter has no such blind spot.
     */
    version: int('version').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    statusCreatedIdx: index('idx_orders_status_created').on(t.status, t.createdAt),
    customerIdx: index('idx_orders_customer').on(t.customerId),
    emailIdx: index('idx_orders_email').on(t.email),
  }),
);

export const orderItems = mysqlTable(
  'order_items',
  {
    id: int('id').autoincrement().primaryKey(),
    orderId: int('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** The product document, or null if it was later deleted. */
    productId: int('product_id').references(() => documents.id, { onDelete: 'set null' }),
    sku: varchar('sku', { length: 64 }),
    name: varchar('name', { length: 255 }).notNull(),
    /**
     * The chosen variation's stable id.
     *
     * `variant_label` is for display and `snapshot` is the whole product, so
     * neither can say which variation to put back. Stock now moves after
     * payment rather than at checkout, which means restocking a refund has to
     * find the exact variation — hence this column.
     */
    variationId: varchar('variation_id', { length: 64 }),
    /** Selected variant label at purchase time, if any. */
    variantLabel: varchar('variant_label', { length: 191 }),
    /** Minor units. */
    unitPrice: int('unit_price').notNull().default(0),
    quantity: int('quantity').notNull().default(1),
    lineTotal: int('line_total').notNull().default(0),
    /** Snapshot of the product data at purchase time (immutability). */
    snapshot: json('snapshot').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index('idx_order_items_order').on(t.orderId),
    productIdx: index('idx_order_items_product').on(t.productId),
  }),
);

export const payments = mysqlTable(
  'payments',
  {
    id: int('id').autoincrement().primaryKey(),
    orderId: int('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** Provider slug, e.g. `stripe`, `viva`, `manual`. */
    provider: varchar('provider', { length: 32 }).notNull(),
    /** The provider's own reference (charge/intent id). */
    providerRef: varchar('provider_ref', { length: 191 }),
    status: mysqlEnum('status', paymentStatusValues).notNull().default('pending'),
    /** Minor units. */
    amount: int('amount').notNull().default(0),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    method: varchar('method', { length: 32 }),
    error: text('error'),
    metadata: json('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    orderIdx: index('idx_payments_order').on(t.orderId),
    /**
     * UNIQUE, not merely indexed — see the matching note on
     * `reservation_payments`. A replayed capture webhook must not be able to
     * write a second row for one payment.
     */
    providerIdx: unique('uniq_payments_provider_ref').on(t.provider, t.providerRef),
  }),
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
