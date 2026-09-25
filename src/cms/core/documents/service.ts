// NOT `server-only`: this module is reused by the tsx seed CLIs (Phase 3), and
// `server-only` can't resolve outside Next. The `mysql2` import (via getDb)
// already prevents any client-component bundle from including it.
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';

import { buildDataSchema, isReservedSlug, type CmsConfig, type ResolvedCollection } from '../../config';
import { adapter, getDb, schema } from '../../db';
import type { DocumentRow, DocumentStatus } from '../../db/adapters/mysql/schema/documents';
import { ApiError, invalidInput, isDuplicateKeyError, notFound } from '../errors';
import { assertMdxSafe } from '../fields/mdx-validate';
import { syncDocumentRelations } from './relations';
import { editableSnapshot } from './snapshot';
import { applySlugChangeRedirect } from '../seo/slug-change-redirect';
import { applyUnpublishRedirect } from '../seo/unpublish-redirect';
import { revalidateRedirects } from '../seo/resolve';
import { likeTerm } from '../db/like';

export interface DocumentWriteInput {
  slug: string;
  locale: string;
  status?: DocumentStatus;
  data: Record<string, unknown>;
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonicalPath?: string | null;
  noindex?: boolean;
  nofollow?: boolean;
  includeInSitemap?: boolean;
  ogImageUuid?: string | null;
  publishedAt?: Date | null;
  /** Hand-authored content revision date (editorial). Falls back to publishedAt. */
  modifiedAt?: Date | null;
  scheduledFor?: Date | null;
  translationGroupId?: string | null;
}

export type DocumentPatch = Partial<DocumentWriteInput> & {
  /**
   * The document version the editor had loaded. When supplied, a save is
   * refused if the stored document has moved on since — see `updateDocument`.
   * Optional so the seed CLIs and other single-writer callers are unaffected.
   */
  expectedVersion?: number;
};

export interface ListDocumentsOptions {
  status?: DocumentStatus;
  locale?: string;
  /** Substring match against slug + meta title. */
  search?: string;
  page?: number;
  pageSize?: number;
}

/** Light row shape for list screens — everything except the heavy `data` JSON
 *  (which holds the MDX body etc.). */
