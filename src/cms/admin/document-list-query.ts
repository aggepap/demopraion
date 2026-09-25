/**
 * The document list's filters, as they appear in the URL.
 *
 * The list mirrors its search, status and page into the query string so a
 * filtered view survives a reload and can be sent as a link. The server page
 * used to ignore that query and always render unfiltered page 1, while the
 * client — seeded from the same URL — skipped its first fetch on the promise
 * that the server had already done the work. Reloading `?status=draft` showed
 * every document with "draft" selected above them.
 *
 * Both halves now read the URL through this one function, so what the server
 * renders is exactly what the controls say is on screen.
 */
import { isLiveStatus } from '../core/documents/live-status';

export const DOCUMENT_LIST_STATUSES = ['draft', 'published', 'scheduled', 'archived'] as const;
export type DocumentListStatus = (typeof DOCUMENT_LIST_STATUSES)[number];

export interface DocumentListQuery {
  page: number;
  /** '' = all statuses. */
  status: DocumentListStatus | '';
  /** Trimmed; '' = no search. */
  search: string;
}

/** The API refuses longer search terms (`listQuery` in core/routes/collections). */
const MAX_SEARCH = 200;

type ParamSource =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

function read(source: ParamSource, name: string): string {
  if (typeof (source as { get?: unknown }).get === 'function') {
    return (source as { get(name: string): string | null }).get(name) ?? '';
  }
  const value = (source as Record<string, string | string[] | undefined>)[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Parse `?q=&status=&page=` from `URLSearchParams` (client) or a Next
 * `searchParams` record (server). Anything unreadable falls back to the
 * unfiltered default rather than erroring — a mangled link should still open
 * the list.
 */
export function parseDocumentListQuery(source: ParamSource): DocumentListQuery {
  const pageRaw = Number(read(source, 'page'));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const statusRaw = read(source, 'status');
  const status = (DOCUMENT_LIST_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as DocumentListStatus)
    : '';
  const search = read(source, 'q').trim().slice(0, MAX_SEARCH);
  return { page, status, search };
}

/**
 * Whether this user can delete the whole translation group from the list.
 *
 * Mirrors the DELETE route: `cms.content.write` for any document, and
 * publishing rights as well once a language is live — deleting a live page is
 * the most complete way to unpublish it. The list deletes every language of a
 * group; offering the button when one of them would be refused ended in a
 * half-deleted group and a bare "forbidden".
 */
export function canDeleteDocumentGroup(
  variants: ReadonlyArray<{ status: string }>,
  rights: { canWrite: boolean; canPublish: boolean },
): boolean {
  if (!rights.canWrite) return false;
  return rights.canPublish || !variants.some((v) => isLiveStatus(v.status));
}
