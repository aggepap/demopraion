/**
 * Booking tables — reservations, their priced lines, payments, and the slot
 * ledger that makes double-booking impossible.
 *
 * Bookable items and resources are `documents` (types `booking` / `resource`),
 * so a reservation references them by document id AND by translation group id:
 * the document id is per-locale and can vanish, the group id is stable and is
 * what capacity is counted against. Money is minor units (cents) as int.
 *
 * The capacity design in one line: `booking_slots` is a mutex row per (slot,
 * date) that allocation locks with `SELECT … FOR UPDATE`, and the seats taken
 * are DERIVED by aggregating `reservation_holds` under that lock — never kept
 * as a counter column, because a counter and its rows are two representations
 * of one fact and they drift.
 */
import {
  boolean,
  date,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';

import { documents } from './documents';

/**
 * `pending` is an ENQUIRY and holds nothing — in request mode several people may
 * ask about the same date, and blocking the second would lose business over a
 * date the operator has not committed. The date is consumed at `awaiting_payment`
 * or `confirmed`.
 */
export const reservationStatusValues = [
  'pending',
  'awaiting_payment',
  'confirmed',
  'paid',
  'cancelled',
  'expired',
] as const;
export type ReservationStatus = (typeof reservationStatusValues)[number];

/** Resolved at submit and frozen: changing the site default later must not
 *  reinterpret reservations already taken under the old rules. */
export const bookingModeValues = ['request', 'instant'] as const;
export type BookingModeValue = (typeof bookingModeValues)[number];

export const allocationModeValues = ['shared', 'exclusive', 'resource'] as const;
export type AllocationModeValue = (typeof allocationModeValues)[number];

export const holdStateValues = ['held', 'confirmed', 'released'] as const;
export type HoldState = (typeof holdStateValues)[number];

export const reservationItemKindValues = [
  'base',
  'person',
  'resource',
  'extra',
  'surcharge',
  'discount',
] as const;
export type ReservationItemKind = (typeof reservationItemKindValues)[number];

export const reservationPaymentStatusValues = [
  'pending',
  'authorized',
  'captured',
  'failed',
  'refunded',
] as const;
export type ReservationPaymentStatus = (typeof reservationPaymentStatusValues)[number];

export const reservationEmailStatusValues = ['pending', 'sent', 'failed', 'skipped'] as const;
export type ReservationEmailStatus = (typeof reservationEmailStatusValues)[number];

export const reservations = mysqlTable(
  'reservations',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Human-facing and unguessable, e.g. `BKG-2026-7F3K9QMXVR`. */
    reference: varchar('reference', { length: 32 }).notNull().unique(),
    status: mysqlEnum('status', reservationStatusValues).notNull().default('pending'),
    /** Frozen at submit — see `bookingModeValues`. */
    mode: mysqlEnum('mode', bookingModeValues).notNull().default('request'),
    allocationMode: mysqlEnum('allocation_mode', allocationModeValues).notNull().default('shared'),

    /** The bookable item at request time; null once that row is deleted. */
    bookingId: int('booking_id').references(() => documents.id, { onDelete: 'set null' }),
    /** Stable across locales and deletions — the capacity + reporting key. */
    bookingGroupId: varchar('booking_group_id', { length: 64 }).notNull(),
    bookingSlug: varchar('booking_slug', { length: 191 }),
    bookingTitle: varchar('booking_title', { length: 255 }).notNull(),

    resourceId: int('resource_id').references(() => documents.id, { onDelete: 'set null' }),
    /**
     * `''` when no resource, never NULL: this participates in slot keys, and
     * MySQL unique indexes do not collide on NULL, so a nullable discriminator
     * would let two "no resource" rows exist for one date and the lock would
     * protect nothing.
     */
    resourceGroupId: varchar('resource_group_id', { length: 64 }).notNull().default(''),
    resourceLabel: varchar('resource_label', { length: 191 }),

    /**
     * A calendar date, not a timestamp. A booking must not shift a day because
     * the server runs in UTC and the operator is in Athens.
     *
     * For a stay this is the CHECK-IN date, which is what keeps
     * `idx_reservations_status_date` and `idx_reservations_booking_date`
     * meaningful for both kinds without a second set of indexes.
     */
    slotDate: date('slot_date', { mode: 'string' }).notNull(),
    /**
     * Check-out, for a stay; null for transport.
     *
     * The nights actually occupied are `slot_date` … `end_date` minus one, and
     * each is its own `reservation_holds` row — the ledger needed no change to
     * support ranges, because it was already keyed per (slot, date).
     */
    endDate: date('end_date', { mode: 'string' }),
    /** Nights occupied. 0 for transport, so "is this a stay" is one comparison. */
    nights: int('nights').notNull().default(0),
    /** The first form answer (usually a time), denormalised for the admin list. */
    slotLabel: varchar('slot_label', { length: 64 }),

    /** Total guests. For a stay this is `adults + children`, kept denormalised
     *  so every existing query that reports on party size still works. */
    persons: int('persons').notNull().default(1),
    adults: int('adults').notNull().default(1),
    children: int('children').notNull().default(0),

    email: varchar('email', { length: 255 }).notNull(),
    customerName: varchar('customer_name', { length: 191 }),
    phone: varchar('phone', { length: 64 }),
    locale: varchar('locale', { length: 8 }),
    notes: text('notes'),
    adminNotes: text('admin_notes'),

    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    /** Minor units. `total` is the sum of `reservation_items.amount`. */
    subtotal: int('subtotal').notNull().default(0),
    total: int('total').notNull().default(0),
    depositAmount: int('deposit_amount').notNull().default(0),
    amountPaid: int('amount_paid').notNull().default(0),

    /**
     * The INPUTS the price was computed from — the resolved pricing config and
     * the customer's selection. NOT the computed lines: those are
     * `reservation_items`, and they are the only copy. Snapshot = inputs, items
     * = outputs, never both. The legacy system kept two parallel representations
     * of one cart and they drifted.
     */
    pricingSnapshot: json('pricing_snapshot').$type<Record<string, unknown>>(),
    /** Answers to the item's `choices` dropdowns: `{ [choiceId]: value }`. */
    selections: json('selections').$type<Record<string, string>>(),
    metadata: json('metadata').$type<Record<string, unknown>>(),

    /**
     * SHA-256 of the payment-link token. The plaintext exists only in the email:
     * a bearer credential that authorises a payment must not be readable from a
     * database dump or a log line. Nulled on payment, and rotated on reissue,
     * which kills the previous link.
     */
    paymentTokenHash: varchar('payment_token_hash', { length: 64 }),
    paymentTokenExpiresAt: timestamp('payment_token_expires_at'),
    paymentLinkSentAt: timestamp('payment_link_sent_at'),

    /**
     * When a payment attempt was last STARTED through this link — the claim that
     * makes starting one exclusive.
     *
     * `redeemPaymentToken` is an unlocked read, and the token stays live until a
     * payment is actually credited (it has to: the provider's return URL carries
     * it back). So two requests presenting the same live token both passed every
     * check and both reached `provider.start()`, opening two charge sessions on
     * one booking — a double-clicked Pay button, or a customer with the link open
     * in two tabs. If both were then completed the reservation was overpaid and
     * somebody had to refund it.
     *
     * A timestamp rather than a boolean because the claim must expire: a start
     * that fails, or a customer who abandons the provider's page, must not lock
     * the booking out of ever being paid. `PAYMENT_START_CLAIM_MS` is the window,
     * and the claim is taken with one conditional UPDATE whose matched-row count
     * decides the winner — no lock is held across the provider's network call.
     */
    paymentStartedAt: timestamp('payment_started_at'),

    /** When a `pending` enquiry lapses, or an instant payment hold expires. */
    expiresAt: timestamp('expires_at'),

    /** Latest customer email outcome, mirrored from `reservation_events` so the
     *  admin list can show "nobody was told" without a join. */
    emailStatus: mysqlEnum('email_status', reservationEmailStatusValues).notNull().default('pending'),
    emailError: text('email_error'),

    /** Optimistic lock: an admin save replaces the row and its items outright. */
    version: int('version').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    statusDateIdx: index('idx_reservations_status_date').on(t.status, t.slotDate),
    bookingDateIdx: index('idx_reservations_booking_date').on(t.bookingGroupId, t.slotDate),
    resourceDateIdx: index('idx_reservations_resource_date').on(t.resourceGroupId, t.slotDate),
    emailIdx: index('idx_reservations_email').on(t.email),
    expiresIdx: index('idx_reservations_status_expires').on(t.status, t.expiresAt),
    createdIdx: index('idx_reservations_created').on(t.createdAt),
  }),
);