export interface DocumentSummary {
  id: number;
  type: string;
  slug: string;
  locale: string;
  status: DocumentStatus;
  publishedAt: Date | null;
  scheduledFor: Date | null;
  modifiedAt: Date | null;
  canonicalPath: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  /** Field values — included so admin pickers can show a real title and read
   *  relations (e.g. the category tree's `parent`) without a second fetch. */
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListDocumentsResult {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
}

/** One locale variant within a translation group (for list badges). */
export interface DocumentVariant {
  id: number;
  locale: string;
  status: DocumentStatus;
  updatedAt: Date;
}

/** One logical document (a translation group) for the grouped list screen. */
export interface DocumentGroupSummary {
  /** Representative row id (default-locale variant, else first) — the edit target. */
  id: number;
  /** `translation_group_id`, or `doc:<id>` for an unlinked singleton. */
  groupKey: string;
  translationGroupId: string | null;
  slug: string;
  /** Display title derived from the representative row's `data` (title/name/…),
   *  independent of the slug and the SEO meta title. Null when none is set. */
  title: string | null;
  metaTitle: string | null;
  updatedAt: Date;
  variants: DocumentVariant[];
}

/** Best-effort display title from a document's `data` JSON — the common
 *  title-ish keys, mirroring the relation picker's label logic. Handles both
 *  plain string values and localized `{ [locale]: string }` maps. */
/** Follow a dot path, returning whatever is there. */
function atPath(data: unknown, path: string): unknown {
  let node: unknown = data;
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/**
 * The words of a title, whether it is one string or a group of parts.
 *
 * A localized field is a map of locale → string; a group is a map of part → string. Both
 * are objects of strings, and both want the same treatment — take the strings in the
 * order they are declared. For a group that is `before + accent + after`, which is the
 * order a reader sees; for a localized field it is the first non-empty locale, which is
 * the best a list column showing one language can do.
 *
 * `order` is what makes "the order they are declared" true. Without it this read
 * `Object.values(value)` and trusted the stored key order — but a group lives in
 * the `data` JSON column, and MySQL normalises JSON object keys by length then
 * lexicographically. `{before:'The ', accent:'X', after:' report'}` returns as
 * `{after, accent, before}`, so every grouped headline in the list, the search
 * box and the editor heading rendered backwards ("report X The"). The bug was
 * invisible in memory and appeared only after a round trip, which is why the
 * unit tests passed while the screen was wrong.
 */
function titleFromValue(
  value: unknown,
  joinAll: boolean,
  order?: readonly string[],
): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  // Declared order first; then anything stored that the declaration does not
  // mention, so a part added or renamed since is shown rather than dropped.
  const keys = order
    ? [...order.filter((k) => k in record), ...Object.keys(record).filter((k) => !order.includes(k))]
    : Object.keys(record);
  const parts = keys
    .map((k) => record[k])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map((v) => v.trim());
  if (!parts.length) return null;
  return joinAll ? parts.join(' ').replace(/\s+/g, ' ').trim() : parts[0];
}

/**
 * The name a person would call this document by, or null when it has none yet.
 *
 * Exported because the list, the search box and the editor's own heading must
 * agree: a document renamed in the form has to be findable in the list under
 * the new name, and recognisable at the top of the screen it was renamed on.
 */
export function deriveDocumentTitle(
  data: unknown,
  titlePath?: string,
  /**
   * The declared part order for a grouped title — `groupPartOrder(collection.fields,
   * titlePath)`. Optional so the fallback guesses below still work without a
   * collection, but every caller that has one should pass it: a group read out of
   * the database has lost its declared order (see `titleFromValue`).
   */
  titleOrder?: readonly string[],
): string | null {
  if (!data || typeof data !== 'object') return null;
  if (titlePath) {
    // The collection said where its title is; no guessing needed.
    const declared = titleFromValue(atPath(data, titlePath), true, titleOrder);
    if (declared) return declared;
  }
  const d = data as Record<string, unknown>;
  for (const key of ['title', 'name', 'question', 'label']) {
    const v = d[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    // Localized field: pick the first non-empty locale value.
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const first = Object.values(v as Record<string, unknown>).find(
        (x) => typeof x === 'string' && x.trim(),
      );
      if (typeof first === 'string') return first.trim();
    }
  }
  return null;
}

export interface ListDocumentGroupsOptions extends ListDocumentsOptions {
  /** Which locale's row supplies the representative slug/title. */
  defaultLocale?: string;
  /** See `CollectionDefinition.titlePath` — where this collection keeps its title. */
  titlePath?: string;
  /**
   * Declared part order for a grouped title — `groupPartOrder(collection.fields,
   * titlePath)`. Without it a grouped headline is joined in the stored key order,
   * which MySQL has already re-sorted; see `titleFromValue`.
   */
  titleOrder?: readonly string[];
}

export interface ListDocumentGroupsResult {
  items: DocumentGroupSummary[];
  page: number;
  pageSize: number;
  total: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Options threaded through the write path.
 *
 * `collection` lets a caller substitute a collection whose fields were resolved
 * at runtime — in practice the config definition plus the admin-defined custom
 * fields (`core/fields/resolve.ts`). It's injected rather than read here
 * because this module is deliberately not `server-only` (the seed CLIs reuse
 * it), while the settings read that backs those definitions is. Callers that
 * omit it get the static config schema, which is what the seeds want.
 */
export interface DocumentWriteOptions {
  collection?: ResolvedCollection;
}

function resolveCollection(
  config: CmsConfig,
  type: string,
  opts: DocumentWriteOptions = {},
): ResolvedCollection {
  if (opts.collection?.key === type) return opts.collection;
  const collection = config.collectionByKey.get(type);
  if (!collection) throw notFound(`Unknown collection "${type}".`);
  return collection;
}

function assertLocale(config: CmsConfig, locale: string): void {
  if (!config.locales.includes(locale)) {
    throw new ApiError('invalid_input', `Locale "${locale}" is not configured.`);
  }
}

/** Statuses that put a document in front of the public. */
function goesLive(status: string | undefined): boolean {
  return status === 'published' || status === 'scheduled';
}

/**
 * Dotted path → the label the admin form shows for that field.
 *
 * Repeater rows carry an index in the issue path (`toc.0.label`) that the field
 * tree has no counterpart for, so the index is stripped when looking a path up.
 */
function fieldLabels(fields: readonly { key: string; label?: unknown; fields?: unknown }[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (list: readonly { key: string; label?: unknown; fields?: unknown }[], prefix: string): void => {
    for (const f of list) {
      const path = prefix ? `${prefix}.${f.key}` : f.key;
      if (typeof f.label === 'string') out.set(path, f.label);
      if (Array.isArray(f.fields)) walk(f.fields, path);
    }
  };
  walk(fields, '');
  return out;
}

/**
 * Turn zod's shape-level complaint into something an editor can act on.
 *
 * An absent required group surfaces as "Invalid input: expected object,
 * received undefined" — accurate, and useless to the person who just needs to
 * be told which box to fill in. Messages we author ourselves are passed through
 * untouched.
 */
function humanizeIssue(message: string, label: string): string {
  return /^Invalid input: expected \w+, received (undefined|null)$/.test(message)
    ? `${label} is required`
    : message;
}

function validateData(
  collection: ResolvedCollection,
  config: CmsConfig,
  data: Record<string, unknown>,
  opts: { enforceRequired?: boolean } = {},
): Record<string, unknown> {
  const parsed = buildDataSchema(collection.fields, config.locales, {
    enforceRequired: opts.enforceRequired,
    defaultLocale: config.defaultLocale,
  }).safeParse(data);
  if (!parsed.success) {
    // `flatten()` collapses everything under its TOP-LEVEL key, so both errors
    // of an incomplete `header` group arrive as `fieldErrors.header` and the
    // admin has no way to tell which sub-field each one belongs to — it showed
    // a bare "Validation failed." and the author had to guess. `pathErrors`
    // keeps the full path (`header.eyebrow`, `toc.0.label`) so the form can put
    // each message under the control it belongs to. `flatten()` is kept
    // alongside it: existing consumers still read `fieldErrors`.
    const labels = fieldLabels(collection.fields);
    const pathErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      (pathErrors[key] ??= []).push(humanizeIssue(issue.message, labels.get(key) ?? key));
    }
    throw invalidInput({ ...parsed.error.flatten(), pathErrors });
  }
  return parsed.data as Record<string, unknown>;
}

/** Fill `{slug}` (and any `{field}`) in a routing template. */
/**
 * The public path a document would live at.
 *
 * Exported because the PM bridge needs the same answer when it reports a
 * permalink and when it recomputes `canonical_path` after a slug push. Two
 * independent implementations of URL derivation is exactly how canonical paths
 * drift apart, and the symptom — pushes landing on the wrong path — is slow to
 * notice.
 */
export function resolvePath(collection: ResolvedCollection, slug: string, locale: string, defaultLocale: string): string | null {
  const template = collection.routing.pathTemplate;
  if (!template) return null;
  const path = template.replace('{slug}', slug);
  // Non-default locales are prefixed, mirroring the site's i18n routing.
  return locale === defaultLocale ? path : `/${locale}${path}`;
}

/**
 * The `canonical_path` a document should have after an update.
 *
 * `createDocument` derives it from the slug, but updates used to keep the old
 * value unless the patch carried one — and the admin form never sends one (it
 * is the routing index, not an editable field). So renaming a slug in the admin
 * left `canonical_path` pointing at the old address: path lookups, the preview
 * link and cache invalidation all went on using a URL the page no longer had.
 *
 * An explicit `canonicalPath` in the patch still wins (version restore and the
 * PM bridge send one). Otherwise a slug or locale change re-derives it with the
 * same `resolvePath` and the same `collection.seo` rule create uses; anything
 * else keeps what is stored.
 */
export function nextCanonicalPath(
  collection: ResolvedCollection,
  existing: Pick<DocumentRow, 'slug' | 'locale' | 'canonicalPath'>,
  patch: Pick<DocumentPatch, 'slug' | 'locale' | 'canonicalPath'>,
  defaultLocale: string,
): string | null {
  if (patch.canonicalPath !== undefined) return patch.canonicalPath;
  const slug = patch.slug ?? existing.slug;
  const locale = patch.locale ?? existing.locale;
  if (slug === existing.slug && locale === existing.locale) return existing.canonicalPath;
  if (!collection.seo) return existing.canonicalPath;
  return resolvePath(collection, slug, locale, defaultLocale) ?? existing.canonicalPath;
}

/** What a save made against a stale version is told. One wording, two causes. */
export const VERSION_CONFLICT_MESSAGE =
  'This document changed in another tab or by another editor while you were working. ' +
  'Reload to see the current version — saving now would overwrite their changes.';

export function versionConflict(): ApiError {
  return new ApiError('conflict', VERSION_CONFLICT_MESSAGE);
}

/**
 * A duplicate-key error on `uniq_document_versions_doc_version`: two saves
 * computed the same next version number. The row lock in `updateDocument`
 * makes this unreachable for updates; it is kept as a mapping so that if it
 * ever does happen the editor gets the same "someone else saved" answer as the
 * expectedVersion check, not a generic "Already exists."
 */
export function isVersionConflictError(err: unknown): boolean {
  if (!isDuplicateKeyError(err)) return false;
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const m = (e as { message?: unknown; sqlMessage?: unknown });
    for (const text of [m.message, m.sqlMessage]) {
      if (typeof text === 'string' && text.includes('uniq_document_versions_doc_version')) return true;
    }
  }
  return false;
}

/**
 * Refuse a slug a static route of the collection already answers at — a post
 * slugged `categories` next to the `/blog/categories` overview would save fine
 * and never be reachable.
 */
function assertSlugAvailable(collection: ResolvedCollection, slug: string): void {
  if (!isReservedSlug(collection, slug)) return;
  const message = `"${slug.trim()}" is used by a page of this section, so it cannot be a slug here. Pick another.`;
  throw invalidInput({ formErrors: [], fieldErrors: { slug: [message] }, pathErrors: { slug: [message] } }, message);
}

async function writeVersion(
  db: ReturnType<typeof getDb>,
  documentId: number,
  row: DocumentRow,
  actorId: number | null,
): Promise<void> {
  const [{ maxVersion }] = await db
    .select({ maxVersion: sql<number>`coalesce(max(${schema.documentVersions.version}), 0)` })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, documentId));
  await db.insert(schema.documentVersions).values({
    documentId,
    version: Number(maxVersion) + 1,
    snapshot: editableSnapshot(row),
    createdBy: actorId,
  });
}

