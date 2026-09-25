/**
 * Site settings KV store. Ported unchanged from v1 `schema/settings.ts`.
 */
import { int, json, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

import { adminUsers } from './auth';

export const siteSettings = mysqlTable('site_settings', {
  key: varchar('key', { length: 128 }).primaryKey(),
  value: json('value').$type<unknown>(),
  updatedBy: int('updated_by').references(() => adminUsers.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});

export type SiteSetting = typeof siteSettings.$inferSelect;
export type NewSiteSetting = typeof siteSettings.$inferInsert;
