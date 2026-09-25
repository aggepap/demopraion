import 'server-only';

import { z } from 'zod';

import { groupPartOrder, type CmsConfig, type ResolvedCollection } from '../../config';
import { documentStatusValues } from '../../db/adapters/mysql/schema/documents';
import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { logAudit } from '../audit';
import {
  createDocument,
  deleteDocument,
  getDocumentById,
  listDocuments,
  listDocumentGroups,
  listVersions,
  normalizeDocumentSlug,
  restoreVersion,
  translationGroupSlugs,
  updateDocument,
  versionRestoreState,
  type DocumentGroupSummary,
  type DocumentSummary,
} from '../documents';
import {
  isLiveStatus,
  PUBLISH_DENIED_DELETE_LIVE,
  publishDenialMessage,
  publishForbidden,
} from '../documents/publish-rights';
import { createRoute } from '../api/handler';
import { idParam } from '../api/params';
import { created, noContent, ok, paginated } from '../api/respond';
import { invalidInput, notFound } from '../errors';
import { assertNotLockedByOther, documentLockKeyFor } from '../locks';
import { resolveCollectionWithCustomFields } from '../fields/resolve';
import { revalidateDocument } from '../read';
import { resolveModuleFlags } from '../settings/modules';

/**
 * Generic collection CRUD, parameterised by the site config. One set of
 * factories serves every collection — the `[collection]` route segment selects
 * which. Core receives the config as an argument (it never imports site code);
 * the thin route files under `src/app/api/cms/**` wire config + these factories.
 */

export const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(documentStatusValues).optional(),
  locale: z.string().min(2).max(8).optional(),
  search: z.string().max(200).optional(),
  // When set, return one entry per translation group (with per-locale variants)
  // instead of one row per locale.
  // `z.stringbool`, not `z.coerce.boolean`: coercion is `Boolean(value)`, and
  // every non-empty string — `"false"` and `"0"` included — is truthy, so
  // `?grouped=false` returned the grouped list.
  grouped: z.stringbool().optional(),
});

const createBody = z.object({
  // Trimmed before length checks: a slug with a leading or trailing space was
  // stored and published happily, but its clean URL never resolved — the page
  // existed at an address nobody could type.
  slug: z.string().trim().min(1).max(191),
  locale: z.string().min(2).max(8),
  status: z.enum(documentStatusValues).optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  metaTitle: z.string().max(255).nullish(),
  metaDescription: z.string().max(320).nullish(),
  canonicalPath: z.string().max(512).nullish(),
  noindex: z.boolean().optional(),
  nofollow: z.boolean().optional(),
  includeInSitemap: z.boolean().optional(),
  ogImageUuid: z.string().uuid().nullish(),
  translationGroupId: z.string().max(36).nullish(),
  // Editorial dates — coerced from the admin form's `YYYY-MM-DD` inputs so a
  // case/article can be backdated to its true publication/revision date.
  publishedAt: z.coerce.date().nullish(),
  modifiedAt: z.coerce.date().nullish(),
  scheduledFor: z.coerce.date().nullish(),
});

/**
 * A `scheduled` document without a date is a document that never publishes.
 *
 * `isVisible()` requires `scheduledFor` to have passed, so `scheduled` with a
 * null date is permanently invisible — the editor chose a status, saved
 * successfully, and the piece simply never appeared. Nothing said so: the list
 * screen shows it as scheduled, the API returns 201, and the only symptom is a
 * page that stays missing. The admin form grew a "Publish at" field, but the
 * field only *showed* a message — nothing stopped the save, and nothing at all
 * stopped a direct API call. The rule belongs here, where both go through.
 */
const SCHEDULE_WITHOUT_DATE =
  'A scheduled document needs a publish date — pick one, or set the status back to draft.';

const scheduleIsDated = (v: { status?: string | null; scheduledFor?: Date | null }): boolean =>
  v.status !== 'scheduled' || v.scheduledFor != null;