export async function getDocumentById(id: number): Promise<DocumentRow | null> {
  const db = getDb();
  const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, id)).limit(1);
  return row ?? null;
}

export async function createDocument(
  config: CmsConfig,
  type: string,
  input: DocumentWriteInput,
  actorId: number | null,
  opts: DocumentWriteOptions = {},
): Promise<DocumentRow> {
  const collection = resolveCollection(config, type, opts);
  assertLocale(config, input.locale);
  assertSlugAvailable(collection, input.slug);
  const data = validateData(collection, config, input.data, {
    enforceRequired: goesLive(input.status),
  });
  /*
   * An MDX body is compiled and RUN server-side by `evaluate()` (see
   * `core/fields/mdx-guard.ts`), so the schema's `z.string()` is not validation
   * for it: `{process.env.AUTH_SECRET}` satisfies that perfectly and renders the
   * signing secret into the page. Checked here, next to `validateData`, because
   * every writer reaches this function — the admin form, the collection CRUD
   * routes, the seed CLIs, and the PM bridge, which gets to `bodyMdx` through
   * `pmFieldMap.description` while PM_BRIDGE_SPEC §13 designs that token to be
   * content-only.
   */
  await assertMdxSafe(collection.fields, data);
  const db = getDb();

  const canonicalPath =
    input.canonicalPath !== undefined
      ? input.canonicalPath
      : collection.seo
        ? resolvePath(collection, input.slug, input.locale, config.defaultLocale)
        : null;

  // One transaction for the row, its relations and its first version.
  //
  // These used to run as three separate statements: if the relation sync threw
  // — a relation pointing at a document deleted a moment earlier violates the
  // foreign key — the document row was already committed while its version
  // snapshot and its audit entry never happened. That left a document in the
  // list that no history could explain and no audit trail recorded.
  let redirectsChanged = false;
  const created = await db.transaction(async (tx) => {
    const insertResult = await tx.insert(schema.documents).values({
      type,
      slug: input.slug,
      locale: input.locale,
      status: input.status ?? 'draft',
      data,
      metaTitle: input.metaTitle ?? null,
      metaDescription: input.metaDescription ?? null,
      canonicalPath,
      noindex: input.noindex ?? false,
      nofollow: input.nofollow ?? false,
      includeInSitemap: input.includeInSitemap ?? true,
      ogImageUuid: input.ogImageUuid ?? null,
      publishedAt: input.publishedAt ?? (input.status === 'published' ? new Date() : null),
      modifiedAt: input.modifiedAt ?? null,
      scheduledFor: input.scheduledFor ?? null,
      // Every new document belongs to a translation group from day one, so
      // sibling-locale variants can later attach to it by reusing this id.
      translationGroupId: input.translationGroupId ?? crypto.randomUUID(),
      createdBy: actorId,
      updatedBy: actorId,
    });

    const id = adapter.insertId(insertResult);
    const [row] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id)).limit(1);
    await syncDocumentRelations(id, collection, data, tx as unknown as ReturnType<typeof getDb>);
    await writeVersion(tx as unknown as ReturnType<typeof getDb>, id, row, actorId);
    // A new live page at an address an old page was renamed away from takes the
    // address back: the leftover redirect would otherwise hide it.
    redirectsChanged = await applySlugChangeRedirect(
      tx as unknown as ReturnType<typeof getDb>,
      collection,
      null,
      row,
      (c, slug, locale) => resolvePath(c, slug, locale, config.defaultLocale),
    );
    return row;
  });
  if (redirectsChanged) revalidateRedirects();
  return created;
}