/** The priced breakdown, and the only copy of it. */
export const reservationItems = mysqlTable(
  'reservation_items',
  {
    id: int('id').autoincrement().primaryKey(),
    reservationId: int('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    kind: mysqlEnum('kind', reservationItemKindValues).notNull(),
    /** Stable machine key so a receipt can be re-labelled in any language. */
    code: varchar('code', { length: 64 }).notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    refId: varchar('ref_id', { length: 64 }),
    quantity: int('quantity').notNull().default(1),
    /** Minor units. */
    unitAmount: int('unit_amount').notNull().default(0),
    amount: int('amount').notNull().default(0),
    position: int('position').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    reservationIdx: index('idx_reservation_items_reservation').on(t.reservationId, t.position),
  }),
);

/**
 * One row per (slot, calendar date). Three jobs in one table:
 *   1. the per-date capacity override (null = inherit the document's default),
 *   2. the blackout flag,
 *   3. the row allocation locks to serialise itself.
 *
 * `slot_key` is `exp:<groupId>` or `res:<groupId>`. Resource capacity is tracked
 * on its OWN slot, because a yacht booked from one cruise is unavailable to
 * every other cruise that offers it.
 */
export const bookingSlots = mysqlTable(
  'booking_slots',
  {
    id: int('id').autoincrement().primaryKey(),
    slotKey: varchar('slot_key', { length: 80 }).notNull(),
    slotDate: date('slot_date', { mode: 'string' }).notNull(),
    /** Null = inherit from the item/resource document. */
    capacity: int('capacity'),
    closed: boolean('closed').notNull().default(false),
    /** Minor units; overrides the computed unit price for this date. */
    priceOverride: int('price_override'),
    note: varchar('note', { length: 191 }),
    version: int('version').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    slotUniq: unique('uniq_booking_slots_key_date').on(t.slotKey, t.slotDate),
    dateIdx: index('idx_booking_slots_date').on(t.slotDate),
  }),
);

