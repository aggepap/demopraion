/**
 * Addresses that must not receive marketing mail.
 *
 * ## Why this exists
 *
 * The abandoned-cart reminder is the site's only unsolicited email, and it went
 * to any address a shopper typed into checkout — with no unsubscribe link and no
 * way to record a request to stop. That is a consent problem on its own, and it
 * is also a deliverability problem: the reminder shares a Microsoft Graph tenant
 * with every *transactional* message the site sends (order confirmations, booking
 * payment links, status updates). Spam complaints and spam-trap hits earned by
 * marketing mail are paid for by the transactional mail.
 *
 * Deliberately keyed on the address rather than on a cart: a suppression outlives
 * the cart it came from, and someone who asked to stop should stay stopped even
 * if they later reach checkout again.
 *
 * `reason` records how the address got here — `unsubscribe` for a person who
 * asked, leaving room for `bounce` or `complaint` if bounce handling is ever
 * wired up (Graph reports those out of band, so nothing writes them today).
 */
import { index, int, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const suppressionReasonValues = ['unsubscribe', 'bounce', 'complaint', 'manual'] as const;
export type SuppressionReason = (typeof suppressionReasonValues)[number];

export const emailSuppressions = mysqlTable(
  'email_suppressions',
  {
    id: int('id').autoincrement().primaryKey(),
    /**
     * Stored lowercase. The check is an equality match on a normalised value
     * rather than a case-insensitive collation comparison, so that the guarantee
     * does not depend on the column's collation surviving a migration.
     */
    email: varchar('email', { length: 255 }).notNull().unique(),
    reason: mysqlEnum('reason', suppressionReasonValues).notNull().default('unsubscribe'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    reasonIdx: index('idx_email_suppressions_reason').on(t.reason),
  }),
);

export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type NewEmailSuppression = typeof emailSuppressions.$inferInsert;