/**
 * The document's current version number — its optimistic-concurrency token.
 *
 * Every save appends a `document_versions` row, so the highest version is a
 * counter that changes on exactly the events that matter. Callers read it with
 * the document and hand it back on write; see `updateDocument`.
 */
export async function documentVersionNumber(documentId: number): Promise<number> {
  const [{ maxVersion }] = await getDb()
    .select({ maxVersion: sql<number>`coalesce(max(${schema.documentVersions.version}), 0)` })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, documentId));
  return Number(maxVersion);
}

export async function updateDocument(
  config: CmsConfig,
  id: number,
  patch: DocumentPatch,
  actorId: number | null,
  opts: DocumentWriteOptions = {},
): Promise<DocumentRow> {
  const existing = await getDocumentById(id);
  if (!existing) throw notFound(`Document ${id} not found.`);

  const collection = resolveCollection(config, existing.type, opts);
  if (patch.slug !== undefined && patch.slug !== existing.slug) assertSlugAvailable(collection, patch.slug);

  const nextLocale = patch.locale ?? existing.locale;
  assertLocale(config, nextLocale);

  const nextStatus = patch.status ?? existing.status;

  // Two ways a document reaches the public: new data on a live document, or a
  // status flip on data that is already stored. The second one carries no
  // `data` in the patch, so validating only `patch.data` would let a draft with
  // an omitted required group go live untouched.
  const nextData =
    patch.data !== undefined
      ? validateData(collection, config, patch.data, { enforceRequired: goesLive(nextStatus) })
      : goesLive(nextStatus) && !goesLive(existing.status)
        ? validateData(collection, config, existing.data as Record<string, unknown>, {
            enforceRequired: true,
          })
        : existing.data;
  // See `createDocument` for why a body needs more than a string check. Only a
  // patch that carries `data` can introduce one; a bare status flip is
  // re-validating what the guard already passed on the way in.
  if (patch.data !== undefined) {
    await assertMdxSafe(collection.fields, nextData as Record<string, unknown>);
  }
  const publishedAt =
    patch.publishedAt !== undefined
      ? patch.publishedAt
      : nextStatus === 'published' && !existing.publishedAt
        ? new Date()
        : existing.publishedAt;

  const db = getDb();
  // One transaction for the row, its relations and its version snapshot — the
  // same guarantee `createDocument` gained, which update never got. Three loose
  // statements meant a failure between them left the row written but its
  // relations half-synced and no version recorded, so the history skipped an
  // edit that had actually happened.
  let redirectsChanged = false;
  const canonicalPath = nextCanonicalPath(collection, existing, patch, config.defaultLocale);
  let updated: DocumentRow;
  try {
  updated = await db.transaction(async (tx) => {
  // Lock the row first, then check the version, then write — all inside the
  // transaction. Every save of this document queues on this lock, so the
  // version it reads is still current when `writeVersion` adds one to it.
  //
  // Optimistic concurrency: the form sends the WHOLE document, built from what
  // it loaded when it was opened, so two people editing the same document each
  // send a complete copy and the second write silently erased the first. When
  // the caller tells us which version it started from, a stale one is refused.
  // The check used to run before the transaction with no lock, so two saves
  // could both pass it and then collide on the version number's unique key —
  // surfacing as a generic "Already exists." instead of this message.
  const [locked] = await tx
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .for('update');
  if (!locked) throw notFound(`Document ${id} not found.`);
  if (patch.expectedVersion !== undefined) {
    const [{ maxVersion }] = await tx
      .select({ maxVersion: sql<number>`coalesce(max(${schema.documentVersions.version}), 0)` })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, id));
    if (Number(maxVersion) !== patch.expectedVersion) throw versionConflict();
  }
  await tx
    .update(schema.documents)
    .set({
      slug: patch.slug ?? existing.slug,
      locale: nextLocale,
      status: nextStatus,
      data: nextData,
      metaTitle: patch.metaTitle !== undefined ? patch.metaTitle : existing.metaTitle,
      metaDescription:
        patch.metaDescription !== undefined ? patch.metaDescription : existing.metaDescription,
      canonicalPath,
      noindex: patch.noindex ?? existing.noindex,
      nofollow: patch.nofollow ?? existing.nofollow,
      includeInSitemap: patch.includeInSitemap ?? existing.includeInSitemap,
      ogImageUuid: patch.ogImageUuid !== undefined ? patch.ogImageUuid : existing.ogImageUuid,
      publishedAt,
      modifiedAt: patch.modifiedAt !== undefined ? patch.modifiedAt : existing.modifiedAt,
      scheduledFor: patch.scheduledFor !== undefined ? patch.scheduledFor : existing.scheduledFor,
      translationGroupId:
        patch.translationGroupId !== undefined ? patch.translationGroupId : existing.translationGroupId,
      updatedBy: actorId,
    })
    .where(eq(schema.documents.id, id));

  const [row] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id)).limit(1);
  await syncDocumentRelations(id, collection, nextData, tx as unknown as ReturnType<typeof getDb>);
  await writeVersion(tx as unknown as ReturnType<typeof getDb>, id, row, actorId);
  // Here rather than in a route, so every writer — the admin, version restore,
  // the PM bridge, the seed CLIs — takes a post down the same way.
  redirectsChanged = await applyUnpublishRedirect(
    tx as unknown as ReturnType<typeof getDb>,
    config,
    collection,
    row,
    (c, slug, locale) => resolvePath(c, slug, locale, config.defaultLocale),
  );
  // A live page that changed address keeps its old links working. Same place
  // and reason as the unpublish rule: every writer — the form, a version
  // restore, the PM bridge — changes a slug through here.
  const slugRedirectsChanged = await applySlugChangeRedirect(
    tx as unknown as ReturnType<typeof getDb>,
    collection,
    existing,
    row,
    (c, slug, locale) => resolvePath(c, slug, locale, config.defaultLocale),
  );
  redirectsChanged = redirectsChanged || slugRedirectsChanged;
  return row;
  });
  } catch (err) {
    if (isVersionConflictError(err)) throw versionConflict();
    throw err;
  }
  if (redirectsChanged) revalidateRedirects();
  return updated;
}

