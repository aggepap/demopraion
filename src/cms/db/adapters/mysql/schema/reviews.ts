/**
 * Product reviews — guest-submitted, admin-moderated ratings.
 *
 * A review is keyed by the product's `translationGroupId` (`product_group_id`),
 * NOT a single document id: products are per-locale document rows that share a
 * slug + translation group, so keying by the group makes a review visible on
 * every language of the same product and lets it survive a single locale row
 * being deleted. `product_id` is kept as a best-effort reference (nulled if that
 * row is removed) for admin display + the verified-purchase check.
 *
 * Reviews land as `pending` and only surface on the storefront once approved —
 * the same moderation posture the form-submission + order flows use.
 */
import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core';

import { documents } from './documents';

export const reviewStatusValues = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof reviewStatusValues)[number];

export const productReviews = mysqlTable(
  'product_reviews',
  {
    id: int('id').autoincrement().primaryKey(),
    /** The product's translation-group id — stable across locales. */
    productGroupId: varchar('product_group_id', { length: 36 }).notNull(),
    /** The product document row at submission (any locale); null once deleted. */
    productId: int('product_id').references(() => documents.id, { onDelete: 'set null' }),
    /** Snapshot of the product slug for admin display (survives locale changes). */
    productSlug: varchar('product_slug', { length: 191 }),
    /** 1–5 stars. */
    rating: int('rating').notNull(),
    authorName: varchar('author_name', { length: 191 }).notNull(),
    /** Never shown publicly — moderation contact + verified-purchase match. */
    email: varchar('email', { length: 255 }).notNull(),
    title: varchar('title', { length: 191 }),
    body: text('body').notNull(),
    status: mysqlEnum('status', reviewStatusValues).notNull().default('pending'),
    /** The email matched a non-cancelled order for this product at submission. */
    verified: boolean('verified').notNull().default(false),
    /** Storefront locale the review was written on. */
    locale: varchar('locale', { length: 8 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    // The storefront read: approved reviews for a product, newest first.
    groupStatusIdx: index('idx_reviews_group_status').on(t.productGroupId, t.status, t.createdAt),
    // The admin moderation queue: by status, newest first.
    statusIdx: index('idx_reviews_status_created').on(t.status, t.createdAt),
    emailIdx: index('idx_reviews_email').on(t.email),
  }),
);

export type ProductReview = typeof productReviews.$inferSelect;
export type NewProductReview = typeof productReviews.$inferInsert;
