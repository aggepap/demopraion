import Link from 'next/link';

import config from '@/site.config';
import { DocumentList, labelText, type DocumentListItem } from '@/cms/admin';
import { adminHref } from '@/cms/admin/admin-path';
import { parseDocumentListQuery } from '@/cms/admin/document-list-query';
import { groupPartOrder } from '@/cms/config';
import { listDocumentGroups } from '@/cms/core';
import { promoteDueScheduled } from '@/cms/core/documents/publish-scheduled';
import { mdxBodyField } from '@/cms/core/import';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import { getAdminPath } from '@/cms/core/paths';
import { resolveAdminCollection } from '@/lib/cms/collection-route';
import { getLocaleSettings } from '@/lib/i18n/locale-settings';

export default async function CollectionListPage({
  params,
  searchParams,
}: {
  params: Promise<{ collection: string }>;
  /** `?q=&status=&page=` — the list mirrors its filters here; see `parseDocumentListQuery`. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { collection: key } = await params;
  const query = parseDocumentListQuery(await searchParams);
  const adminPath = getAdminPath();
  const collection = resolveAdminCollection(key);

  const user = await requirePerm(PERMISSIONS.contentRead);
  // Deleting needs more than reading, so the list must know what to offer.
  const canWrite = hasPerm(user.permissions, PERMISSIONS.contentWrite);
  const canPublish = hasPerm(user.permissions, PERMISSIONS.contentPublish);

  const { editing } = await getLocaleSettings();

  // A scheduled document whose time has passed is live; store it as such before
  // listing, so the Status column does not go on saying "scheduled".
  await promoteDueScheduled(key);

  const PAGE_SIZE = 25;
  // The page the URL asks for, not always unfiltered page 1: the client seeds
  // its controls from the same query and does not re-fetch on mount.
  const result = await listDocumentGroups(key, {
    page: query.page,
    status: query.status || undefined,
    search: query.search || undefined,
    pageSize: PAGE_SIZE,
    defaultLocale: config.defaultLocale,
    titlePath: collection.titlePath,
    // The declared part order for a grouped headline — the stored JSON has lost it.
    titleOrder: collection.titlePath
      ? (groupPartOrder(collection.fields, collection.titlePath) ?? undefined)
      : undefined,
  });
  const items: DocumentListItem[] = result.items.map((g) => ({
    id: g.id,
    slug: g.slug,
    title: g.title,
    metaTitle: g.metaTitle,
    updatedAt: g.updatedAt.toISOString(),
    variants: g.variants.map((v) => ({ id: v.id, locale: v.locale, status: v.status })),
  }));

  const title = labelText(collection.labelPlural, config.defaultLocale, key);
  // Only collections a markdown file can describe. The import route refuses the
  // rest, so offering the button there would be a dead end.
  const canImport = mdxBodyField(collection.fields) !== null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
        <div className="flex items-center gap-2">
          {/*
            A link to the New screen with the picker already open, rather than a
            second copy of the import UI here: the import fills in a language
            TAB, and the tabs only exist on the form.
          */}
          {canImport ? (
            <Link
              href={adminHref(adminPath, `${key}/new?import=1`)}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Import .md
            </Link>
          ) : null}
          <Link
            href={adminHref(adminPath, `${key}/new`)}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            + New
          </Link>
        </div>
      </div>
      <DocumentList
        collection={collection}
        locales={editing}
        initialItems={items}
        total={result.total}
        pageSize={PAGE_SIZE}
        adminPath={adminPath}
        canWrite={canWrite}
        canPublish={canPublish}
      />
    </div>
  );
}
