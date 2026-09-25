'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { ResolvedCollection } from '../config';
import { adminHref } from './admin-path';
import { cmsApi, CmsApiError, type ListResponse } from './api-client';
import { canDeleteDocumentGroup, DOCUMENT_LIST_STATUSES, parseDocumentListQuery } from './document-list-query';
import { InfoTip } from './ui';
import { useConfirm } from './ui/ConfirmDialog';

/** One locale variant of a grouped document. */
export interface DocumentVariantItem {
  id: number;
  locale: string;
  status: string;
}

/** A grouped list row — one logical document across all its languages. */
export interface DocumentListItem {
  /** Representative row id (default-locale variant, else first). */
  id: number;
  slug: string;
  /** Display title from the document's `data` (independent of the slug). */
  title: string | null;
  metaTitle: string | null;
  updatedAt: string;
  variants: DocumentVariantItem[];
}

/*
 * Archived was `bg-neutral-200` against draft's `bg-neutral-100`, same text colour —
 * two shades of grey apart, which is neither legible at a glance nor a distinction
 * anyone with a colour-vision difference can make (WCAG 1.4.1). A document that is
 * finished-with reads very differently from one that is still being written, and the
 * badge is the only place the list says which it is.
 */
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-700',
  published: 'bg-green-100 text-green-700',
  scheduled: 'bg-amber-100 text-amber-700',
  archived: 'border border-dashed border-neutral-400 bg-white text-neutral-500 line-through',
};

const selectClass =
  'rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-neutral-500 focus:outline-none';

/**
 * Config-driven list screen. Rows are grouped by translation: one entry per
 * logical document, with a badge per configured locale (present → status, or
 * "missing"). The server renders the page the URL asks for — filters included,
 * read through the same `parseDocumentListQuery` as the controls here — and
 * search/status/paging changes re-fetch through the CMS API in grouped mode.
 */
