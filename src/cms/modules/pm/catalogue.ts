import 'server-only';

import { and, count, desc, eq, gt, inArray } from 'drizzle-orm';

import type { CmsConfig, PmArchiveType, ResolvedCollection } from '../../config';
import { getMetaOverride } from '../../core/seo/resolve';
import { getDb, schema } from '../../db';
import type { DocumentRow } from '../../db/adapters/mysql/schema/documents';
import { buildItem, fieldFormats, pmFieldSupport, type PmItem } from './dto';
import { absoluteUrl, formatRobots } from './mapping';

/**
 * The page and product catalogues PM syncs from.
 *
 * ## Why archives come first
 *
 * They are a fixed, small set with no natural sort key, and documents are an
 * unbounded stream ordered by `updated_at`. Interleaving them would make offset
 * arithmetic depend on timestamps; putting the fixed set first makes it
 * deterministic:
 *
 *   offset <  archiveCount → take archives[offset…], then fill from documents at 0
 *   offset >= archiveCount → documents at (offset − archiveCount)
 */

/** Without a ceiling, one request can ask the site to build a hundred thousand rows. */
export const PER_PAGE_MAX = 100;
export const PER_PAGE_DEFAULT = 50;

export interface PmMeta {
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
}

export interface PmPage<T> {
  data: T[];
  meta: PmMeta;
}

export function clampPerPage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return PER_PAGE_DEFAULT;
  return Math.min(Math.floor(n), PER_PAGE_MAX);
}

export function clampPage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function pmMeta(page: number, perPage: number, total: number): PmMeta {
  return {
    current_page: page,
    per_page: perPage,
    total,
    last_page: Math.max(1, Math.ceil(total / Math.max(1, perPage))),
  };
}

/** Collections this site exposes, in config order. */
export function exposedCollections(config: CmsConfig): ResolvedCollection[] {
  return config.collections.filter((c) => Boolean(c.pmPageType));
}

/**
 * Parse `modified_after`.
 *
 * Accepts ISO-8601 and `Y-m-d H:i:s`, which is the shape the WooCommerce path
 * sends. Returns null for anything unparseable rather than throwing — a bad
 * cursor should degrade to a full sync, not a failed one.
 */