export async function deleteDocument(id: number): Promise<void> {
  const db = getDb();
  const existing = await getDocumentById(id);
  if (!existing) throw notFound(`Document ${id} not found.`);
  // Versions + relations cascade via FK.
  await db.delete(schema.documents).where(eq(schema.documents.id, id));
}

export interface DocumentVersionSummary {
  id: number;
  version: number;
  label: string | null;
  createdBy: number | null;
  createdAt: Date;
}

/** Version snapshots for a document, newest first (for the history panel). */
export async function listVersions(documentId: number): Promise<DocumentVersionSummary[]> {
  const db = getDb();
  return db
    .select({
      id: schema.documentVersions.id,
      version: schema.documentVersions.version,
      label: schema.documentVersions.label,
      createdBy: schema.documentVersions.createdBy,
      createdAt: schema.documentVersions.createdAt,
    })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, documentId))
    .orderBy(desc(schema.documentVersions.version));
}

/**
 * Restore a document to a stored version's snapshot. Applied as a normal
 * update, so it re-validates, writes a *new* version (the restore is itself
 * recorded), and re-syncs relations — nothing is destroyed.
 */
/**
 * The status a version would put the document back into.
 *
 * Restoring is a write that can publish: the snapshot carries its own `status`,
 * so rolling back to a published version puts content live again. The route
 * needs to know that BEFORE restoring so it can apply the same publish
 * permission check as create and update.
 */
