/**
 * Media library. Ported from v1 `schema/media.ts` with one fix: `media_folders.parent_id`
 * now carries a real self-referential FK (v1 tech-debt item BACKEND.md §13.4 —
 * it was a bare int, risking orphaned folders).
 */
import {
  type AnyMySqlColumn,
  bigint,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';

import { adminUsers } from './auth';

export const mediaFolders = mysqlTable('media_folders', {
  id: int('id').autoincrement().primaryKey(),
  // Self-referential FK — deleting a parent nulls its children's parent_id
  // rather than leaving dangling references.
  parentId: int('parent_id').references((): AnyMySqlColumn => mediaFolders.id, {
    onDelete: 'set null',
  }),
  name: varchar('name', { length: 191 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const mediaFiles = mysqlTable(
  'media_files',
  {
    uuid: varchar('uuid', { length: 36 }).primaryKey(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mime: varchar('mime', { length: 128 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    width: int('width'),
    height: int('height'),
    hash: varchar('hash', { length: 64 }).notNull(),
    altText: varchar('alt_text', { length: 512 }),
    folderId: int('folder_id').references(() => mediaFolders.id, { onDelete: 'set null' }),
    uploadedBy: int('uploaded_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    hashIdx: index('idx_media_files_hash').on(t.hash),
  }),
);

export const mediaVariantKeyValues = ['original', 'thumb', 'medium', 'large', 'og'] as const;
export type MediaVariantKey = (typeof mediaVariantKeyValues)[number];

export const mediaVariantFormatValues = ['jpg', 'webp', 'png', 'avif', 'svg'] as const;
export type MediaVariantFormat = (typeof mediaVariantFormatValues)[number];

export const mediaVariants = mysqlTable(
  'media_variants',
  {
    id: int('id').autoincrement().primaryKey(),
    mediaUuid: varchar('media_uuid', { length: 36 })
      .notNull()
      .references(() => mediaFiles.uuid, { onDelete: 'cascade' }),
    variantKey: mysqlEnum('variant_key', mediaVariantKeyValues).notNull(),
    format: mysqlEnum('format', mediaVariantFormatValues).notNull(),
    path: varchar('path', { length: 512 }).notNull(),
    width: int('width').notNull(),
    height: int('height').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
  },
  (t) => ({
    variantUniq: unique('uniq_media_variant').on(t.mediaUuid, t.variantKey, t.format),
  }),
);

export const mediaUsages = mysqlTable(
  'media_usages',
  {
    id: int('id').autoincrement().primaryKey(),
    mediaUuid: varchar('media_uuid', { length: 36 })
      .notNull()
      .references(() => mediaFiles.uuid, { onDelete: 'cascade' }),
    subjectType: varchar('subject_type', { length: 64 }).notNull(),
    subjectId: varchar('subject_id', { length: 64 }).notNull(),
    context: varchar('context', { length: 64 }),
  },
  (t) => ({
    mediaIdx: index('idx_media_usages_media').on(t.mediaUuid),
    subjectIdx: index('idx_media_usages_subject').on(t.subjectType, t.subjectId),
  }),
);

export type MediaFile = typeof mediaFiles.$inferSelect;
export type NewMediaFile = typeof mediaFiles.$inferInsert;
export type MediaVariant = typeof mediaVariants.$inferSelect;
export type NewMediaVariant = typeof mediaVariants.$inferInsert;
export type MediaFolder = typeof mediaFolders.$inferSelect;
