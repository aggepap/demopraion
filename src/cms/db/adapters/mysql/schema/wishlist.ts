/**
 * A signed-in customer's wishlist.
 *
 * Guests keep theirs in the browser (see `wishlist-policy.ts`); this table is
 * what makes one follow a customer from their phone to their laptop. It holds
 * ids only — price and stock are read live, so a saved row can never show a
 * price the shop has stopped charging.
 *
 * `variation_id` is NOT NULL with an empty default on purpose: MySQL treats
 * NULLs as distinct in a unique key, so a nullable column would happily store
 * the same product twice.
 */
import { int, mysqlTable, timestamp, unique, varchar } from 'drizzle-orm/mysql-core';

import { customers } from './customers';
import { documents } from './documents';

export const wishlistItems = mysqlTable(
  'wishlist_items',
  {
    id: int('id').autoincrement().primaryKey(),
    customerId: int('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    /** The product document. Deleting the product removes the saved row. */
    productId: int('product_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    variationId: varchar('variation_id', { length: 64 }).notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    itemUniq: unique('uniq_wishlist_customer_item').on(t.customerId, t.productId, t.variationId),
  }),
);

export type WishlistItemRow = typeof wishlistItems.$inferSelect;
