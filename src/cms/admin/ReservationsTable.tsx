'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { ReservationStatus } from '../db/adapters/mysql/schema/booking';
import { canTransition } from '../modules/booking/lifecycle';
import { ATTENTION_MESSAGES, readAttention } from '../modules/booking/payment-actions';
import { reservationFiltersQuery, type ReservationFilters } from '../modules/booking/reservation-filters';
import { cmsApi, CmsApiError } from './api-client';
import { EditLockBanner } from './locks/EditLockBanner';
import { useEditLock } from './locks/use-edit-lock';
import { apiErrorText } from './api-error-text';
import { formatMoney, ReservationPaymentsPanel, type ReservationPaymentRow } from './ReservationPayments';
import { Badge, Button, InfoTip, Table, Tbody, Td, Th, Thead } from './ui';
import { useConfirm } from './ui/ConfirmDialog';
import { Drawer } from './ui/Drawer';

export interface ReservationRow {
  id: number;
  reference: string;
  status: string;
  mode: string;
  bookingTitle: string;
  bookingSlug: string | null;
  slotDate: string;
  /** Check-out, for a stay. Null for transport. */
  endDate: string | null;
  /** Nights occupied. 0 for transport. */
  nights: number;
  slotLabel: string | null;
  persons: number;
  adults: number;
  children: number;
  resourceLabel: string | null;
  customerName: string | null;
  email: string;
  phone: string | null;
  notes: string | null;
  currency: string;
  total: number;
  amountPaid: number;
  emailStatus: string;
  emailError: string | null;
  paymentLinkSentAt: string | null;
  /** The payment deadline while awaiting payment; a pending request's lapse time. */
  expiresAt: string | null;
  /** Carries `attention` when a payment arrived that could not be applied. */
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

interface DetailPayload {
  reservation: ReservationRow;
  items: { id: number; label: string; quantity: number; unitAmount: number; amount: number }[];
  events: { id: number; kind: string; emailStatus: string | null; emailError: string | null; createdAt: string }[];
  competing: { id: number; reference: string; customerName: string | null; persons: number; status: string }[];
  drift: { quoted: number; current: number; changed: boolean } | null;
  payments: ReservationPaymentRow[];
  /** The site's payment method (Settings → Booking). */
  payment: { online: boolean; label: string; linkTtlDays: number };
}

const STATUS_TONE: Record<string, 'neutral' | 'gold' | 'green' | 'blue' | 'amber' | 'red'> = {
  pending: 'amber',
  awaiting_payment: 'blue',
  confirmed: 'gold',
  paid: 'green',
  cancelled: 'neutral',
  expired: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting your reply',
  awaiting_payment: 'Awaiting payment',
  confirmed: 'Confirmed',
  paid: 'Paid',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** What each status means for the date and for the customer — behind the Status column's "i". */
const STATUS_HELP =
  'Awaiting your reply: a request; the date is not held yet. Awaiting payment: accepted or booked instantly; the date is held until the payment deadline, then the booking expires. Confirmed: the deposit is in, or it was confirmed to be paid later. Paid: paid in full. Cancelled and Expired: the date is released.';

const money = formatMoney;

const inputClass = 'rounded-sm border border-neutral-300 px-2.5 py-1.5 text-sm';

/**
 * The list's filters. Every change goes to the URL — the page re-renders on the
 * server with the new query, which is what makes the filtering and the paging
 * cover every booking rather than only the ones already in the browser.
 */
export function ReservationFilterBar({
  filters,
  experiences,
  onChange,
}: {
  filters: ReservationFilters;
  experiences: { id: string; title: string }[];
  onChange: (next: ReservationFilters) => void;
}) {
  const [search, setSearch] = useState(filters.search);
  // Any filter change starts again from page 1: page 4 of the old result says
  // nothing about the new one.
  const change = (patch: Partial<ReservationFilters>) => onChange({ ...filters, ...patch, page: 1 });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={filters.needsAction}
        onClick={() => change({ needsAction: !filters.needsAction })}
        className={`rounded-sm px-3 py-1.5 text-sm font-medium ${
          filters.needsAction ? 'bg-warm-gold text-midnight-navy' : 'border border-neutral-300 bg-white text-neutral-700'
        }`}
      >
        Needs action
      </button>
      <InfoTip label="About Needs action">
        Shows booking requests awaiting your reply, and bookings where a payment arrived but could not be applied
        (the hold had lapsed or the date was full) — refund those, or rebook the customer.
      </InfoTip>

      <select
        aria-label="Status"
        value={filters.status}
        onChange={(e) => change({ status: e.target.value as ReservationFilters['status'] })}
        className={inputClass}
      >
        <option value="">All statuses</option>
        {Object.entries(STATUS_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <select
        aria-label="Experience"
        value={filters.experience}
        onChange={(e) => change({ experience: e.target.value })}
        className={`${inputClass} max-w-56`}
      >
        <option value="">All experiences</option>
        {experiences.map((x) => (
          <option key={x.id} value={x.id}>
            {x.title}
          </option>
        ))}
      </select>

      <span className="flex items-center gap-1 text-sm text-neutral-600">
        <input
          type="date"
          aria-label="From date"
          value={filters.from}
          max={filters.to || undefined}
          onChange={(e) => change({ from: e.target.value })}
          className={inputClass}
        />
        <span aria-hidden="true">–</span>
        <input
          type="date"
          aria-label="To date"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(e) => change({ to: e.target.value })}
          className={inputClass}
        />
        <InfoTip label="About the date range">
          Filters on the booking date — the check-in date for a stay — not the day the booking was made. Both dates are
          included.
        </InfoTip>
      </span>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          change({ search: search.trim() });
        }}
      >
        <input
          type="search"
          aria-label="Search bookings"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Reference, name or email"
          className={`${inputClass} w-64`}
        />
      </form>
    </div>
  );
}