export async function versionRestoreState(
  documentId: number,
  versionId: number,
): Promise<{ status?: DocumentStatus; publishedAt?: Date | null; scheduledFor?: Date | null }> {
  const [version] = await getDb()
    .select({ snapshot: schema.documentVersions.snapshot })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.id, versionId),
        eq(schema.documentVersions.documentId, documentId),
      ),
    )
    .limit(1);
  const snap = version?.snapshot as Record<string, unknown> | undefined;
  // The dates matter as much as the status: `publishedAt` is never cleared when
  // a document is taken down, so a snapshot can read `status: 'draft'` while
  // still carrying a live publication date. Checking status alone would let
  // that combination through a gate the create/update paths would refuse.
  return {
    status: snap?.status as DocumentStatus | undefined,
    publishedAt: (snap?.publishedAt as Date | null | undefined) ?? null,
    scheduledFor: (snap?.scheduledFor as Date | null | undefined) ?? null,
  };
}

export async function restoreVersion(
  config: CmsConfig,
  documentId: number,
  versionId: number,
  actorId: number | null,
  opts: DocumentWriteOptions = {},
): Promise<DocumentRow> {
  const db = getDb();
  const [version] = await db
    .select()
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.id, versionId),
        eq(schema.documentVersions.documentId, documentId),
      ),
    )
    .limit(1);
  if (!version) throw notFound('Version not found.');

  const snap = version.snapshot as Record<string, unknown>;
  const patch: DocumentPatch = {
    slug: snap.slug as string,
    locale: snap.locale as string,
    status: snap.status as DocumentStatus,
    data: snap.data as Record<string, unknown>,
    metaTitle: (snap.metaTitle as string | null) ?? null,
    metaDescription: (snap.metaDescription as string | null) ?? null,
    canonicalPath: (snap.canonicalPath as string | null) ?? null,
    noindex: Boolean(snap.noindex),
    nofollow: Boolean(snap.nofollow),
    includeInSitemap: snap.includeInSitemap === undefined ? true : Boolean(snap.includeInSitemap),
    ogImageUuid: (snap.ogImageUuid as string | null) ?? null,
    publishedAt: snap.publishedAt ? new Date(snap.publishedAt as string) : null,
    modifiedAt: snap.modifiedAt ? new Date(snap.modifiedAt as string) : null,
    scheduledFor: snap.scheduledFor ? new Date(snap.scheduledFor as string) : null,
    translationGroupId: (snap.translationGroupId as string | null) ?? null,
  };
  return updateDocument(config, documentId, patch, actorId, opts);
}

