/**
 * Abandoned carts (addendum §9) — a shopper who reached checkout and entered an
 * email but didn't complete the order. Captured best-effort from the checkout
 * form; a reminder email with a tokenised recovery link is sent later (by a
 * cron- or admin-triggered job), and the record flips to `converted` if an
 * order with the same email lands first.
 *
 * `items` snapshots the client cart lines (major-unit prices, for display + the
 * recovery link that repopulates localStorage). `subtotal` is minor units.
 */
import { index, int, json, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const abandonedStatusValues = ['pending', 'reminded', 'converted'] as const;
export type AbandonedStatus = (typeof abandonedStatusValues)[number];

export const abandonedCarts = mysqlTable(
  'abandoned_carts',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Opaque recovery token (in the reminder link). */
    token: varchar('token', { length: 36 }).notNull().unique(),
    email: varchar('email', { length: 255 }).notNull(),
    /** Snapshot of the cart lines (client shape). */
    items: json('items').$type<unknown[]>().notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    locale: varchar('locale', { length: 8 }),
    /** Minor units. */
    subtotal: int('subtotal').notNull().default(0),
    status: mysqlEnum('status', abandonedStatusValues).notNull().default('pending'),
    reminderSentAt: timestamp('reminder_sent_at'),
    recoveredAt: timestamp('recovered_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    // The reminder job: pending carts by age.
    statusCreatedIdx: index('idx_abandoned_status_created').on(t.status, t.createdAt),
    emailIdx: index('idx_abandoned_email').on(t.email),
  }),
);

export type AbandonedCart = typeof abandonedCarts.$inferSelect;
export type NewAbandonedCart = typeof abandonedCarts.$inferInsert;