/** Prev / Next under the list. Nothing when everything fits on one page. */
export function ReservationPager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1 && page <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between text-sm text-neutral-600">
      <span>
        {total} {total === 1 ? 'booking' : 'bookings'} · Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </nav>
  );
}

/**
 * Reservations.
 *
 * The status UX deliberately diverges from `OrdersTable`. A row of equal-weight
 * pills suits orders, where fulfilment order is loose; this is a linear
 * workflow, and at any moment exactly one next step is correct. So the drawer
 * leads with a single derived action and keeps the rest as an escape hatch.
 */
export function ReservationsTable({
  initial,
  filters,
  experiences,
  canWrite,
}: {
  initial: { items: ReservationRow[]; total: number; page: number; pageSize: number };
  filters: ReservationFilters;
  experiences: { id: string; title: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNavigation] = useTransition();
  const { confirm, dialog } = useConfirm();

  /*
   * Read straight from the prop, not frozen into state.
   *
   * This was `useState(initial.items)`, which reads its argument only on the
   * first render — and nothing ever set it (there was no setter). So when
   * `move()` called `router.refresh()` and the server component re-rendered with
   * fresh rows, the table could not see them: the header count updated, the
   * drawer updated because it refetches, and the row an operator had just acted
   * on still read "Awaiting your reply" until a full page reload. That invites
   * the same action twice on a booking that has already moved.
   */
  const rows = initial.items;
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Filters and the page live in the URL, and the server does the filtering.
   * `replace`, not `push`: narrowing a filter is not a step anyone wants "back"
   * to undo one at a time — the Submissions screen's rule.
   */
  function navigate(next: ReservationFilters) {
    const qs = reservationFiltersQuery(next);
    startNavigation(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  /*
   * A reservation drawer only changes status, but two admins racing to accept
   * or reject the same booking is exactly the collision worth preventing.
   */
  const lock = useEditLock({
    type: 'reservation',
    key: openId !== null ? String(openId) : '',
    enabled: canWrite && openId !== null,
  });

  async function open(id: number) {
    setOpenId(id);
    setDetail(null);
    setError(null);
    try {
      const res = await cmsApi.get<DetailPayload>('reservations', id);
      setDetail(res.data);
    } catch (err) {
      setError(apiErrorText(err, 'Could not load that booking.'));
    }
  }

  /** Run one drawer action, then reload the drawer and the list behind it. */
  async function act(id: number, run: () => Promise<unknown>, refused: string) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await open(id);
      // The server-rendered list and summary would otherwise go stale.
      router.refresh();
    } catch (err) {
      // Shown inside the drawer, where the action was taken.
      setError(apiErrorText(err, err instanceof CmsApiError ? err.message : refused));
    } finally {
      setBusy(false);
    }
  }

  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

  function acceptMessage(d: DetailPayload): string {
    return d.payment.online
      ? `The date is taken and the customer is emailed a ${d.payment.label} payment link. They have ${days(d.payment.linkTtlDays)} to pay before the booking expires and the date is released.`
      : `The date is taken and the customer is emailed your payment instructions (Settings → Booking). They have ${days(d.payment.linkTtlDays)} to pay before the booking expires — record the payment here when it arrives.`;
  }

  async function move(id: number, to: string, label: string) {
    const ok = await confirm({
      title: label,
      message:
        to === 'paid'
          ? `This records the outstanding balance${detail ? ` (${money(Math.max(0, detail.reservation.total - detail.reservation.amountPaid), detail.reservation.currency)})` : ''} as a manual payment and emails the customer a receipt. It does not move any money.`
          : to === 'cancelled'
            ? 'The date is released and the customer is emailed. No money is refunded — use Refund under Payments for that.'
            : to === 'awaiting_payment' && detail
              ? acceptMessage(detail)
              : 'The customer is emailed and the date is taken.',
      confirmLabel: label,
      destructive: to === 'cancelled',
    });
    if (!ok) return;
    await act(id, () => cmsApi.update('reservations', id, { status: to }), 'That change was refused.');
  }

  async function resolveAttention(d: DetailPayload) {
    const ok = await confirm({
      title: 'Mark resolved',
      message:
        'The booking leaves Needs action. Nothing is refunded and the customer is not emailed — use this only once you have dealt with the payment another way.',
      confirmLabel: 'Mark resolved',
      destructive: false,
    });
    if (!ok) return;
    const id = d.reservation.id;
    await act(id, () => cmsApi.update('reservations', id, { resolveAttention: true }), 'That change was refused.');
  }

  async function resendLink(d: DetailPayload) {
    const ok = await confirm({
      title: 'Resend payment link',
      message: `The customer is emailed a new payment link, valid for ${days(d.payment.linkTtlDays)}. The previous link stops working.`,
      confirmLabel: 'Resend link',
      destructive: false,
    });
    if (!ok) return;
    const id = d.reservation.id;
    await act(id, () => cmsApi.sendReservationPaymentLink(id), 'The link could not be sent.');
  }

  async function recordPayment(d: DetailPayload, amount: number) {
    const ok = await confirm({
      title: 'Record payment',
      message: `Record ${money(amount, d.reservation.currency)} as received? This does not charge the customer — it notes money that already reached you. If it covers the deposit the booking becomes Confirmed; if it covers the total it becomes Paid.`,
      confirmLabel: 'Record payment',
      destructive: false,
    });
    if (!ok) return;
    const id = d.reservation.id;
    await act(id, () => cmsApi.recordReservationPayment(id, amount), 'The payment could not be recorded.');
  }

  async function refund(d: DetailPayload, paymentId: number, amount: number | undefined) {
    const payment = d.payments.find((p) => p.id === paymentId);
    if (!payment) return;
    const figure = money(amount ?? payment.refundable, d.reservation.currency);
    const ok = await confirm({
      title: 'Refund payment',
      message: `${figure} will be returned to the customer through ${payment.provider}. This cannot be undone. The booking's status does not change — cancel it separately if the booking is off.`,
      confirmLabel: `Refund ${figure}`,
      destructive: true,
    });
    if (!ok) return;
    const id = d.reservation.id;
    await act(id, () => cmsApi.refundReservationPayment(id, paymentId, amount), 'The refund was refused.');
  }

  /** The one action that is right for this status. */
  function nextAction(r: ReservationRow): { to: string; label: string } | null {
    switch (r.status) {
      case 'pending':
        return {
          to: 'awaiting_payment',
          label: detail?.payment.online === false ? 'Accept & send payment instructions' : 'Accept & send payment link',
        };
      case 'awaiting_payment':
        return { to: 'paid', label: 'Mark paid' };
      case 'confirmed':
        return { to: 'paid', label: 'Mark paid' };
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ReservationFilterBar filters={filters} experiences={experiences} onChange={navigate} />

      {!canWrite ? (
        <p className="rounded-sm border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
          You have read-only access to bookings.
        </p>
      ) : null}

      <div aria-busy={navigating} className={navigating ? 'opacity-60 transition-opacity' : undefined}>
        <Table>
        <Thead>
          <tr>
            <Th info="“instant” marks a booking the customer made and was asked to pay for straight away, without waiting for you to accept it.">
              Reference
            </Th>
            <Th>Experience</Th>
            <Th info="The booked date — check-in to check-out for a stay — not the day the booking was made.">Date</Th>
            <Th>Party</Th>
            <Th>Customer</Th>
            <Th className="text-right">Total</Th>
            <Th
              info={
                <>
                  {STATUS_HELP} “not sent” means the last email to the customer failed — open the booking to see why.
                </>
              }
            >
              Status
            </Th>
            <Th />
          </tr>
        </Thead>
        <Tbody>
          {rows.length === 0 ? (
            <tr>
              <Td colSpan={8} className="py-8 text-center text-neutral-500">
                No bookings match these filters.
              </Td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="hover:bg-neutral-50">
                <Td className="font-mono text-xs">
                  {r.reference}
                  {r.mode === 'instant' ? (
                    <Badge tone="blue" className="ml-1.5">
                      instant
                    </Badge>
                  ) : null}
                </Td>
                <Td>{r.bookingTitle}</Td>
                {/* The booking date, not the request date — this is the column people scan. */}
                <Td className="whitespace-nowrap">
                  {/* A stay is a range. Showing only its check-in would make a
                      one-night booking and a fortnight look identical. */}
                  {r.nights > 0 && r.endDate ? `${r.slotDate} → ${r.endDate}` : r.slotDate}
                  {r.nights > 0 ? (
                    <span className="ml-1 text-neutral-500">
                      {r.nights} {r.nights === 1 ? 'night' : 'nights'}
                    </span>
                  ) : null}
                  {r.slotLabel ? <span className="ml-1 text-neutral-500">{r.slotLabel}</span> : null}
                </Td>
                <Td>{r.persons}</Td>
                <Td title={r.email}>{r.customerName ?? r.email}</Td>
                <Td className="text-right">{money(r.total, r.currency)}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  {r.emailStatus === 'failed' ? (
                    <Badge tone="red" className="ml-1" title={r.emailError ?? undefined}>
                      not sent
                    </Badge>
                  ) : null}
                  {readAttention(r.metadata) ? (
                    <Badge tone="red" className="ml-1">
                      payment to resolve
                    </Badge>
                  ) : null}
                </Td>
                <Td>
                  <Button variant="ghost" size="sm" onClick={() => open(r.id)}>
                    View
                  </Button>
                </Td>
              </tr>
            ))
          )}
        </Tbody>
        </Table>
      </div>

      <ReservationPager
        page={initial.page}
        pageSize={initial.pageSize}
        total={initial.total}
        onPage={(page) => navigate({ ...filters, page })}
      />

      {openId !== null ? (
        <Drawer title={detail?.reservation.reference ?? 'Booking'} onClose={() => setOpenId(null)}>
          {error ? (
            <p role="alert" className="mb-3 rounded-sm border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {!detail ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : (
            <div className="flex flex-col gap-5 text-sm">
              <EditLockBanner lock={lock} />

              {/* ── Money that arrived and could not be applied ── */}
              {(() => {
                const attention = readAttention(detail.reservation.metadata);
                if (!attention) return null;
                return (
                  <div role="alert" className="rounded-sm border border-red-200 bg-red-50 p-3 text-red-900">
                    <p className="font-medium">
                      Payment not applied — {money(attention.amount, detail.reservation.currency)} via{' '}
                      {attention.provider}
                    </p>
                    <p className="mt-1 text-xs">{ATTENTION_MESSAGES[attention.reason] ?? ATTENTION_MESSAGES.hold_lapsed}</p>
                    {canWrite && !lock.readOnly ? (
                      <div className="mt-2 flex items-center gap-1">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resolveAttention(detail)}>
                          Mark resolved
                        </Button>
                        <InfoTip label="About Mark resolved">
                          For when you have dealt with it another way, e.g. rebooked the customer. A refund under
                          Payments clears this by itself.
                        </InfoTip>
                      </div>
                    ) : null}
                  </div>
                );
              })()}

              {/* ── The one next step ── */}
              {canWrite && !lock.readOnly && nextAction(detail.reservation) ? (
                <div className="rounded-sm border border-warm-gold/40 bg-warm-gold/10 p-4">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      const action = nextAction(detail.reservation);
                      if (action) void move(detail.reservation.id, action.to, action.label);
                    }}
                  >
                    {nextAction(detail.reservation)?.label}
                  </Button>
                  {nextAction(detail.reservation)?.to === 'paid' ? (
                    <p className="mt-2 flex items-center gap-1 text-xs text-neutral-600">
                      Emails the customer a receipt. It does not charge them.
                      <InfoTip label="About Mark paid">
                        For a booking whose remaining balance reached you outside the website, e.g. by bank transfer
                        or cash. The balance is recorded under Payments as a manual payment. To record part of a
                        payment, use Record payment instead.
                      </InfoTip>
                    </p>
                  ) : null}
                  {detail.reservation.status === 'pending' ? (
                    <p className="mt-2 text-xs text-neutral-600">
                      Accepting claims the date and asks the customer to pay —{' '}
                      {detail.payment.online
                        ? 'they are emailed a payment link.'
                        : 'they are emailed your payment instructions.'}{' '}
                      If someone else has already taken the date, this is refused.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* ── Competing enquiries: the normal case in request mode ── */}
              {detail.competing.length > 0 ? (
                <div className="rounded-sm border border-amber-200 bg-amber-50 p-3">
                  <p className="font-medium text-amber-900">
                    {detail.competing.length} other {detail.competing.length === 1 ? 'request' : 'requests'} for this
                    date
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-amber-900">
                    {detail.competing.map((c) => (
                      <li key={c.id}>
                        <span className="font-mono">{c.reference}</span> — {c.customerName ?? '—'} · {c.persons} pax ·{' '}
                        {STATUS_LABEL[c.status] ?? c.status}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* ── The frozen price, and whether it still holds ── */}
              <section>
                <h3 className="mb-1 font-medium">Price</h3>
                <ul className="flex flex-col gap-0.5">
                  {detail.items.map((i) => (
                    <li key={i.id} className="flex justify-between gap-4">
                      <span>
                        {i.label}
                        {i.quantity > 1 && i.unitAmount > 0
                          ? ` × ${money(i.unitAmount, detail.reservation.currency)}`
                          : ''}
                      </span>
                      <span>{money(i.amount, detail.reservation.currency)}</span>
                    </li>
                  ))}
                  <li className="mt-1 flex justify-between gap-4 border-t border-neutral-200 pt-1 font-semibold">
                    <span>Total</span>
                    <span>{money(detail.reservation.total, detail.reservation.currency)}</span>
                  </li>
                </ul>
                {detail.drift?.changed ? (
                  <p className="mt-2 rounded-sm border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                    The pricing for this experience changed after this booking was quoted. The customer was quoted{' '}
                    {money(detail.drift.quoted, detail.reservation.currency)}; today&apos;s rules give{' '}
                    {money(detail.drift.current, detail.reservation.currency)}.
                  </p>
                ) : null}
              </section>

              <section>
                <h3 className="mb-1 font-medium">Booking</h3>
                <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
                  <dt className="text-neutral-500">Experience</dt>
                  <dd>{detail.reservation.bookingTitle}</dd>
                  <dt className="text-neutral-500">
                    {detail.reservation.nights > 0 ? 'Stay' : 'Date'}
                  </dt>
                  <dd>
                    {detail.reservation.nights > 0 && detail.reservation.endDate
                      ? `${detail.reservation.slotDate} → ${detail.reservation.endDate} · ${detail.reservation.nights} ${detail.reservation.nights === 1 ? 'night' : 'nights'}`
                      : detail.reservation.slotDate}
                  </dd>
                  <dt className="text-neutral-500">Party</dt>
                  <dd>
                    {detail.reservation.nights > 0
                      ? `${detail.reservation.adults} adult(s)${detail.reservation.children > 0 ? `, ${detail.reservation.children} child(ren)` : ''}`
                      : detail.reservation.persons}
                  </dd>
                  {detail.reservation.resourceLabel ? (
                    <>
                      <dt className="text-neutral-500">Option</dt>
                      <dd>{detail.reservation.resourceLabel}</dd>
                    </>
                  ) : null}
                  <dt className="text-neutral-500">Customer</dt>
                  <dd>
                    {detail.reservation.customerName} · {detail.reservation.email}
                    {detail.reservation.phone ? ` · ${detail.reservation.phone}` : ''}
                  </dd>
                  {detail.reservation.notes ? (
                    <>
                      <dt className="text-neutral-500">Notes</dt>
                      <dd className="italic">{detail.reservation.notes}</dd>
                    </>
                  ) : null}
                </dl>
              </section>

              {/* ── Money: what was paid, and the actions on it ── */}
              <ReservationPaymentsPanel
                reservation={detail.reservation}
                payments={detail.payments}
                gateway={detail.payment}
                canWrite={canWrite && !lock.readOnly}
                busy={busy}
                onResend={() => void resendLink(detail)}
                onRecord={(amount) => void recordPayment(detail, amount)}
                onRefund={(paymentId, amount) => void refund(detail, paymentId, amount)}
              />

              {/* ── What actually happened, including what did NOT get sent ── */}
              <section>
                <h3 className="mb-1 font-medium">History</h3>
                <ul className="flex flex-col gap-1 text-xs">
                  {detail.events.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-2">
                      <span className="text-neutral-500">{new Date(e.createdAt).toLocaleString()}</span>
                      <span>{e.kind}</span>
                      {e.emailStatus === 'failed' ? (
                        <>
                          <Badge tone="red">not sent</Badge>
                          <InfoTip label="Why it was not sent">
                            The email could not be delivered{e.emailError ? `: ${e.emailError}` : '.'}
                          </InfoTip>
                        </>
                      ) : e.emailStatus === 'skipped' ? (
                        <>
                          <Badge tone="amber">nobody notified</Badge>
                          <InfoTip label="Why nobody was notified">
                            {e.emailError ??
                              'No staff notification address is set in Settings → Booking, so nobody was told.'}
                          </InfoTip>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>

              {/* Only where the API would accept it: an expired booking cannot be
                  cancelled, so offering it only produced an error. */}
              {canWrite &&
              !lock.readOnly &&
              canTransition(detail.reservation.status as ReservationStatus, 'cancelled') ? (
                <div className="flex flex-col gap-1">
                  <div>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busy}
                      onClick={() => void move(detail.reservation.id, 'cancelled', 'Cancel booking')}
                    >
                      Cancel booking
                    </Button>
                  </div>
                  <p className="text-xs text-neutral-600">
                    Releases the date and emails the customer. It refunds nothing — use Refund under Payments.
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </Drawer>
      ) : null}

      {dialog}
    </div>
  );
}
