/**
 * The generic content store — the heart of the CMS.
 *
 * Every piece of content (page, post, answer, product, topic, author, …) is a
 * row in `documents`, regardless of its config-defined type. Columns that the
 * core filters or sorts on are real, indexed columns; all type-specific fields
 * live in the `data` JSON, validated at write time by a zod schema generated
 * from the collection's field set (see `src/cms/config/zod.ts`).
 *
 * This is what lets sites declare new content types in `cms.config.ts` with no
 * database migration.
 */
import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';

import { adminUsers } from './auth';

export const documentStatusValues = ['draft', 'published', 'scheduled', 'archived'] as const;
export type DocumentStatus = (typeof documentStatusValues)[number];

export const documents = mysqlTable(
  'documents',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Collection key from the site config (e.g. `post`, `page`, `product`). */
    type: varchar('type', { length: 64 }).notNull(),
    slug: varchar('slug', { length: 191 }).notNull(),
    locale: varchar('locale', { length: 8 }).notNull(),
    status: mysqlEnum('status', documentStatusValues).notNull().default('draft'),

    publishedAt: timestamp('published_at'),
    scheduledFor: timestamp('scheduled_for'),
    /**
     * Hand-authored content revision date — the editorial "last meaningful
     * change", distinct from the technical `updated_at` (which changes on every
     * save). Drives JSON-LD `dateModified`, OG `modified_time`, and sitemap
     * lastmod. Nullable; falls back to `published_at` when unset.
     */
    modifiedAt: timestamp('modified_at'),

    /** Links the locale variants of one logical document (uuid, shared). */
    translationGroupId: varchar('translation_group_id', { length: 36 }),

    // ── SEO block (emitted for collections with `seo: true`) ──
    metaTitle: varchar('meta_title', { length: 255 }),
    metaDescription: varchar('meta_description', { length: 320 }),
    /** Resolved public path; unique so path→document lookups are O(1). */
    canonicalPath: varchar('canonical_path', { length: 512 }),
    noindex: boolean('noindex').notNull().default(false),
    nofollow: boolean('nofollow').notNull().default(false),
    includeInSitemap: boolean('include_in_sitemap').notNull().default(true),
    /** media_files uuid (no FK — media may be a disabled module on some sites). */
    ogImageUuid: varchar('og_image_uuid', { length: 36 }),

    /** All config-defined fields for this collection. */
    data: json('data').$type<Record<string, unknown>>().notNull(),

    createdBy: int('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    updatedBy: int('updated_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    typeSlugLocale: unique('uniq_documents_type_slug_locale').on(t.type, t.slug, t.locale),
    canonicalUniq: unique('uniq_documents_canonical_path').on(t.canonicalPath),
    typeStatusLocaleIdx: index('idx_documents_type_status_locale').on(t.type, t.status, t.locale),
    statusPublishedIdx: index('idx_documents_status_published').on(t.status, t.publishedAt),
    translationGroupIdx: index('idx_documents_translation_group').on(t.translationGroupId),
    // The PM bridge's `?modified_after=` filter and its default catalogue order
    // are both on `updated_at`; without this every incremental sync is a table
    // scan plus a filesort.
    updatedAtIdx: index('idx_documents_updated_at').on(t.updatedAt),
  }),
);

/**
 * Immutable version snapshots. Every save writes one row, powering
 * draft-of-published editing, preview, and rollback. The snapshot is the full
 * editable payload (status, slug, locale, SEO block, data) as JSON so a
 * rollback needs no schema knowledge.
 */
export const documentVersions = mysqlTable(
  'document_versions',
  {
    id: int('id').autoincrement().primaryKey(),
    documentId: int('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** Monotonic per-document version number. */
    version: int('version').notNull(),
    snapshot: json('snapshot').$type<Record<string, unknown>>().notNull(),
    /** Optional human label (e.g. "before headline rewrite"). */
    label: varchar('label', { length: 191 }),
    createdBy: int('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    docVersionUniq: unique('uniq_document_versions_doc_version').on(t.documentId, t.version),
    docIdx: index('idx_document_versions_doc').on(t.documentId),
  }),
);

/**
 * Typed document→document links, materialised from `relation` fields. Replaces
 * every per-pair join table (page_topics, page_entities, …) with one generic
 * table; `fieldKey` records which relation field the link belongs to and
 * `position` preserves ordering for `many` relations.
 */
export const documentRelations = mysqlTable(
  'document_relations',
  {
    id: int('id').autoincrement().primaryKey(),
    fromId: int('from_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    toId: int('to_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** The relation field's dotted key path within the source collection. */
    fieldKey: varchar('field_key', { length: 128 }).notNull(),
    position: int('position').notNull().default(0),
  },
  (t) => ({
    fromFieldIdx: index('idx_document_relations_from_field').on(t.fromId, t.fieldKey),
    toIdx: index('idx_document_relations_to').on(t.toId),
    linkUniq: unique('uniq_document_relations_link').on(t.fromId, t.toId, t.fieldKey),
  }),
);

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
export type DocumentVersionRow = typeof documentVersions.$inferSelect;
export type NewDocumentVersionRow = typeof documentVersions.$inferInsert;
export type DocumentRelationRow = typeof documentRelations.$inferSelect;
export type NewDocumentRelationRow = typeof documentRelations.$inferInsert;