const createBodyChecked = createBody.refine(scheduleIsDated, {
  message: SCHEDULE_WITHOUT_DATE,
  path: ['scheduledFor'],
});

// `.partial()` does not exist on a refined schema, so the patch shape is built
// from the plain object. A patch may also set only ONE of the two fields, so
// the effective values are re-checked against the stored row in the handler.
const updateBody = createBody.partial().extend({
  /**
   * Genuinely optional — and it must not inherit `createBody`'s `.default({})`.
   *
   * `.partial()` makes a key optional but leaves its default in place, so a
   * PATCH that never mentioned `data` arrived at the service as `data: {}` —
   * indistinguishable from a caller asking to empty the document. The service
   * has always had the right branch for an absent `data` (keep what is stored),
   * and the handler's own comment describes a slug-only PATCH as normal; the
   * default meant that branch could never be reached.
   *
   * What that cost: `PATCH /api/cms/article/:id` with `{ slug }` answered 200
   * and wiped the article's body, header and every other field. No error, no
   * warning, and the version history recorded the empty document as a genuine
   * edit.
   */
  data: z.record(z.string(), z.unknown()).optional(),
  /** Optimistic-concurrency token — the version the editor loaded. */
  expectedVersion: z.number().int().nonnegative().optional(),
});

/**
 * Whether a collection's API is open: it exists and, when it belongs to a
 * module, that module is switched on.
 *
 * The generic routes checked only that the key exists, so `/api/cms/product`
 * listed, created and edited products with the shop switched off — the admin
 * hid the screens, the API behind them stayed open.
 */
export function collectionAvailable(
  collection: Pick<ResolvedCollection, 'module'> | undefined,
  moduleFlags: Record<string, boolean>,
): boolean {
  if (!collection) return false;
  return !collection.module || moduleFlags[collection.module] === true;
}

/** 404 for an unknown collection, or one whose module is off. */
export async function assertCollection(config: CmsConfig, key: string): Promise<void> {
  const collection = config.collectionByKey.get(key);
  if (!collection) throw notFound(`Unknown collection "${key}".`);
  if (collection.module && !collectionAvailable(collection, await resolveModuleFlags(config))) {
    throw notFound(`Unknown collection "${key}".`);
  }
}

/**
 * The collection as the admin form saw it: config fields plus any
 * admin-defined custom fields, with conditional visibility resolved against
 * the payload's own categories. Passed into the write path so the validator
 * and the editor agree on which fields exist and which are required.
 */
function writeCollection(
  config: CmsConfig,
  key: string,
  data: unknown,
  opts: { relaxRequired?: boolean } = {},
) {
  return resolveCollectionWithCustomFields(config, key, {
    data: (data ?? {}) as Record<string, unknown>,
    relaxRequired: opts.relaxRequired,
  });
}

/** GET /api/cms/:collection — paginated list. */
export function collectionListRoute(config: CmsConfig) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.contentRead),
    query: listQuery,
    handler: async ({ params, query }) => {
      await assertCollection(config, params.collection);
      const listed = config.collectionByKey.get(params.collection);
      const listedTitlePath = listed?.titlePath;
      const result = query?.grouped
        ? await listDocumentGroups(params.collection, {
            ...query,
            defaultLocale: config.defaultLocale,
            titlePath: listedTitlePath,
            // Without the declared order a grouped headline comes back in MySQL's
            // normalised JSON key order, i.e. backwards.
            titleOrder:
              listed && listedTitlePath
                ? (groupPartOrder(listed.fields, listedTitlePath) ?? undefined)
                : undefined,
          })
        : await listDocuments(params.collection, query ?? {});
      return paginated<DocumentSummary | DocumentGroupSummary>(result.items, {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      });
    },
  });
}

/**
 * Putting content live is a separate privilege from editing it.
 *
 * `contentWrite` lets a principal author a document; `contentPublish` is what
 * makes it public. Both the status enum and the editorial date fields can take
 * a document live, so all of them are gated — otherwise the "publish" step is
 * just a client-side convention. The guard runs before the body is parsed, so
 * the check lives here, where the payload is known.
 */
