import { and, desc, eq, inArray, lte, or, type SQL } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';

import { getDb, schema } from '../../db';
import type { DocumentRelationRow, DocumentRow } from '../../db/adapters/mysql/schema/documents';
import { docTag, pathTag, typeTag } from './tags';
import { isDocumentVisible } from './visibility';
import { CMS_CACHE_REVALIDATE } from '../cache';

/**
 * Public read layer — the site's frontend reads published content through
 * these. Cached with `unstable_cache` + tags, invalidated by the write path.
 * There is NO time-based fallback: `CMS_CACHE_REVALIDATE` is `false` (see
 * `../cache.ts` for why), so a cached entry changes only when a tag is purged.
 * A scheduled document whose time arrives is picked up when the scheduler
 * promotes it to `published` (the `content-publish-scheduled` cron job, or the
 * admin list/edit screens — see `documents/publish-scheduled.ts`), which
 * revalidates its tags; until then a cached list keeps its earlier answer.
 *
 * Visibility: `published`, or `scheduled` whose `scheduledFor` has passed.
 */

const isVisible = isDocumentVisible;

/**
 * `isDocumentVisible` as a WHERE clause, so a list can filter BEFORE its limit.
 *
 * `listPublishedDocuments` used to take the newest N rows of every status and
 * drop the drafts afterwards, so a block asking for three testimonials got one
 * when the two newest rows were drafts. Keep this in step with
 * `isDocumentVisible` — the JS check still runs on the rows as a backstop.
 */
export function visibleWhere(now: Date): SQL {
  return or(
    eq(schema.documents.status, 'published'),
    and(eq(schema.documents.status, 'scheduled'), lte(schema.documents.scheduledFor, now)),
  ) as SQL;
}

/** Largest page `listPublishedDocuments` returns in one call. */
export const PUBLISHED_PAGE_MAX = 1000;

/**
 * Every item behind a paged fetch: ask for `pageSize` at increasing offsets
 * until a short page says there is no more.
 */
export async function pageThrough<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  pageSize: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}

/** One published document by (type, slug, locale), or null.
 *  Best-effort: a DB failure (e.g. build with no DB) resolves to null — not
 *  cached — so callers can fall back to static content. */
export async function getPublishedDocument(
  type: string,
  slug: string,
  locale: string,
): Promise<DocumentRow | null> {
  try {
    return await unstable_cache(
      async () => {
        const db = getDb();
        const [row] = await db
          .select()
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.type, type),
              eq(schema.documents.slug, slug),
              eq(schema.documents.locale, locale),
            ),
          )
          .limit(1);
        return row && isVisible(row, new Date()) ? row : null;
      },
      ['cms-doc', type, slug, locale],
      { tags: [typeTag(type), docTag(type, locale, slug)], revalidate: CMS_CACHE_REVALIDATE },
    )();
  } catch (err) {
    console.error('[cms/read] getPublishedDocument failed', { type, slug, locale }, err);
    return null;
  }
}

/**
 * One document by (type, slug, locale) **regardless of status** — for draft
 * preview only. Uncached (previews must always reflect the latest edit) and
 * best-effort. Callers must gate this behind an authenticated draft-mode check.
 */
export async function getDocumentPreview(
  type: string,
  slug: string,
  locale: string,
): Promise<DocumentRow | null> {
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.type, type),
          eq(schema.documents.slug, slug),
          eq(schema.documents.locale, locale),
        ),
      )
      .limit(1);
    return row ?? null;
  } catch (err) {
    console.error('[cms/read] getDocumentPreview failed', { type, slug, locale }, err);
    return null;
  }
}

/** One published document by resolved canonical path, or null. Best-effort. */
export async function getPublishedByPath(canonicalPath: string): Promise<DocumentRow | null> {
  try {
    return await unstable_cache(
      async () => {
        const db = getDb();
        const [row] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.canonicalPath, canonicalPath))
          .limit(1);
        return row && isVisible(row, new Date()) ? row : null;
      },
      ['cms-path', canonicalPath],
      { tags: [pathTag(canonicalPath)], revalidate: CMS_CACHE_REVALIDATE },
    )();
  } catch (err) {
    console.error('[cms/read] getPublishedByPath failed', { canonicalPath }, err);
    return null;
  }
}