export function DocumentList({
  collection,
  locales,
  initialItems,
  total: initialTotal,
  pageSize,
  adminPath,
  canWrite,
  canPublish,
}: {
  collection: ResolvedCollection;
  locales: string[];
  initialItems: DocumentListItem[];
  total: number;
  pageSize: number;
  /** The admin URL segment (`ADMIN_PATH`), resolved on the server. */
  adminPath: string;
  /** `cms.content.write` — without it nothing can be deleted. */
  canWrite: boolean;
  /** `cms.content.publish` — also needed to delete a group with a live language. */
  canPublish: boolean;
}) {
  const router = useRouter();

  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  // Seeded FROM the URL, so a filtered view survives a reload and can be sent
  // to someone else as a link. Previously these lived only in React state: a
  // refresh silently threw the filter away and "look at the drafts" could not
  // be shared.
  const searchParams = useSearchParams();
  const [initialQuery] = useState(() => parseDocumentListQuery(searchParams));
  const [page, setPage] = useState(initialQuery.page);
  const [status, setStatus] = useState<string>(initialQuery.status);
  const [search, setSearch] = useState(initialQuery.search);
  // Seeded too, not ''. From '' the URL mirror below dropped `?q=` on the first
  // render and the debounce then fetched a second time for the same term.
  const [debouncedSearch, setDebouncedSearch] = useState(initialQuery.search);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  /** Bumped to force a re-fetch without changing any filter. */
  const [refreshTick, setRefreshTick] = useState(0);
  const { confirm, dialog } = useConfirm();

  // Debounce the search box.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Skip the fetch on the very first render — the server already rendered the
  // page the URL asks for, filters included — and fetch on every change after.
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    cmsApi
      .list<DocumentListItem>(collection.key, {
        page,
        pageSize,
        grouped: 1,
        status: status || undefined,
        search: debouncedSearch || undefined,
      })
      .then((res: ListResponse<DocumentListItem>) => {
        if (!active) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e) => {
        if (active) setError(e instanceof CmsApiError ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [collection.key, page, pageSize, status, debouncedSearch, refreshTick]);

  // Mirror the active filters into the URL (replace, not push — filtering is
  // not a navigation the back button should have to step through).
  useEffect(() => {
    const q = new URLSearchParams();
    if (debouncedSearch) q.set('q', debouncedSearch);
    if (status) q.set('status', status);
    if (page > 1) q.set('page', String(page));
    const qs = q.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
  }, [router, page, status, debouncedSearch]);

  // Someone else may have published or deleted something while this tab sat
  // open. Re-fetch when the operator comes back to it, rather than leaving them
  // acting on a list that silently went stale.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setRefreshTick((t) => t + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  async function remove(item: DocumentListItem) {
    const count = item.variants.length;
    const ok = await confirm({
      title: 'Delete this document?',
      message:
        count > 1
          ? `All ${count} language versions will be deleted. This cannot be undone.`
          : 'This cannot be undone.',
    });
    if (!ok) return;
    // The button stays disabled for the whole request: on a slow connection
    // there was previously no sign anything was happening, and the row could be
    // clicked again.
    setDeletingId(item.id);
    try {
      // Delete every locale variant of the group.
      await Promise.all(item.variants.map((v) => cmsApi.remove(collection.key, v.id)));
      setItems((list) => list.filter((i) => i.id !== item.id));
      setTotal((t) => Math.max(0, t - 1));
      router.refresh();
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          aria-label="Search slug or title"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search slug or title…"
          className="min-w-[220px] flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <select
          aria-label="Filter by status"
          className={selectClass}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {DOCUMENT_LIST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <InfoTip label="About the status filter">
          Shows documents where at least one language has this status. All their languages stay listed.
        </InfoTip>
        {loading ? <span className="text-xs text-neutral-600">Loading…</span> : null}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600">
          No documents match.
        </div>
      ) : (
        /*
          A scroll container, the same one every other admin table already uses.
          Four columns at 390px pushed the whole page sideways instead of the table,
          which takes the controls off screen with it.
        */
        <div
          tabIndex={0}
          role="group"
          aria-label="Documents, scrollable"
          className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
        >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-600">
              <th className="py-2 pr-4">Title / slug</th>
              <th className="py-2 pr-4">
                <span className="inline-flex items-center gap-1">
                  Languages
                  <InfoTip label="About the language chips">
                    One chip per language, coloured by its status: green published, amber scheduled, grey
                    draft, crossed out archived. A dashed chip means that language has no version yet.
                  </InfoTip>
                </span>
              </th>
              <th className="py-2 pr-4">Updated</th>
              <th className="relative py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const byLocale = new Map(item.variants.map((v) => [v.locale, v]));
              return (
                <tr key={item.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="py-2 pr-4">
                    <Link
                      href={adminHref(adminPath, `${collection.key}/${item.id}`)}
                      className="-my-1 inline-block py-1 font-medium text-neutral-900 hover:underline"
                    >
                      {item.title || item.metaTitle || item.slug}
                    </Link>
                    <div className="text-xs text-neutral-600">/{item.slug}</div>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {locales.map((l) => {
                        const v = byLocale.get(l);
                        return v ? (
                          <span
                            key={l}
                            title={v.status}
                            className={`rounded px-1.5 py-0.5 text-xs font-medium uppercase ${STATUS_COLORS[v.status] ?? 'bg-neutral-100'}`}
                          >
                            {l}
                          </span>
                        ) : (
                          <span
                            key={l}
                            title="missing"
                            className="rounded border border-dashed border-neutral-300 px-1.5 py-0.5 text-xs uppercase text-neutral-600"
                          >
                            {l}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-neutral-600">
                    {/* Locale-stable (ISO) to avoid an SSR/CSR hydration mismatch. */}
                    {new Date(item.updatedAt).toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 text-right">
                    {/*
                      Only for someone the server would let delete every language
                      of the group: the button deletes them all, so offering it to
                      a reader — or to a writer on a live document — ended in a
                      "forbidden" at best and a half-deleted group at worst.
                    */}
                    {canDeleteDocumentGroup(item.variants, { canWrite, canPublish }) ? (
                      <button
                        onClick={() => remove(item)}
                        disabled={deletingId === item.id}
                        className="rounded-sm px-2 py-1.5 text-xs text-red-700 hover:underline disabled:cursor-wait disabled:text-neutral-600 disabled:no-underline"
                      >
                        {deletingId === item.id ? 'Deleting…' : 'Delete'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-neutral-600">
        <span>{total} total</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded-md border border-neutral-300 px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {page} of {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount || loading}
            className="rounded-md border border-neutral-300 px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
      {dialog}
    </div>
  );
}