async function requirePublishRights(
  input: {
    status?: string;
    publishedAt?: Date | null;
    scheduledFor?: Date | null;
  },
  before?: { status?: string } | null,
): Promise<Response | null> {
  /*
   * Taking content DOWN is the same privilege as putting it up.
   *
   * Only the move toward `published`/`scheduled` used to be gated, which made the
   * gate one-way: `contentWrite` alone could not publish a page, but could patch a
   * live one back to `draft` — or delete it outright — and take it off the site.
   * A permission that cannot publish must not be able to unpublish either, or
   * "publish rights" only describe who may put content live, not who controls
   * what the public sees. The rule and its wording: `documents/publish-rights.ts`.
   */
  const message = publishDenialMessage(input, before);
  if (!message) return null;
  return requirePublishPerm(message);
}

/**
 * `contentPublish`, or a 403 that says why in words. A bare `forbidden` was all
 * the form had to show a writer who tried to archive a live page.
 */
async function requirePublishPerm(message: string): Promise<Response | null> {
  const res = await requireApiPerm(PERMISSIONS.contentPublish);
  if (!(res instanceof Response)) return null;
  return res.status === 403 ? publishForbidden(message) : res;
}

/** POST /api/cms/:collection — create a document. */
export function collectionCreateRoute(config: CmsConfig) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.contentWrite),
    input: createBodyChecked,
    handler: async ({ params, input, auth }) => {
      await assertCollection(config, params.collection);
      const denied = await requirePublishRights(input);
      if (denied) return denied;
      // A locale joining an existing group keeps the group's stored slug even
      // when it predates normalisation; anything else is normalised.
      input.slug = normalizeDocumentSlug(
        input.slug,
        input.translationGroupId ? await translationGroupSlugs(params.collection, input.translationGroupId) : [],
      );
      /*
       * A brand-new document has nothing to collide with. Adding a LOCALE to an
       * existing group does: that is the same editor screen, and the same lock.
       */
      if (input.translationGroupId) {
        await assertNotLockedByOther('document', input.translationGroupId, auth.userId);
      }
      const collection = await writeCollection(config, params.collection, input.data);
      const row = await createDocument(config, params.collection, input, auth.userId, {
        collection,
      });
      revalidateDocument(row);
      await logAudit({
        userId: auth.userId,
        action: 'document.create',
        subjectType: params.collection,
        subjectId: row.id,
        after: row,
      });
      return created(row);
    },
  });
}

/** GET /api/cms/:collection/:id — fetch one. */
export function collectionGetRoute(config: CmsConfig) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.contentRead),
    handler: async ({ params }) => {
      await assertCollection(config, params.collection);
      const row = await getDocumentById(idParam(params.id));
      if (!row || row.type !== params.collection) throw notFound('Document not found.');
      return ok(row);
    },
  });
}