export async function listDocuments(
  type: string,
  options: ListDocumentsOptions = {},
): Promise<ListDocumentsResult> {
  const db = getDb();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));

  const conditions = [eq(schema.documents.type, type)];
  if (options.status) conditions.push(eq(schema.documents.status, options.status));
  if (options.locale) conditions.push(eq(schema.documents.locale, options.locale));
  if (options.search) {
    const term = likeTerm(options.search);
    const match = or(like(schema.documents.slug, term), like(schema.documents.metaTitle, term));
    if (match) conditions.push(match);
  }
  const where = and(...conditions);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.documents)
    .where(where);

  const items = await db
    .select({
      id: schema.documents.id,
      type: schema.documents.type,
      slug: schema.documents.slug,
      locale: schema.documents.locale,
      status: schema.documents.status,
      publishedAt: schema.documents.publishedAt,
      scheduledFor: schema.documents.scheduledFor,
      modifiedAt: schema.documents.modifiedAt,
      canonicalPath: schema.documents.canonicalPath,
      metaTitle: schema.documents.metaTitle,
      metaDescription: schema.documents.metaDescription,
      data: schema.documents.data,
      createdAt: schema.documents.createdAt,
      updatedAt: schema.documents.updatedAt,
    })
    .from(schema.documents)
    .where(where)
    .orderBy(desc(schema.documents.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items, page, pageSize, total: Number(total) };
}

/** The slugs already stored in a translation group — for keeping a legacy,
 *  un-normalised group slug when a new locale joins it. */
