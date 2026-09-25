/**
 * Script snippets — JavaScript an administrator saves once and places anywhere
 * with `[script name="<slug>"]`. Validated by `core/scripts/schema.ts`; managed
 * only with the `cms.scripts.manage` permission.
 */
import { boolean, int, mediumtext, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const scriptSnippets = mysqlTable('script_snippets', {
  id: int('id').autoincrement().primaryKey(),
  /** The shortcode key. Unique: two snippets cannot answer to one name. */
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  /** `inline` (code) | `external` (src). */
  kind: varchar('kind', { length: 16 }).notNull(),
  code: mediumtext('code'),
  src: varchar('src', { length: 2048 }),
  /** Run once the page is idle (`next/script` `lazyOnload`). */
  lazy: boolean('lazy').notNull().default(false),
  /** A cookie category key, or null for a snippet that runs without consent. */
  consentCategory: varchar('consent_category', { length: 64 }),
  enabled: boolean('enabled').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});