/** PATCH /api/cms/:collection/:id — update. */
export function collectionUpdateRoute(config: CmsConfig) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.contentWrite),
    input: updateBody,
    handler: async ({ params, input, auth }) => {
      await assertCollection(config, params.collection);
      // The stored row has to be read BEFORE the publish check now, because
      // unpublishing is only visible by comparing the patch against it.
      const before = await getDocumentById(idParam(params.id));
      if (!before || before.type !== params.collection) throw notFound('Document not found.');
      // The form re-sends the stored slug on every save; only a changed one is
      // normalised, so a legacy slug is never rewritten behind the editor's back.
      if (input.slug !== undefined) input.slug = normalizeDocumentSlug(input.slug, [before.slug]);
      await assertNotLockedByOther('document', documentLockKeyFor(before), auth.userId);
      const denied = await requirePublishRights(input, before);
      if (denied) return denied;
      // The patch may carry only the status, or only the date — so check what
      // the row will actually BE, not what this request happens to mention.
      const nextStatus = input.status ?? before.status;
      const nextScheduledFor = input.scheduledFor !== undefined ? input.scheduledFor : before.scheduledFor;
      if (!scheduleIsDated({ status: nextStatus, scheduledFor: nextScheduledFor })) {
        throw invalidInput(
          { formErrors: [], fieldErrors: {}, pathErrors: { scheduledFor: [SCHEDULE_WITHOUT_DATE] } },
          SCHEDULE_WITHOUT_DATE,
        );
      }
      // A PATCH may omit `data` entirely (slug-only sync from the form); fall
      // back to the stored row so visibility still resolves against real categories.
      const collection = await writeCollection(config, params.collection, input.data ?? before.data);
      const row = await updateDocument(config, before.id, input, auth.userId, { collection });
      revalidateDocument(row);
      // Also revalidate the previous path/slug if it changed.
      if (before.canonicalPath && before.canonicalPath !== row.canonicalPath) {
        revalidateDocument(before);
      }
      await logAudit({
        userId: auth.userId,
        action: 'document.update',
        subjectType: params.collection,
        subjectId: row.id,
        before,
        after: row,
      });
      return ok(row);
    },
  });
}

/** GET /api/cms/:collection/:id/versions — version history (newest first). */
export function collectionVersionsRoute(config: CmsConfig) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.contentRead),
    handler: async ({ params }) => {
      await assertCollection(config, params.collection);
      const doc = await getDocumentById(idParam(params.id));
      if (!doc || doc.type !== params.collection) throw notFound('Document not found.');
      return ok(await listVersions(doc.id));
    },
  });
}

/** POST /api/cms/:collection/:id/versions/:versionId/restore — roll back. */
export function collectionRestoreRoute(config: CmsConfig) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.contentWrite),
    handler: async ({ params, auth }) => {
      await assertCollection(config, params.collection);
      const before = await getDocumentById(idParam(params.id));
      if (!before || before.type !== params.collection) throw notFound('Document not found.');
      await assertNotLockedByOther('document', documentLockKeyFor(before), auth.userId);
      const versionId = idParam(params.versionId, 'version id');
      // Restoring a published snapshot puts content live again, so it needs the
      // same publish permission as create and update. Without this, restore was
      // the one write path that could publish with `contentWrite` alone.
      const denied = await requirePublishRights(
        await versionRestoreState(before.id, versionId),
        before,
      );
      if (denied) return denied;
      const collection = await writeCollection(config, params.collection, before.data, {
        relaxRequired: true,
      });
      const row = await restoreVersion(config, before.id, versionId, auth.userId, {
        collection,
      });
      revalidateDocument(row);
      await logAudit({
        userId: auth.userId,
        action: 'document.restore',
        subjectType: params.collection,
        subjectId: row.id,
        before,
        after: row,
      });
      return ok(row);
    },
  });
}

/** DELETE /api/cms/:collection/:id — delete. */
export function collectionDeleteRoute(config: CmsConfig) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.contentWrite),
    handler: async ({ params, auth }) => {
      await assertCollection(config, params.collection);
      const before = await getDocumentById(idParam(params.id));
      if (!before || before.type !== params.collection) throw notFound('Document not found.');
      await assertNotLockedByOther('document', documentLockKeyFor(before), auth.userId);
      // Deleting a live document is the most complete way to unpublish it, so it
      // needs the same right as patching one back to draft. Drafts stay on
      // `contentWrite` — an editor still owns everything the public cannot see.
      if (isLiveStatus(before.status)) {
        const denied = await requirePublishPerm(PUBLISH_DENIED_DELETE_LIVE);
        if (denied) return denied;
      }
      await deleteDocument(before.id);
      revalidateDocument(before);
      await logAudit({
        userId: auth.userId,
        action: 'document.delete',
        subjectType: params.collection,
        subjectId: before.id,
        before,
      });
      return noContent();
    },
  });
}
