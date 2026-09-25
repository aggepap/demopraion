import type { DocumentRow } from '../../db/adapters/mysql/schema/documents';

/**
 * What a `document_versions` row stores: every editable column of the document.
 *
 * Its own module, free of server-only imports, because `db:seed-content` writes
 * a document's first version too and runs under plain tsx — the service module
 * reaches `server-only` through the redirect writers.
 */
export function editableSnapshot(row: DocumentRow): Record<string, unknown> {
  return {
    slug: row.slug,
    locale: row.locale,
    status: row.status,
    data: row.data,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    canonicalPath: row.canonicalPath,
    noindex: row.noindex,
    nofollow: row.nofollow,
    includeInSitemap: row.includeInSitemap,
    ogImageUuid: row.ogImageUuid,
    publishedAt: row.publishedAt,
    modifiedAt: row.modifiedAt,
    scheduledFor: row.scheduledFor,
    translationGroupId: row.translationGroupId,
  };
}
