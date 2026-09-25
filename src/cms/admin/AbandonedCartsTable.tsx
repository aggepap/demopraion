'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AbandonedStatus } from '@/cms/modules/commerce';
import { cmsApi, CmsApiError, type ListResponse } from './api-client';
import { Badge, Button, InfoTip, Section, Table, Tbody, Td, Th, Thead } from './ui';
import { useConfirm } from './ui/ConfirmDialog';
import { cn } from './ui/cn';

/**
 * Abandoned-cart list + reminder trigger (addendum §9). Reads via the generic
 * `cmsApi.list('abandoned-carts')`; "Send reminders" runs the same job an
 * external cron would (both guarded by `ordersWrite` / the cron secret).
 */

export interface AbandonedRow {
  id: number;
  email: string;
  itemCount: number;
  subtotal: number;
  currency: string;
  status: AbandonedStatus;
  locale: string | null;
  reminderSentAt: string | null;
  recoveredAt: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<AbandonedStatus, 'amber' | 'blue' | 'green'> = {
  pending: 'amber',
  reminded: 'blue',
  converted: 'green',
};

const TABS: { key: AbandonedStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'reminded', label: 'Reminded' },
  { key: 'converted', label: 'Converted' },
];

const money = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat('el-GR', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

export function AbandonedCartsTable({
  initial,
  initialPageInfo,
}: {
  initial: AbandonedRow[];
  /** The counts behind the server-rendered first page, so the pager is right immediately. */
  initialPageInfo?: { total: number; pageSize: number; pageCount: number };
}) {
  const [rows, setRows] = useState<AbandonedRow[]>(initial);
  const [tab, setTab] = useState<AbandonedStatus | 'all'>('pending');
  const [loading, setLoading] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  /*
   * Same gap as the reviews queue, and worse here: this screen has no search box to
   * narrow a list with, only status tabs. `listAbandoned` returns `total`, the client
   * asked for no page and rendered whatever the default gave it, so the 26th pending
   * cart was counted and unreachable — and an unreachable abandoned cart is a customer
   * who is never followed up.
   */
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<{ total: number; pageSize: number; pageCount: number }>(
    initialPageInfo ?? { total: initial.length, pageSize: initial.length, pageCount: 1 },
  );

  const load = useCallback(async (status: AbandonedStatus | 'all', p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const res = (await cmsApi.list('abandoned-carts', {
        status: status === 'all' ? undefined : status,
        page: p,
      })) as ListResponse<AbandonedRow>;
      setRows(res.items);
      setPageInfo({ total: res.total, pageSize: res.pageSize, pageCount: res.pageCount });
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload on tab change; skip the mount run (initial `pending` is server-rendered).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    load(tab, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page]);

  async function sendReminders() {
    setReminding(true);
    setNotice(null);
    setError(null);
    try {
      const res = await cmsApi.remindAbandoned();
      // The job can decline to send for two reasons that are not failures, and a
      // bare "Sent 0 reminder(s)" makes both look like a broken button.
      const { sent, skippedSuppressed, cappedBy } = res.data;
      const because = [
        skippedSuppressed > 0 ? `${skippedSuppressed} unsubscribed` : null,
        cappedBy > 0 ? `${cappedBy} held back by today's sending limit` : null,
      ].filter(Boolean);
      setNotice(
        `Sent ${sent} reminder(s).${because.length ? ` Skipped: ${because.join('; ')}.` : ''}`,
      );
      await load(tab);
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Send failed');
    } finally {
      setReminding(false);
    }
  }

  /**
   * Removing a captured cart, which nothing could do until now.
   *
   * The table is a record of people who entered an email at checkout and did not
   * buy, and it only ever grew: unsubscribing stops the reminder but leaves the
   * row, so honouring "delete what you hold about me" meant a hand-written SQL
   * statement. The reload afterwards is `load(tab, page)` rather than a local
   * splice, because deleting the last row of a page has to move the pager too.
   */
  function removeCart(r: AbandonedRow) {
    void (async () => {
      const ok = await confirm({
        title: 'Delete this captured cart?',
        message: `${r.email}'s cart is removed permanently, along with the recovery link already emailed to them. This cannot be undone.`,
        confirmLabel: 'Delete cart',
      });
      if (!ok) return;
      setError(null);
      setNotice(null);
      setDeletingId(r.id);
      try {
        await cmsApi.deleteAbandonedCart(r.id);
        await load(tab, page);
      } catch (err) {
        setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Delete failed');
      } finally {
        setDeletingId(null);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                t.key === tab
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-600 hover:text-neutral-800',
              )}
            >
              {t.label}
            </button>
          ))}
          {loading ? <span className="ml-2 text-xs text-neutral-600">Loading…</span> : null}
        </div>
        {/*
          Named for what it does, which is not what its position suggested.
          It sits beside the status tabs and fires the same "remind everything due" job
          whichever tab is open — so on Converted it read as an action about the carts on
          screen, and is not one.
        */}
        <span className="flex items-center gap-1.5">
          <Button type="button" variant="secondary" size="sm" onClick={sendReminders} disabled={reminding}>
            {reminding ? 'Sending…' : 'Send all due reminders'}
          </Button>
          <InfoTip label="Which carts are due">
            A cart is due when it is still pending, was captured more than an hour ago (the default delay) and has not
            been reminded yet. Each cart gets one reminder, whichever tab is open; unsubscribed addresses are skipped
            and a daily sending limit applies.
          </InfoTip>
        </span>
      </div>
      <p className="text-xs text-neutral-600">Sending emails every due customer a link back to their cart.</p>

      {notice ? (
        <div className="rounded-sm border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>
      ) : null}
      {error ? (
        <div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <Section title="Abandoned carts" collapsible={false} right={<span className="text-xs text-neutral-600">{rows.length}</span>}>
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-600">No carts in this view.</p>
        ) : (
          <Table>
            <Thead>
              <Th>Email</Th>
              <Th>Items</Th>
              <Th>Value</Th>
              <Th info="Pending: not bought yet. Reminded: the reminder email has gone out. Converted: an order was placed with the same email, so no reminder is sent. “opened” means the customer clicked the link back to their cart.">
                Status
              </Th>
              <Th info="When the customer typed their email at checkout and the cart was saved.">Captured</Th>
              <Th info="When the one reminder email was sent. Empty until it goes out.">Reminded</Th>
              {/* Named for assistive technology only — the column holds one button per row. */}
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <Td className="text-sm text-neutral-800">{r.email}</Td>
                  <Td className="text-sm text-neutral-600">{r.itemCount}</Td>
                  <Td className="whitespace-nowrap text-sm text-neutral-800">{money(r.subtotal, r.currency)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    {r.recoveredAt ? <span className="ml-2 text-xs text-green-600">opened</span> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-neutral-600">
                    {new Date(r.createdAt).toLocaleString()}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-neutral-600">
                    {r.reminderSentAt ? new Date(r.reminderSentAt).toLocaleString() : '—'}
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={deletingId === r.id}
                      onClick={() => removeCart(r)}
                    >
                      {deletingId === r.id ? 'Deleting…' : 'Delete'}
                      {/* Which row — the visible word is the same on every one of them. */}
                      <span className="sr-only"> {r.email}</span>
                    </Button>
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
