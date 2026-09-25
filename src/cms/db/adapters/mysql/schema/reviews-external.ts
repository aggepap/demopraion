/**
 * Reviews pulled from Google, and the places they belong to.
 *
 * Stored locally rather than fetched per page view for three reasons: Google's
 * quotas are small, a page must render when Google is slow, and the reviewer
 * photos are re-hosted so a visitor's browser never contacts Google before the
 * cookie banner has been answered.
 *
 * `hidden` is the admin's own flag. Nothing is ever edited — a synced review is
 * Google's text, and changing it would be misrepresenting a customer.
 */
import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  tinyint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';

export const reviewSourceValues = ['gbp', 'places'] as const;

export const reviewLocations = mysqlTable(
  'review_locations',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Addressed from a shortcode: `[google-reviews location="loutraki"]`. */
    slug: varchar('slug', { length: 64 }).notNull(),
    label: varchar('label', { length: 191 }).notNull(),
    source: mysqlEnum('source', reviewSourceValues).notNull().default('places'),
    /** Places API. */
    placeId: varchar('place_id', { length: 191 }),
    /** Business Profile API: `accounts/x/locations/y`. */
    resourceName: varchar('resource_name', { length: 191 }),
    enabled: boolean('enabled').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at'),
    /** The last failure, shown in the admin — a sync that silently stopped
     *  working looks exactly like a business with no new reviews. */
    lastError: varchar('last_error', { length: 500 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({ slugUniq: unique('uniq_review_locations_slug').on(t.slug) })
);

export const reviewsExternal = mysqlTable(
  'reviews_external',
  {
    id: int('id').autoincrement().primaryKey(),
    locationId: int('location_id')
      .notNull()
      .references(() => reviewLocations.id, { onDelete: 'cascade' }),
    source: mysqlEnum('source', reviewSourceValues).notNull(),
    /** Google's own id for the review; the sync key. */
    externalId: varchar('external_id', { length: 191 }).notNull(),
    authorName: varchar('author_name', { length: 191 }).notNull().default(''),
    /** The re-hosted WebP in our own media store, never Google's URL. */
    photoMediaId: varchar('photo_media_id', { length: 64 }),
    rating: tinyint('rating').notNull(),
    text: text('text'),
    publishedAt: timestamp('published_at').notNull(),
    ownerReply: text('owner_reply'),
    ownerReplyAt: timestamp('owner_reply_at'),
    hidden: boolean('hidden').notNull().default(false),
    syncedAt: timestamp('synced_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    // One row per review per location, so a re-sync updates rather than doubles.
    externalUniq: unique('uniq_reviews_external_location_external').on(t.locationId, t.externalId),
    publishedIdx: index('idx_reviews_external_published').on(t.publishedAt),
  })
);

export type ReviewLocationRow = typeof reviewLocations.$inferSelect;
export type ReviewExternalRow = typeof reviewsExternal.$inferSelect;
