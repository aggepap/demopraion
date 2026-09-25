import { notFound } from 'next/navigation';

import config from '@/site.config';
import { previewMdxAction } from '@/app/admin/actions/mdx-preview';
import { DocumentForm, type DocumentGroupInitial, type DocumentInitial } from '@/cms/admin';
import { groupPartOrder } from '@/cms/config';
import {
  deriveDocumentTitle,
  documentVersionNumber,
  getCustomFieldsConfig,
  getDocumentById,
  getDocumentGroup,
  getSeoFieldsFor,
  mergeCustomFields,
  previewTargetFor,
} from '@/cms/core';
import { toWireDateTime } from '@/cms/admin/local-datetime';
import { promoteDueScheduled } from '@/cms/core/documents/publish-scheduled';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import { getAdminPath } from '@/cms/core/paths';
import { resolveAdminCollection } from '@/lib/cms/collection-route';
import { getLocaleSettings } from '@/lib/i18n/locale-settings';

export default async function EditDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ collection: string; id: string }>;
  /*
   * The language tabs move `?locale=` rather than navigating to the sibling
   * row, so this is how the server knows which variant is on screen.
   */
  searchParams: Promise<{ locale?: string }>;
}) {
  const { collection: key, id } = await params;
  const { locale: requestedLocale } = await searchParams;
  const base = resolveAdminCollection(key, `/${id}`);

  const user = await requirePerm(PERMISSIONS.contentRead);
  // Publishing is a separate permission, so the form must know: without it,
  // offering the statuses the server will refuse is a dead end.
  const canPublish = hasPerm(user.permissions, PERMISSIONS.contentPublish);
  // The edit lock is only taken by someone who could actually write: a reader
  // holding a document hostage would be a worse bug than no locking at all.
  const canWrite = hasPerm(user.permissions, PERMISSIONS.contentWrite);

  /*
   * A stale bookmark or a typo must land on "not found", not on a stack trace.
   *
   * `Number('oops')` is `NaN`, and that went straight into the query — the page threw a
   * raw runtime error with SQL in it. Which also means every screenshot a UX pass took
   * of this screen was a picture of the crash rather than of the editor.
   */
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  // Before reading: a scheduled document whose time has passed is shown — and
  // stored — as published. Several language rows can be due at once.
  await promoteDueScheduled(key);

  const row = await getDocumentById(numericId);
  if (!row || row.type !== key) notFound();

  const [group, collection, customFields, seoFields] = await Promise.all([
    getDocumentGroup(row),
    mergeCustomFields(config, base, { data: row.data as Record<string, unknown> }),
    getCustomFieldsConfig(key),
    getSeoFieldsFor(base),
  ]);

  // Tabs = the currently-editable locales, unioned with any locale that
  // already has a saved variant — so a translation stays editable even if its
  // language was later toggled out of the editing set (never strand content).
  const { editing } = await getLocaleSettings();
  const present = new Set<string>([...editing, ...group.map((r) => r.locale)]);
  const localesForForm = config.locales.filter((l) => present.has(l));

  const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  // The version each variant is at, so the form can prove on save that nobody
  // else has written to it since (see `updateDocument`'s expectedVersion).
  const versions = await Promise.all(group.map((r) => documentVersionNumber(r.id)));
  const variants: DocumentInitial[] = group.map((r, i) => ({
    version: versions[i],
    id: r.id,
    slug: r.slug,
    locale: r.locale,
    status: r.status,
    data: r.data,
    metaTitle: r.metaTitle,
    metaDescription: r.metaDescription,
    noindex: r.noindex,
    nofollow: r.nofollow,
    includeInSitemap: r.includeInSitemap,
    ogImageUuid: r.ogImageUuid,
    publishedAt: ymd(r.publishedAt),
    modifiedAt: ymd(r.modifiedAt),
    // The full UTC instant. The form converts it to the editor's own clock for
    // the `datetime-local` box — the server cannot know the editor's zone, and
    // cutting a UTC string to `HH:mm` showed Greek editors a time three hours off.
    scheduledFor: toWireDateTime(r.scheduledFor ? new Date(r.scheduledFor) : null),
  }));

  /*
   * Preview follows the language tab, not the row id in the URL.
   *
   * Both are the same document to an editor; the id is only whichever variant
   * they happened to open. Building the link from that row sent anyone working
   * on the English tab to the Greek article.
   */
  const previewTarget = previewTargetFor(group, requestedLocale ?? null, row);

  const initialGroup: DocumentGroupInitial = {
    translationGroupId: row.translationGroupId,
    slug: row.slug,
    variants,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        {/*
          The document's own name, not its slug.
          The heading used to read "Edit — /test", which is the URL segment: the
          one part of a document an editor rarely chose and never says out loud.
          With several experiences open in tabs it identified none of them. The
          slug still matters — it is the public URL — so it stays, one line down
          and quieter, where it reads as an attribute of the thing rather than
          as its name. `titlePath` already tells us where each collection keeps
          its title; the list and the search box read it the same way.
        */}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-neutral-900">
            {deriveDocumentTitle(
              row.data,
              collection.titlePath,
              // The stored group has lost its declared order to MySQL's JSON
              // key normalisation; the config still has it.
              collection.titlePath
                ? (groupPartOrder(collection.fields, collection.titlePath) ?? undefined)
                : undefined
            ) ?? 'Untitled'}
          </h1>
          <p className="mt-0.5 truncate font-mono text-xs text-neutral-500">/{row.slug}</p>
        </div>
        {previewTarget ? (
          <a
            href={`/api/cms/preview?redirect=${encodeURIComponent(previewTarget.path)}`}
            target="_blank"
            rel="noreferrer"
            // `shrink-0`: the heading beside it truncates, and without this a
            // long experience name squeezed the button into two words.
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
          >
            Preview draft
            {localesForForm.length > 1 ? (
              <span className="ml-1 uppercase">({previewTarget.locale})</span>
            ) : null}{' '}
            ↗
          </a>
        ) : null}
      </div>
      {/*
        The form seeds its state from `initialGroup` once, on mount. A version
        restore writes new content on the server and calls `router.refresh()`,
        which re-renders THIS component with the restored data — but the form
        kept its old state, so the screen still showed the pre-restore content
        and the next Save wrote that stale copy back, silently undoing the
        restore.

        The stamp of when each row last changed is what tells the form that its
        copy is behind. It is handed over as a prop rather than as the form's
        React `key`: a `key` change remounts, and a remount discards the language
        tab the editor is on along with anything unsaved in the other tabs — for
        the form's own save as much as for someone else's. The form decides what
        to adopt instead.
      */}
      <DocumentForm
        renderMdxPreview={previewMdxAction}
        adminPath={getAdminPath()}
        serverStamp={group.map((r) => `${r.id}:${new Date(r.updatedAt).getTime()}`).join('|')}
        collection={collection}
        locales={localesForForm}
        defaultLocale={config.defaultLocale}
        canPublish={canPublish}
        canWrite={canWrite}
        initialGroup={initialGroup}
        customFields={customFields}
        seoFields={seoFields}
      />
    </div>
  );
}
