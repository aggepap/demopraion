'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SubscriberView } from '@/cms/modules/newsletter/logic';
import { cmsApi, CmsApiError, type ListResponse } from './api-client';
import { useHydrated } from './use-hydrated';
import { useConfirm } from './ui/ConfirmDialog';
import { Badge, Button, Icon, IconButton, Section, Table, Tbody, Td, Th, Thead, TextInput } from './ui';
import { cn } from './ui/cn';

/**
 * The newsletter list.
 *
 * Two different acts, deliberately not one button. Unsubscribing keeps the row
 * — the timestamp is the record that this person asked to be left alone, and a
 * deleted subscriber is one the next form submission silently re-adds with
 * nothing to say they had ever objected. Delete is the erasure request, and it
 * takes the consent record with it, so it asks first.
 *
 * Reads and writes go through the generic `cmsApi` against `/api/cms/newsletter`,
 * guarded server-side by the `newsletter*` permissions and the module flag.
 */

export interface SubscriberCounts {
  all: number;
  active: number;
  unsubscribed: number;
}

type Tab = 'all' | 'active' | 'unsubscribed';

const TABS: { key: Tab; label: string }[] = [
  { key: 'active', label: 'Subscribed' },
  { key: 'unsubscribed', label: 'Unsubscribed' },
  { key: 'all', label: 'All' },
];

/** The date alone; the time a signup landed is never the question here. */
const day = (iso: string) => iso.slice(0, 10);

export function SubscribersTable({
  initial,
  initialPageInfo,
  counts: initialCounts,
  canWrite,
}: {
  initial: SubscriberView[];
  initialPageInfo?: { total: number; pageSize: number; pageCount: number };
  counts: SubscriberCounts;
  /** `newsletterWrite`. Without it the rows are read-only — the server enforces
   *  this too; hiding the buttons only stops someone reaching for one. */
  canWrite: boolean;
}) {
  const [rows, setRows] = useState<SubscriberView[]>(initial);
  const [counts, setCounts] = useState<SubscriberCounts>(initialCounts);
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<{ total: number; pageSize: number; pageCount: number }>(
    initialPageInfo ?? { total: initial.length, pageSize: initial.length || 25, pageCount: 1 },
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Until React has taken over, typing here is written to the DOM and then
  // thrown away by the first render — see `useHydrated`.
  const hydrated = useHydrated();
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async (status: Tab, q: string, p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const res = (await cmsApi.list('newsletter', {
        status,
        search: q || undefined,
        page: p,
      })) as ListResponse<SubscriberView> & { counts?: SubscriberCounts };
      setRows(res.items);
      setPageInfo({ total: res.total, pageSize: res.pageSize, pageCount: res.pageCount });
      if (res.counts) setCounts(res.counts);
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // The `active` first page is server-rendered, so skip the mount-time run.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    load(tab, search, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page]);

  async function setSubscribed(id: number, subscribed: boolean) {
    setBusyId(id);
    setError(null);
    try {
      const res = await cmsApi.update<SubscriberView>('newsletter', id, { subscribed });
      const updated = res.data;
      // Drop the row when it no longer belongs in this tab; otherwise update it.
      setRows((rs) =>
        tab !== 'all' && tab !== updated.status
          ? rs.filter((r) => r.id !== id)
          : rs.map((r) => (r.id === id ? updated : r)),
      );
      setCounts((c) => {
        const delta = subscribed ? 1 : -1;
        return { ...c, active: c.active + delta, unsubscribed: c.unsubscribed - delta };
      });
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: SubscriberView) {
    const ok = await confirm({
      title: `Delete ${row.email}?`,
      message:
        'The address and the consent record behind it are removed permanently. To stop emailing someone while keeping the record that they asked, unsubscribe them instead.',
    });
    if (!ok) return;
    setBusyId(row.id);
    setError(null);
    try {
      await cmsApi.remove('newsletter', row.id);
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      setCounts((c) => ({
        all: c.all - 1,
        active: c.active - (row.status === 'active' ? 1 : 0),
        unsubscribed: c.unsubscribed - (row.status === 'unsubscribed' ? 1 : 0),
      }));
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setPage(1);
              setTab(t.key);
            }}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              t.key === tab
                ? 'border-neutral-900 text-neutral-900'
                : 'border-transparent text-neutral-600 hover:text-neutral-800',
            )}
          >
            {t.label}
            <span className="rounded-sm bg-neutral-100 px-1.5 text-xs text-neutral-600">
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <TextInput
          value={search}
          disabled={!hydrated}
          placeholder="Search address or placement…"
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
        <div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Section
        title="Subscribers"
        collapsible={false}
        right={<span className="text-xs text-neutral-600">{pageInfo.total}</span>}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-600">
            {tab === 'active'
              ? 'Nobody has subscribed yet. The footer band and the article sidebar cards feed this list.'
              : 'Nothing in this view.'}
          </p>
        ) : (
          <Table>
            <Thead>
              {/* `Thead` renders the `<thead>` only — the row is the caller's,
                  and a `<th>` directly inside `<thead>` is invalid HTML that
                  fails hydration. */}
              <tr>
                <Th>Email</Th>
                <Th>Status</Th>
                <Th info="Where on the site the person signed up: footer, sidebar, or article:<slug> for one article.">
                  Placement
                </Th>
                <Th>Language</Th>
                <Th info="The day they signed up. Hover the date to see the consent wording they agreed to.">
                  Subscribed
                </Th>
                <Th
                  className="text-right"
                  info="Unsubscribe stops the emails but keeps the address with the date they left, as the record that they asked. Delete erases the address and that record for good, and a later signup would add them again as new."
                >
                  Actions
                </Th>
              </tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-50">
                  <Td>
                    <a href={`mailto:${r.email}`} className="text-warm-gold-deep hover:underline">
                      {r.email}
                    </a>
                  </Td>
                  <Td>
                    {r.status === 'active' ? (
                      <Badge tone="green">Subscribed</Badge>
                    ) : (
                      <Badge tone="neutral" title={`Unsubscribed ${day(r.unsubscribedAt ?? '')}`}>
                        Unsubscribed
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-neutral-600">{r.source ?? '—'}</Td>
                  <Td className="uppercase text-neutral-600">{r.locale}</Td>
                  {/* The consent record, in the cell that shows when it was given —
                      the two answer one question together. */}
                  <Td className="whitespace-nowrap text-neutral-600" title={r.consentText}>
                    {day(r.subscribedAt)}
                  </Td>
                  <Td className="text-right">
                    {canWrite ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busyId === r.id}
                          onClick={() => setSubscribed(r.id, r.status !== 'active')}
                        >
                          {r.status === 'active' ? 'Unsubscribe' : 'Resubscribe'}
                        </Button>
                        <IconButton
                          type="button"
                          disabled={busyId === r.id}
                          aria-label={`Delete ${r.email}`}
                          onClick={() => remove(r)}
                        >
                          <Icon name="trash" size={16} />
                        </IconButton>
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-600">Read-only</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Section>

      {pageInfo.pageCount > 1 ? (
        <div className="flex items-center justify-between text-sm text-neutral-600">
          <span>
            {pageInfo.total} total · page {page}/{pageInfo.pageCount}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page >= pageInfo.pageCount || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {dialog}
    </div>
  );
}
