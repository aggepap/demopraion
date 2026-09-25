/**
 * Compiled `<head>` payloads pushed by Product Manager.
 *
 * ## Why this is not columns on `seo_meta`
 *
 * `seo_meta` is the *human* override layer: it is hand-edited on `/admin/seo`,
 * and `upsertMeta` rewrites every column on save. A machine-compiled blob living
 * there would be wiped by the next admin edit, and would have to be either
 * rendered or deliberately hidden by a screen that has no concept of it.
 *
 * A separate table means a separate lifecycle, a one-statement revocation
 * (`DELETE FROM pm_head_payloads`), and `seo_meta` stays the thing a person owns.
 *
 * ## Why both `path` and `document_id`
 *
 * They answer different questions. The unique key is on `path` because that is
 * how the render side looks a payload up — including for archives, which have no
 * document at all. `document_id` rides alongside so the FK cascade cleans the row
 * up when a document is deleted, which a path-keyed table could never do.
 */
import {
  boolean,
  index,
  int,
  json,
  mysqlTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';

import { documents } from './documents';

export const pmHeadPayloads = mysqlTable(
  'pm_head_payloads',
  {
    id: int('id').autoincrement().primaryKey(),
    path: varchar('path', { length: 255 }).notNull(),
    locale: varchar('locale', { length: 8 }).notNull(),
    /** The PM page type this was compiled for; advisory, kept for debugging. */
    remoteType: varchar('remote_type', { length: 32 }),
    /** Null for virtual archives — they are Next routes with no document. */
    documentId: int('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    /** `{title, description, robots, canonical, og_*, twitter_*}` */
    headMeta: json('head_meta').$type<Record<string, string | null>>(),
    /** An array of JSON-LD nodes, or one `@graph` object. */
    jsonld: json('jsonld').$type<unknown>(),
    /** `[{hreflang, href}]` — stored, deliberately not rendered in phase 1. */
    alternates: json('alternates').$type<{ hreflang: string; href: string }[]>(),
    /**
     * True → this payload REPLACES the page's generated graph and its head meta
     * outranks the document columns. False → it fills only what is empty, and its
     * JSON-LD is emitted alongside the generated graph rather than instead of it.
     */
    seoOverride: boolean('seo_override').notNull().default(false),
    source: varchar('source', { length: 32 }).notNull().default('pm'),
    /** sha256 of the canonical JSON; an identical hash is a no-op, not a write. */
    payloadHash: varchar('payload_hash', { length: 64 }),
    compiledAt: timestamp('compiled_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    pathLocale: unique('uniq_pm_head_payloads_path_locale').on(t.path, t.locale),
    documentIdx: index('idx_pm_head_payloads_document').on(t.documentId),
  }),
);

export type PmHeadPayload = typeof pmHeadPayloads.$inferSelect;
export type NewPmHeadPayload = typeof pmHeadPayloads.$inferInsert;
