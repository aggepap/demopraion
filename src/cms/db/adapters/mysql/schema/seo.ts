/**
 * SEO overrides, redirects, and the 404 log. Ported unchanged from v1
 * `schema/seo.ts`. Consumed by the seo module and the site proxy hook.
 */
import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';

import { adminUsers } from './auth';
import { documents } from './documents';

export const seoMeta = mysqlTable(
  'seo_meta',
  {
    id: int('id').autoincrement().primaryKey(),
    path: varchar('path', { length: 255 }).notNull(),
    locale: varchar('locale', { length: 8 }).notNull().default('el'),
    title: varchar('title', { length: 255 }),
    description: varchar('description', { length: 320 }),
    robots: varchar('robots', { length: 64 }),
    canonical: varchar('canonical', { length: 512 }),
    ogTitle: varchar('og_title', { length: 255 }),
    ogDescription: varchar('og_description', { length: 320 }),
    ogImage: varchar('og_image', { length: 512 }),
    updatedBy: int('updated_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    pathLocale: unique('uniq_seo_meta_path_locale').on(t.path, t.locale),
    pathIdx: index('idx_seo_meta_path').on(t.path),
  }),
);

export const seoRedirects = mysqlTable(
  'seo_redirects',
  {
    id: int('id').autoincrement().primaryKey(),
    source: varchar('source', { length: 512 }).notNull(),
    target: varchar('target', { length: 512 }).notNull(),
    statusCode: int('status_code').notNull().default(301),
    kind: mysqlEnum('kind', ['literal', 'wildcard', 'regex']).notNull().default('literal'),
    active: boolean('active').notNull().default(true),
    hits: int('hits').notNull().default(0),
    lastHitAt: timestamp('last_hit_at'),
    notes: varchar('notes', { length: 512 }),
    /**
     * Set on a rule the CMS wrote itself when this document was unpublished
     * (`core/seo/unpublish-redirect.ts`), which also removes it when the document
     * goes live again. Null on every rule an admin wrote. Deleted with the
     * document: left behind, the rule would look like an admin's and silently
     * shadow a new post published later at the same URL.
     */
    documentId: int('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    /**
     * Why the CMS wrote the rule, when it did: `unpublish` (the document was taken
     * down — `core/seo/unpublish-redirect.ts`) or `slug_change` (its address
     * changed — `core/seo/slug-change-redirect.ts`). Each reconciler touches only
     * its own rows. Null on every rule an admin wrote.
     */
    reason: varchar('reason', { length: 32 }),
    createdBy: int('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    sourceKind: unique('uniq_seo_redirects_source_kind').on(t.source, t.kind),
    activeIdx: index('idx_seo_redirects_active').on(t.active),
    sourceIdx: index('idx_seo_redirects_source').on(t.source),
    documentIdx: index('idx_seo_redirects_document').on(t.documentId),
  }),
);

export const seo404Log = mysqlTable(
  'seo_404_log',
  {
    id: int('id').autoincrement().primaryKey(),
    path: varchar('path', { length: 512 }).notNull(),
    locale: varchar('locale', { length: 8 }),
    hits: int('hits').notNull().default(1),
    firstSeen: timestamp('first_seen').notNull().defaultNow(),
    lastSeen: timestamp('last_seen').notNull().defaultNow(),
    userAgentSample: varchar('user_agent_sample', { length: 255 }),
    referrerSample: varchar('referrer_sample', { length: 512 }),
    ignored: boolean('ignored').notNull().default(false),
  },
  (t) => ({
    pathLocale: unique('uniq_seo_404_log_path_locale').on(t.path, t.locale),
    lastSeenIdx: index('idx_seo_404_log_last_seen').on(t.lastSeen),
  }),
);

export type SeoMeta = typeof seoMeta.$inferSelect;
export type NewSeoMeta = typeof seoMeta.$inferInsert;
export type SeoRedirect = typeof seoRedirects.$inferSelect;
export type NewSeoRedirect = typeof seoRedirects.$inferInsert;
export type Seo404LogEntry = typeof seo404Log.$inferSelect;