/**
 * The seat ledger. Seats are aggregated from these rows under the slot lock,
 * never cached in a counter column.
 *
 * One row per (slot, DATE), which is what lets a stay span a range with no
 * schema change at all: a three-night booking simply writes three rows, and the
 * check-out date is not among them.
 */
export const reservationHolds = mysqlTable(
  'reservation_holds',
  {
    id: int('id').autoincrement().primaryKey(),
    reservationId: int('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    slotKey: varchar('slot_key', { length: 80 }).notNull(),
    slotDate: date('slot_date', { mode: 'string' }).notNull(),
    /** Persons for a shared slot; 1 for an exclusive one. */
    seats: int('seats').notNull().default(1),
    state: mysqlEnum('state', holdStateValues).notNull().default('held'),
    /** Only meaningful while `held`. A lapsed hold stops counting immediately,
     *  before the cron gets round to expiring its reservation. */
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    slotIdx: index('idx_reservation_holds_slot').on(t.slotKey, t.slotDate, t.state),
    reservationIdx: index('idx_reservation_holds_reservation').on(t.reservationId),
    /** A double-submit becomes a duplicate-key 409, not a double hold. */
    holdUniq: unique('uniq_reservation_holds_res_slot').on(t.reservationId, t.slotKey, t.slotDate),
  }),
);

export const reservationPayments = mysqlTable(
  'reservation_payments',
  {
    id: int('id').autoincrement().primaryKey(),
    reservationId: int('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    /** Provider slug, e.g. `manual`, `stripe`, `viva`. */
    provider: varchar('provider', { length: 32 }).notNull(),
    providerRef: varchar('provider_ref', { length: 191 }),
    status: mysqlEnum('status', reservationPaymentStatusValues).notNull().default('pending'),
    /** Minor units. A deposit and its balance are two rows. */
    amount: int('amount').notNull().default(0),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    method: varchar('method', { length: 32 }),
    isDeposit: boolean('is_deposit').notNull().default(false),
    error: text('error'),
    metadata: json('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    reservationIdx: index('idx_reservation_payments_reservation').on(t.reservationId),
    /**
     * UNIQUE, not merely indexed: this is what makes a replayed webhook a
     * duplicate-key error rather than a second credit against the balance.
     * Both gateways retry by design, so without it a retry silently doubles
     * `amount_paid`. MySQL does not collide on NULL, so the `manual` rows —
     * which carry no provider ref — are unaffected and can still be many.
     */
    providerIdx: unique('uniq_reservation_payments_provider_ref').on(t.provider, t.providerRef),
  }),
);

/**
 * The reservation's timeline: every status change and every email, with the
 * delivery outcome recorded rather than swallowed. "Somebody booked and nobody
 * was told" has to be visible on the screen.
 */
export const reservationEvents = mysqlTable(
  'reservation_events',
  {
    id: int('id').autoincrement().primaryKey(),
    reservationId: int('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    /** `status.confirmed`, `email.payment_link`, `payment.captured`, … */
    kind: varchar('kind', { length: 48 }).notNull(),
    fromStatus: mysqlEnum('from_status', reservationStatusValues),
    toStatus: mysqlEnum('to_status', reservationStatusValues),
    /** Null for a system or cron action. */
    actorUserId: int('actor_user_id'),
    recipient: varchar('recipient', { length: 255 }),
    emailStatus: mysqlEnum('email_status', reservationEmailStatusValues),
    emailError: text('email_error'),
    detail: json('detail').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    reservationIdx: index('idx_reservation_events_reservation').on(t.reservationId, t.createdAt),
  }),
);

export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;
export type ReservationItem = typeof reservationItems.$inferSelect;
export type NewReservationItem = typeof reservationItems.$inferInsert;
export type BookingSlot = typeof bookingSlots.$inferSelect;
export type NewBookingSlot = typeof bookingSlots.$inferInsert;
export type ReservationHold = typeof reservationHolds.$inferSelect;
export type NewReservationHold = typeof reservationHolds.$inferInsert;
export type ReservationPayment = typeof reservationPayments.$inferSelect;
export type NewReservationPayment = typeof reservationPayments.$inferInsert;
export type ReservationEvent = typeof reservationEvents.$inferSelect;
export type NewReservationEvent = typeof reservationEvents.$inferInsert;