/**
 * Published documents of a type for a locale, newest first — at most `limit`
 * (default 200, capped at `PUBLISHED_PAGE_MAX`), starting at `offset`. For
 * every one of them (the sitemap), use `listAllPublishedDocuments`.
 */
export function listPublishedDocuments(
  type: string,
  locale: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<DocumentRow[]> {
  const limit = Math.min(PUBLISHED_PAGE_MAX, Math.max(1, opts.limit ?? 200));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  return unstable_cache(
    async () => {
      try {
        const db = getDb();
        const now = new Date();
        const rows = await db
          .select()
          .from(schema.documents)
          .where(
            and(eq(schema.documents.type, type), eq(schema.documents.locale, locale), visibleWhere(now)),
          )
          // `id` breaks ties so pages never overlap or skip a row.
          .orderBy(desc(schema.documents.publishedAt), desc(schema.documents.id))
          .limit(limit)
          .offset(offset);
        return rows.filter((r) => isVisible(r, now));
      } catch (err) {
        console.error('[cms/read] listPublishedDocuments failed', { type, locale }, err);
        return [];
      }
    },
    ['cms-list', type, locale, String(limit), String(offset)],
    { tags: [typeTag(type)], revalidate: CMS_CACHE_REVALIDATE },
  )();
}

/** Every published document of a type for a locale, paged through in full. */
export function listAllPublishedDocuments(type: string, locale: string): Promise<DocumentRow[]> {
  return pageThrough(
    (offset, limit) => listPublishedDocuments(type, locale, { limit, offset }),
    PUBLISHED_PAGE_MAX,
  );
}

/**
 * Published documents of `type` in `locale` that link to `targetId` through the
 * relation field `fieldKey` — the posts in one category. Newest first.
 *
 * Joins `document_relations` and filters status in SQL, so the limit counts
 * only live rows. A scheduled document whose time has come is kept by the same
 * visibility rule.
 */
export function listPublishedByRelation(
  type: string,
  fieldKey: string,
  targetId: number,
  locale: string,
  opts: { limit?: number } = {},
): Promise<DocumentRow[]> {
  const limit = Math.min(1000, Math.max(1, opts.limit ?? 200));
  return unstable_cache(
    async () => {
      try {
        const rows = await getDb()
          .select({ doc: schema.documents })
          .from(schema.documents)
          .innerJoin(schema.documentRelations, eq(schema.documentRelations.fromId, schema.documents.id))
          .where(
            and(
              eq(schema.documentRelations.toId, targetId),
              eq(schema.documentRelations.fieldKey, fieldKey),
              eq(schema.documents.type, type),
              eq(schema.documents.locale, locale),
              inArray(schema.documents.status, ['published', 'scheduled']),
            ),
          )
          .orderBy(desc(schema.documents.publishedAt))
          .limit(limit);
        const now = new Date();
        return rows.map((r) => r.doc).filter((r) => isVisible(r, now));
      } catch (err) {
        console.error('[cms/read] listPublishedByRelation failed', { type, fieldKey, targetId, locale }, err);
        return [];
      }
    },
    ['cms-list-by-relation', type, fieldKey, String(targetId), locale, String(limit)],
    { tags: [typeTag(type)], revalidate: CMS_CACHE_REVALIDATE },
  )();
}

/**
 * Load the documents linked from `fromId` via relation field `fieldKey`,
 * ordered by the stored position. Used to hydrate relation fields (author,
 * topics, …) for the public page. Not cached individually — call from within a
 * cached parent read.
 */
export async function loadRelatedDocuments(fromId: number, fieldKey: string): Promise<DocumentRow[]> {
  const db = getDb();
  const links: DocumentRelationRow[] = await db
    .select()
    .from(schema.documentRelations)
    .where(
      and(
        eq(schema.documentRelations.fromId, fromId),
        eq(schema.documentRelations.fieldKey, fieldKey),
      ),
    )
    .orderBy(schema.documentRelations.position);
  if (links.length === 0) return [];

  const byId = new Map<number, DocumentRow>();
  for (const link of links) {
    if (byId.has(link.toId)) continue;
    const [row] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, link.toId))
      .limit(1);
    if (row) byId.set(link.toId, row);
  }
  // Preserve link order.
  return links.map((l) => byId.get(l.toId)).filter((r): r is DocumentRow => Boolean(r));
}
