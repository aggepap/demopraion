'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReviewStats, ReviewStatus } from '@/cms/modules/commerce';
import { cmsApi, CmsApiError, type ListResponse } from './api-client';
import { useHydrated } from './use-hydrated';
import { useConfirm } from './ui/ConfirmDialog';
import { Badge, Button, Icon, IconButton, Section, Table, Tbody, Td, Th, Thead, TextInput } from './ui';
import { cn } from './ui/cn';

/**
 * Product-review moderation queue. Reviews are submitted from the storefront as
 * `pending`; approving one publishes it (and lets it count toward the star
 * average + JSON-LD). Reads/writes go through the generic `cmsApi` against
 * `/api/cms/reviews`, guarded server-side by the `reviews*` permissions.
 */

/** Serialised review row (dates arrive as ISO strings over the wire). */
export interface ReviewRow {
  id: number;
  productSlug: string | null;
  authorName: string;
  email: string;
  rating: number;
  title: string | null;
  body: string;
  verified: boolean;
  status: ReviewStatus;
  locale: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<ReviewStatus, 'neutral' | 'green' | 'amber' | 'red'> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
};

const TABS: { key: ReviewStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

function Stars({ rating }: { rating: number }) {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="whitespace-nowrap text-warm-gold-deep" aria-label={`${n} / 5`}>
      {'★'.repeat(n)}
      <span className="text-neutral-600">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

export function ReviewsTable({
  initial,
  initialPageInfo,
  stats: initialStats,
}: {
  initial: ReviewRow[];
  /** The counts behind the server-rendered first page, so the pager is right immediately. */
  initialPageInfo?: { total: number; pageSize: number; pageCount: number };
  stats: ReviewStats;
}) {
  const [rows, setRows] = useState<ReviewRow[]>(initial);
  const [stats, setStats] = useState<ReviewStats>(initialStats);
  const [tab, setTab] = useState<ReviewStatus | 'all'>('pending');
  const [search, setSearch] = useState('');
  /*
   * The list is paginated and always was — on the server. `listReviews` returns
   * `total` and `pageCount`, the client asked for neither and rendered whatever the
   * default page size gave it, so the 26th pending review was counted in the badge and
   * unreachable in the table, with no control to suggest anything was missing. A
   * moderation queue that quietly stops at 25 is worse than one that says it has 200:
   * the reviews nobody can see are the ones nobody answers.
   */
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<{ total: number; pageSize: number; pageCount: number }>(
    initialPageInfo ?? { total: initial.length, pageSize: initial.length, pageCount: 1 },
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Until React has taken over, typing here is written to the DOM and then thrown
  // away by the first render — see `useHydrated`.
  const hydrated = useHydrated();
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async (status: ReviewStatus | 'all', q: string, p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const res = (await cmsApi.list('reviews', {
        status: status === 'all' ? undefined : status,
        search: q || undefined,
        page: p,
      })) as ListResponse<ReviewRow>;
      setRows(res.items);
      setPageInfo({ total: res.total, pageSize: res.pageSize, pageCount: res.pageCount });
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload when the status tab changes. The initial `pending` list is
  // server-rendered, so skip the mount-time run (a ref, not state, so this
  // doesn't itself trigger a render).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    // A different tab or page is a different list. Changing the tab resets the page,
    // because page 3 of "pending" is rarely page 3 of "approved" and landing on an
    // empty table reads as "there is nothing here".
    load(tab, search, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page]);

  async function refreshStats() {
    try {
      const res = await cmsApi.reviewStats();
      setStats(res.data);
    } catch {
      /* best-effort — the badges just go stale until the next load */
    }
  }

  async function setStatus(id: number, status: ReviewStatus) {
    setBusyId(id);
    setError(null);
    try {
      await cmsApi.update('reviews', id, { status });
      // Drop the row when it no longer matches the active tab; else update it.
      setRows((rs) =>
        tab !== 'all' && tab !== status
          ? rs.filter((r) => r.id !== id)
          : rs.map((r) => (r.id === id ? { ...r, status } : r)),
      );
      await refreshStats();
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: number) {
    const ok = await confirm({
      title: 'Delete this review?',
      message: 'It is removed permanently. This cannot be undone.',
    });
    if (!ok) return;
    setBusyId(id);
    setError(null);
    try {
      await cmsApi.remove('reviews', id);
      setRows((rs) => rs.filter((r) => r.id !== id));
      await refreshStats();
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Status filter tabs with counts */}
      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200">
        {TABS.map((t) => {
          const count = t.key === 'all' ? stats.total : stats[t.key];
          const isActive = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setPage(1);
                setTab(t.key);
              }}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-600 hover:text-neutral-800',
              )}
            >
              {t.label}
              <span className="rounded-sm bg-neutral-100 px-1.5 text-xs text-neutral-600">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <TextInput
          value={search}
          disabled={!hydrated}
          placeholder="Search author, email, text or product…"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            setPage(1);
            load(tab, search, 1);
          }}
          className="max-w-sm"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!hydrated}
          onClick={() => {
            setPage(1);
            load(tab, search, 1);
          }}
        >
          Search
        </Button>
        {loading ? <span className="text-xs text-neutral-600">Loading…</span> : null}
      </div>

      {error ? (
        <div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <Section title="Reviews" collapsible={false} right={<span className="text-xs text-neutral-600">{rows.length}</span>}>
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-600">No reviews in this view.</p>
        ) : (
          <Table>
            <Thead>
              <Th>Product</Th>
              <Th>Rating</Th>
              <Th>Review</Th>
              <Th info="“Verified” means the reviewer gave the reference of an order for this product together with the email that placed it. Reviews without one still publish, without the badge.">
                Author
              </Th>
              <Th info="Pending reviews wait for you. Only approved reviews appear on the product page.">Status</Th>
              <Th info="Approve publishes the review on the product page and counts it in the star rating. Reject hides it. Neither emails the reviewer; you can change your mind later.">
                Actions
              </Th>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 align-top">
                  <Td className="whitespace-nowrap text-sm text-neutral-700">
                    {r.productSlug ? (
                      <a
                        href={`/shop/${r.productSlug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-warm-gold-deep"
                      >
                        {r.productSlug}
                      </a>
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                    <div className="text-xs text-neutral-600">{new Date(r.createdAt).toLocaleDateString()}</div>
                  </Td>
                  <Td>
                    <Stars rating={r.rating} />
                  </Td>
                  <Td className="max-w-md text-sm text-neutral-700">
                    {r.title ? <div className="font-medium text-neutral-900">{r.title}</div> : null}
                    <p className="line-clamp-3 whitespace-pre-wrap">{r.body}</p>
                  </Td>
                  <Td className="whitespace-nowrap text-sm text-neutral-700">
                    <div className="flex items-center gap-1.5">
                      {r.authorName}
                      {r.verified ? <Badge tone="green">Verified</Badge> : null}
                    </div>
                    <div className="text-xs text-neutral-600">{r.email}</div>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      {r.status !== 'approved' ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busyId === r.id}
                          onClick={() => setStatus(r.id, 'approved')}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {r.status !== 'rejected' ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busyId === r.id}
                          onClick={() => setStatus(r.id, 'rejected')}
                        >
                          Reject
                        </Button>
                      ) : null}
                      <IconButton
                        onClick={() => remove(r.id)}
                        disabled={busyId === r.id}
                        aria-label="Delete review"
                        className="hover:text-red-700"
                      >
                        <Icon name="trash" size={14} />
                      </IconButton>
                    </div>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Section>

      {pageInfo.total > pageInfo.pageSize ? (
        /*
          A labelled landmark, not a bare row of buttons: "Prev"/"Next" on their own say
          nothing about what they page through, and this screen has other controls a
          screen reader reaches in the same sweep.
        */
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between text-sm text-neutral-600"
        >
          <span>
            {pageInfo.total} total · page {page}/{Math.max(1, pageInfo.pageCount)}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= Math.max(1, pageInfo.pageCount) || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </nav>
      ) : null}
      {dialog}
    </div>
  );
}