export async function translationGroupSlugs(type: string, translationGroupId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ slug: schema.documents.slug })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, type), eq(schema.documents.translationGroupId, translationGroupId)));
  return rows.map((r) => r.slug);
}

/** All locale variants sharing a row's translation group (or just the row when
 *  unlinked), ordered by locale. Powers the language-switcher editor. */
export async function getDocumentGroup(row: DocumentRow): Promise<DocumentRow[]> {
  if (!row.translationGroupId) return [row];
  const db = getDb();
  return db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.type, row.type),
        eq(schema.documents.translationGroupId, row.translationGroupId),
      ),
    )
    .orderBy(schema.documents.locale);
}

/**
 * Grouped list: one entry per translation group (logical document), each
 * carrying its per-locale variants for status badges. A group matches the
 * status/search filter when *any* of its variants does, but the returned
 * `variants` array always lists every locale so the UI can show what's missing.
 * Paginated by group, ordered by most recently touched.
 */
export async function listDocumentGroups(
  type: string,
  options: ListDocumentGroupsOptions = {},
): Promise<ListDocumentGroupsResult> {
  const db = getDb();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));
  const groupKey = sql<string>`coalesce(${schema.documents.translationGroupId}, concat('doc:', ${schema.documents.id}))`;

  const conditions = [eq(schema.documents.type, type)];
  if (options.status) conditions.push(eq(schema.documents.status, options.status));
  if (options.search) {
    const term = likeTerm(options.search);
    /*
     * The title as well as the slug and the meta title.
     *
     * Searching a field the list does not show, while not searching the one it does, is
     * how an editor comes to believe a save failed: they rename an article, type the new
     * name in the box, and get nothing back. `JSON_EXTRACT` on the declared path returns
     * the group's JSON text, so a word in any of its parts matches — crude next to a
     * generated column, and enough to make the box do what it appears to do.
     */
    const parts = [like(schema.documents.slug, term), like(schema.documents.metaTitle, term)];
    if (options.titlePath) {
      const jsonPath = `$.${options.titlePath}`;
      parts.push(sql`json_extract(${schema.documents.data}, ${jsonPath}) like ${term}`);
    }
    const match = or(...parts);
    if (match) conditions.push(match);
  }
  const where = and(...conditions);

  const [{ total }] = await db
    .select({ total: sql<number>`count(distinct ${groupKey})` })
    .from(schema.documents)
    .where(where);

  const pageGroups = await db
    .select({ groupKey })
    .from(schema.documents)
    .where(where)
    .groupBy(groupKey)
    .orderBy(desc(sql`max(${schema.documents.updatedAt})`))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const keys = pageGroups.map((g) => g.groupKey);
  if (keys.length === 0) return { items: [], page, pageSize, total: Number(total) };

  // Fetch every variant of the page's groups (no status/search filter here, so
  // badges reflect all locales — including a draft one filtered out above).
  const rows = await db
    .select({
      id: schema.documents.id,
      groupKey,
      translationGroupId: schema.documents.translationGroupId,
      slug: schema.documents.slug,
      locale: schema.documents.locale,
      status: schema.documents.status,
      metaTitle: schema.documents.metaTitle,
      data: schema.documents.data,
      updatedAt: schema.documents.updatedAt,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, type), inArray(groupKey, keys)));

  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byKey.get(r.groupKey) ?? [];
    list.push(r);
    byKey.set(r.groupKey, list);
  }

  const items: DocumentGroupSummary[] = keys.map((key) => {
    const variants = (byKey.get(key) ?? []).sort((a, b) => a.locale.localeCompare(b.locale));
    const rep =
      variants.find((v) => v.locale === options.defaultLocale) ?? variants[0];
    return {
      id: rep.id,
      groupKey: key,
      translationGroupId: rep.translationGroupId,
      slug: rep.slug,
      title: deriveDocumentTitle(rep.data, options.titlePath, options.titleOrder),
      metaTitle: rep.metaTitle,
      updatedAt: variants.reduce(
        (max, v) => (v.updatedAt > max ? v.updatedAt : max),
        variants[0].updatedAt,
      ),
      variants: variants.map((v) => ({
        id: v.id,
        locale: v.locale,
        status: v.status,
        updatedAt: v.updatedAt,
      })),
    };
  });

  return { items, page, pageSize, total: Number(total) };
}