export function parseModifiedAfter(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const raw = value.trim();
  // `2026-08-01 10:00:00` is not valid ISO; make it so rather than guessing.
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const parsed = new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface ArchiveItem {
  id: number;
  remote_type: PmArchiveType;
  /**
   * The manifest key for this archive, which for an archive IS its type — it
   * has no collection behind it. Sent anyway so PM can group and filter every
   * item by one field instead of special-casing the four rows that have no
   * collection.
   */
  content_type: PmArchiveType;
  remote_id: PmArchiveType;
  name: string;
  slug: string;
  status: 'publish';
  permalink: string;
  locale: string;
  description: null;
  images: [];
  seo: {
    seo_title: string | null;
    meta_description: string | null;
    og_title: string | null;
    og_description: string | null;
    robots: string;
  };
  modified_at: string | null;
  editable: string[];
  /** Uniform with PmItem. Archives have no body, so never anything but {}. */
  formats: Record<string, string>;
}

/**
 * The declared archives, read from the per-path SEO override layer.
 *
 * Archives expose exactly the four keys PM's `editableFieldKeys()` default
 * branch expects — no body, no slug, and no social image — so PM's editor and
 * praion agree without either side special-casing.
 */
export async function listArchives(config: CmsConfig, locale: string): Promise<ArchiveItem[]> {
  const entries = Object.entries(config.pm.archives) as [PmArchiveType, { path: string; label?: string }][];

  return Promise.all(
    entries.map(async ([type, def], index) => {
      const override = await getMetaOverride(def.path, locale);
      return {
        // A stable synthetic id: PM wants a numeric `id` on every item, and
        // archives have no row. Negative so it can never collide with a
        // document id if anything downstream keys on the number alone.
        id: -(index + 1),
        remote_type: type,
        content_type: type,
        remote_id: type,
        name: def.label ?? def.path,
        slug: def.path,
        status: 'publish' as const,
        permalink: absoluteUrl(def.path),
        locale,
        description: null,
        images: [] as [],
        seo: {
          seo_title: override?.title ?? null,
          meta_description: override?.description ?? null,
          og_title: override?.ogTitle ?? null,
          og_description: override?.ogDescription ?? null,
          robots: override?.robots ?? formatRobots({ noindex: false, nofollow: false }),
        },
        modified_at: null,
        editable: ['seo_title', 'meta_description', 'og_title', 'og_description'],
        formats: {},
      };
    }),
  );
}

/**
 * One entry on Product Manager's Content types page.
 *
 * `page_types` says which of PM's type values this site can produce;
 * this says what those types actually *are* here. It exists because the mapping
 * is lossy in one direction: four praion collections present as `wp_post`, so
 * PM's Pages list would otherwise show an article, an answer, a case study and a
 * bookable experience as one undifferentiated pile of "Post" — with no hint that
 * an article's headline cannot be rewritten while a case study's can.
 */
export interface PmContentType {
  key: string;
  label: string;
  page_type: string;
  /**
   * Storage format per field for the fields that are not prose — the same map
   * every item carries, declared up front so PM can shape its editor for a
   * collection before it has imported anything from it.
   */
  formats?: Record<string, string>;
  group?: string;
  route?: string;
  description?: string;
  writable?: string[];
  refused?: Record<string, string>;
}

/** The label a collection shows under, without its per-locale map. */
function plainLabel(label: unknown, fallback: string): string {
  if (typeof label === 'string') return label;
  if (label && typeof label === 'object') {
    const first = Object.values(label as Record<string, unknown>).find((v) => typeof v === 'string');
    if (typeof first === 'string') return first;
  }
  return fallback;
}

/**
 * Build the manifest from the same config the read endpoints use.
 *
 * Never a hand-kept parallel list: a manifest that disagrees with what the
 * endpoints actually emit is worse than no manifest, because it tells a user
 * they can edit something the next push will refuse.
 *
 * Archives are included as entries of their own — they are content types as far
 * as PM is concerned, just ones with no body and no slug.
 */
export function contentTypeManifest(config: CmsConfig): PmContentType[] {
  const entries: PmContentType[] = [];

  for (const collection of exposedCollections(config)) {
    const support = pmFieldSupport(collection);
    const entry: PmContentType = {
      key: collection.key,
      label: plainLabel(collection.labelPlural ?? collection.label, collection.key),
      page_type: collection.pmPageType!,
      writable: support.writable,
    };
    const formats = fieldFormats(collection);
    if (Object.keys(formats).length > 0) entry.formats = formats;
    if (collection.pmGroup) entry.group = collection.pmGroup;
    if (collection.routing?.pathTemplate) entry.route = collection.routing.pathTemplate;
    if (collection.pmDescription) entry.description = collection.pmDescription;
    // Omitted rather than sent empty: an empty object reads as "we checked and
    // there are no restrictions", which is the same thing but noisier.
    if (Object.keys(support.refused).length > 0) entry.refused = support.refused;
    entries.push(entry);
  }

  for (const [type, def] of Object.entries(config.pm.archives) as [PmArchiveType, { path: string; label?: string }][]) {
    entries.push({
      key: type,
      label: def.label ?? def.path,
      page_type: type,
      group: 'Archives',
      route: def.path,
      writable: ['seo_title', 'meta_description', 'og_title', 'og_description'],
    });
  }

  return entries;
}

/** Load related document titles for a product's categories/tags. */
async function relatedTitles(ids: number[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({ data: schema.documents.data })
    .from(schema.documents)
    .where(inArray(schema.documents.id, ids));
  return rows
    .map((r) => {
      const data = (r.data ?? {}) as Record<string, unknown>;
      return typeof data.title === 'string' ? data.title : null;
    })
    .filter((t): t is string => t !== null);
}

async function relationIds(documentId: number, fieldKey: string): Promise<number[]> {
  const rows = await getDb()
    .select({ toId: schema.documentRelations.toId })
    .from(schema.documentRelations)
    .where(
      and(
        eq(schema.documentRelations.fromId, documentId),
        eq(schema.documentRelations.fieldKey, fieldKey),
      ),
    );
  return rows.map((r) => r.toId);
}

/** Turn a document row into a wire item, resolving product relations as needed. */
export async function itemFor(
  config: CmsConfig,
  collection: ResolvedCollection,
  row: DocumentRow,
): Promise<PmItem> {
  if (collection.pmPageType !== 'product') {
    return buildItem({ config, collection, row });
  }
  const [categoryIds, tagIds] = await Promise.all([
    relationIds(row.id, 'categories'),
    relationIds(row.id, 'tags'),
  ]);
  const [categories, tags] = await Promise.all([relatedTitles(categoryIds), relatedTitles(tagIds)]);
  return buildItem({ config, collection, row, categories, tags });
}

export interface DocumentQuery {
  types: string[];
  locale: string;
  modifiedAfter: Date | null;
  limit: number;
  offset: number;
}

function whereFor(q: DocumentQuery) {
  const clauses = [inArray(schema.documents.type, q.types), eq(schema.documents.locale, q.locale)];
  // Filter on `updated_at`, the technical stamp — that is what "what changed
  // since my last sync" means. `modified_at` is the editorial revision date and
  // an editor may set it to anything, including the past.
  if (q.modifiedAfter) clauses.push(gt(schema.documents.updatedAt, q.modifiedAfter));
  return and(...clauses);
}

export async function countDocuments(q: DocumentQuery): Promise<number> {
  if (q.types.length === 0) return 0;
  const [row] = await getDb().select({ n: count() }).from(schema.documents).where(whereFor(q));
  return Number(row?.n ?? 0);
}

export async function selectDocuments(q: DocumentQuery): Promise<DocumentRow[]> {
  if (q.types.length === 0 || q.limit <= 0) return [];
  return getDb()
    .select()
    .from(schema.documents)
    .where(whereFor(q))
    .orderBy(desc(schema.documents.updatedAt), desc(schema.documents.id))
    .limit(q.limit)
    .offset(Math.max(0, q.offset));
}
