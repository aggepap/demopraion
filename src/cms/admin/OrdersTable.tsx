'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { cmsApi, CmsApiError } from './api-client';
import { EditLockBanner } from './locks/EditLockBanner';
import { useEditLock, type EditLock } from './locks/use-edit-lock';
import { apiErrorText } from './api-error-text';
import { useConfirm } from './ui/ConfirmDialog';
import { Field, InfoTip, Th } from './ui';
import { canMoveOrderStatus } from '../modules/commerce/order-status';
import {
  OrderDelivery,
  OrderPayments,
  OrderShipments,
  orderCourier,
  type OrderPaymentView,
  type ShipmentView,
} from './OrderFulfilment';

// Mirrors `orderStatusValues` in the commerce schema (kept literal so this
// client component doesn't import the server-only schema module).
const STATUSES = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'] as const;
type Status = (typeof STATUSES)[number];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  paid: 'bg-blue-100 text-blue-800',
  fulfilled: 'bg-green-100 text-green-800',
  cancelled: 'bg-neutral-200 text-neutral-600',
  refunded: 'bg-red-100 text-red-700',
};

/**
 * What each status means, and what moving an order to it does. Shown behind the
 * "i" beside each status count. The consequences an admin must not miss —
 * cancelling emails the customer and refunds nothing — are also in the
 * confirmation dialogs below, which stay visible text. Exported for
 * `test/cms/commerce-info-tips.test.tsx`.
 */
export const ORDER_STATUS_HELP: Record<Status, string> = {
  pending: 'Placed but not paid yet: waiting for the online payment, or for you to confirm a bank transfer or cash.',
  paid: 'Payment received. Marking a manual order paid also issues any gift cards it bought.',
  fulfilled: 'Shipped or handed over. Moving an order here emails the customer.',
  cancelled: 'Called off. Its items go back into stock and the customer is emailed.',
  refunded: 'Money returned in full. Its items go back into stock and the customer is emailed.',
};

/** Money is stored in minor units (cents). */
function money(cents: number, currency: string, locale: string | null): string {
  const intlLocale = locale === 'el' ? 'el-GR' : 'en-US';
  try {
    return new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

interface OrderRow {
  id: number;
  reference: string;
  status: Status;
  email: string;
  customerName: string | null;
  currency: string;
  subtotal: number;
  total: number;
  locale: string | null;
  createdAt: string;
}

interface OrderItem {
  id: number;
  name: string;
  sku: string | null;
  variantLabel: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  productId?: number | null;
}
/**
 * What the two record-only status pills ask before they act. Exported for
 * `test/cms/order-fulfilment.test.tsx`: the wording is a promise about what the
 * app does, so it is pinned.
 *
 * Cancelling DOES email the customer (`sendOrderStatusEmail`); neither pill
 * moves money. A gateway payment is refunded from Payments, above them.
 */
export const ORDER_STATUS_CONFIRM = {
  refunded: {
    title: 'Mark this order refunded?',
    message:
      'This records the refund against the order: its items go back into stock and the customer is emailed ' +
      'that the order was refunded. It does not move any money — refund the payment with your provider separately.',
    confirmLabel: 'Mark refunded',
  },
  cancelled: {
    title: 'Cancel this order?',
    message:
      'This cancels the order, puts its items back into stock and the customer is emailed to say so. ' +
      'Any payment already taken is not refunded by this — use Refund under Payments, or refund it with your provider.',
    confirmLabel: 'Cancel order',
  },
} as const;
/**
 * Why the panel asks for a refund, keyed by `RefundRequiredNote['reason']`
 * (`modules/commerce/order-admin.ts`). Pinned by `test/commerce/late-capture.test.ts`.
 */
export const REFUND_DUE_TEXT = {
  captured_after_close:
    'The online payment for this order arrived after the order was closed, so it was not reopened and no stock was taken. ' +
    'The customer has been charged: refund the payment under Payments.',
  stock_short:
    'The online payment arrived but there was not enough stock, so the order was cancelled. ' +
    'The customer has been charged: refund the payment under Payments.',
} as const;

interface OrderDetail extends OrderRow {
  notes: string | null;
  /** The copy this editor loaded — sent back on save as the conflict token. */
  version?: number;
  metadata: {
    shipping?: Record<string, unknown>;
    costs?: { shipping?: number; surcharge?: number; discount?: number; giftWrap?: number };
    coupon?: string;
    gift?: { wrap?: boolean; message?: string | null };
  } | null;
  items: OrderItem[];
  payments: OrderPaymentView[];
  /**
   * Set by the server (`refundStillOwed`) while the customer has been charged
   * for an order that will not be filled and the money has not gone back.
   */
  refundDue?: { reason: keyof typeof REFUND_DUE_TEXT; at?: string; orderStatus?: string } | null;
  /** The order's parcels; the admin read includes them. */
  shipments?: ShipmentView[];
}

interface OrdersResult {
  items: OrderRow[];
  page: number;
  pageSize: number;
  total: number;
}

interface OrderStats {
  count: number;
  revenue: number;
  byStatus: Record<string, { count: number; revenue: number }>;
}

const inputClass =
  'rounded-sm border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold';

export function OrdersTable({
  initial,
  stats,
  currency,
  canWrite = true,
}: {
  initial: OrdersResult;
  stats: OrderStats;
  currency: string;
  /**
   * Whether this user holds `cms.commerce.orders.write`. The screen itself is
   * shown on `ordersRead`, so without this a read-only role got the full set of
   * status buttons and a Save, every one of which the server refuses.
   */
  canWrite?: boolean;
}) {
  const [data, setData] = useState<OrdersResult>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);
  /*
   * "Find the order for the customer on the phone" is the most common real task here, and
   * the only tools were a status filter and paging through hundreds of rows. Reviews two
   * screens away already had this.
   */
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

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
      .list<OrderRow>('orders', { status, page, search: appliedSearch || undefined })
      .then((res) => {
        if (active) setData({ items: res.items, page: res.page, pageSize: res.pageSize, total: res.total });
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
  }, [status, page, reloadKey, appliedSearch]);

  /**
   * Change an order's status.
   *
   * This had no error handling of any kind. The server can refuse it — a
   * read-only role reaching the screen through the sidebar, an order removed in
   * another tab — and the rejection escaped as an unhandled promise rejection:
   * the buttons simply did nothing and the reason sat in a console. The same
   * fault has been fixed four times elsewhere in this admin (F-010, F-015,
   * F-016, F-029); the caller shows the message, since that is where the user is
   * looking.
   */
  async function setOrderStatus(id: number, next: Status) {
    const res = await cmsApi.update<OrderDetail>('orders', id, { status: next });
    setSelected(res.data);
    setReloadKey((k) => k + 1);
    /*
     * The list reloads from `reloadKey`; the summary bar above it does not, because it is
     * server-rendered. So moving an order to paid or refunded left the Revenue figure and
     * the per-status counts stating something that was no longer true, with nothing to say
     * they were stale — and revenue is exactly the number someone would quote from a glance.
     */
    router.refresh();
  }

  /*
   * Held for as long as the slide-over is open, and released when it closes.
   * Keyed on the order actually on screen, so clicking straight from one order
   * to another hands the first one back.
   */
  const lock = useEditLock({
    type: 'order',
    key: selected ? String(selected.id) : '',
    enabled: canWrite && selected !== null,
  });

  async function openDetail(id: number) {
    setError(null);
    try {
      const res = await cmsApi.get<OrderDetail>('orders', id);
      setSelected(res.data);
    } catch (err) {
      // Was `catch { /* ignore */ }`: clicking View did nothing at all, with no
      // way for anyone to tell whether the order or the request was the problem.
      setError(err instanceof CmsApiError ? err.message : 'Could not open this order.');
    }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  const exportHref = `/api/cms/orders/export${status ? `?status=${encodeURIComponent(status)}` : ''}`;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-sm border border-neutral-200 px-4 py-3">
          <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-600">
            Orders
            <InfoTip label="About the order count">Every order ever placed, in any status.</InfoTip>
          </div>
          <div className="text-lg font-semibold text-neutral-900">{stats.count}</div>
        </div>
        <div className="rounded-sm border border-neutral-200 px-4 py-3">
          <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-600">
            Revenue
            <InfoTip label="About revenue">
              The totals of every order that is not cancelled or refunded — unpaid pending orders included. All time,
              whatever the status filter; partial refunds are not subtracted.
            </InfoTip>
          </div>
          <div className="text-lg font-semibold text-neutral-900">{money(stats.revenue, currency, 'en')}</div>
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-1.5 rounded-sm border border-neutral-200 px-4 py-3">
          {STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[s] ?? 'bg-neutral-100'}`}>
                {s}: {stats.byStatus[s]?.count ?? 0}
              </span>
              <InfoTip label={`What “${s}” means`}>{ORDER_STATUS_HELP[s]}</InfoTip>
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Status
          <select
            className={inputClass}
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Search
          <span className="flex gap-2">
            <input
              type="search"
              value={search}
              placeholder="reference, email or name…"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                setPage(1);
                setAppliedSearch(search.trim());
              }}
              className="rounded-sm border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold"
            />
            <button
              type="button"
              onClick={() => {
                setPage(1);
                setAppliedSearch(search.trim());
              }}
              className="rounded-sm border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 hover:bg-neutral-50"
            >
              Find
            </button>
          </span>
        </label>
        <div className="flex items-center gap-1.5">
          {/* A read-only role reaches this screen through the sidebar, so the
              controls it cannot use are not offered. Export stays: reading is
              exactly what the role is for. */}
          {canWrite ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-sm bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
            >
              + New order
            </button>
          ) : null}
          <a
            href={exportHref}
            className="rounded-sm border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Export CSV
          </a>
          <InfoTip label="What the export contains">
            A spreadsheet of every order in the chosen status (all statuses when none is picked), newest first: reference,
            date, status, customer, currency, subtotal, discount, shipping, surcharge, total, coupon and items. The search
            box does not narrow it.
          </InfoTip>
        </div>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {/*
        A scroll container that says it scrolls.
        At 390px only Reference, Date and Customer fit — Total, Status and View are in the DOM
        and off screen, with nothing to suggest they are reachable. Focusable and labelled so
        the keyboard can reach the scroll too, and a fade on the right edge so the eye knows.
      */}
      <div
        tabIndex={0}
        role="group"
        aria-label="Orders, scrollable sideways"
        className="relative min-w-0 overflow-x-auto rounded-sm border border-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold [background:linear-gradient(to_left,rgba(0,0,0,0.06),transparent_2.5rem)]"
      >
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-600">
            <tr>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Total</th>
              <Th className="font-normal" info="Where the order stands. Open an order to change it.">
                Status
              </Th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-600">
                  Loading…
                </td>
              </tr>
            ) : data.items.length > 0 ? (
              data.items.map((o) => (
                <tr key={o.id} className="hover:bg-neutral-50">
                  <td className="px-3 py-2 font-mono text-xs">{o.reference}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-neutral-600">
                    {new Date(o.createdAt).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">
                    {o.customerName ? `${o.customerName} · ` : ''}
                    <span className="text-neutral-600">{o.email}</span>
                  </td>
                  <td className="px-3 py-2">{money(o.total, o.currency, o.locale)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[o.status] ?? 'bg-neutral-100'}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openDetail(o.id)} className="text-xs text-neutral-700 hover:underline">
                      View
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-600">
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data.total > data.pageSize ? (
        <div className="flex items-center justify-between text-sm text-neutral-600">
          <span>
            {data.total} total · page {data.page}/{totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {selected ? (
        <OrderEditor
          order={selected}
          currency={currency}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            setReloadKey((k) => k + 1);
          }}
          // The lock only narrows what an editor may do; it can never widen it.
          canWrite={canWrite && !lock.readOnly}
          lock={lock}
          onStatus={canWrite && !lock.readOnly ? setOrderStatus : undefined}
          onChanged={(next) => {
            setSelected(next);
            setReloadKey((k) => k + 1);
            router.refresh();
          }}
        />
      ) : null}
      {creating ? (
        <OrderEditor
          order={null}
          currency={currency}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setReloadKey((k) => k + 1);
          }}
        />
      ) : null}
    </div>
  );
}

interface EditItem {
  /** The stored line this row came from; absent for a line added here. */
  id?: number;
  name: string;
  sku: string;
  variantLabel: string;
  unitPrice: number; // major units
  quantity: number;
  productId?: number;
}

/** The editor's rows for an order's stored lines. Exported for `test/cms/order-editor-lines.test.ts`. */
export function editItemsFromOrder(items: readonly OrderItem[]): EditItem[] {
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    sku: i.sku ?? '',
    variantLabel: i.variantLabel ?? '',
    unitPrice: i.unitPrice / 100,
    quantity: i.quantity,
    productId: i.productId ?? undefined,
  }));
}

/**
 * The lines as the save sends them. An existing line goes back with its id so the
 * server updates it in place — a reinserted line lost its snapshot, and with it
 * the gift card it bought and the variation a refund restocks.
 */
export function editItemsPayload(items: readonly EditItem[]) {
  return items.map((i) => ({
    ...(i.id !== undefined ? { id: i.id } : {}),
    name: i.name.trim(),
    sku: i.sku.trim() || undefined,
    variantLabel: i.variantLabel.trim() || undefined,
    unitPrice: i.unitPrice,
    quantity: i.quantity,
    productId: i.productId,
  }));
}

// The `read-only:` half only lands on the fields the order panel marks read-only
// for a viewer without write permission: a white box with a gold focus ring reads
// as "type here" whatever the attribute says.
const editInput =
  'rounded-sm border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold read-only:border-neutral-200 read-only:bg-neutral-50 read-only:text-neutral-600 read-only:focus:border-neutral-300 read-only:focus:ring-0';

/** Exported for `test/cms/orders-editor-readonly.test.tsx`; rendered only from here. */
export function OrderEditor({
  order,
  currency,
  onClose,
  onSaved,
  onStatus,
  canWrite = true,
  lock,
  onChanged,
}: {
  order: OrderDetail | null;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
  onStatus?: (id: number, status: Status) => Promise<void>;
  canWrite?: boolean;
  /** A refund changed the order on the server; this is the fresh copy. */
  onChanged?: (order: OrderDetail) => void;
  /** Absent when creating: a brand-new order has nothing to lock. */
  lock?: EditLock;
}) {
  const ship = (order?.metadata?.shipping ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const costs = order?.metadata?.costs ?? {};
  const orderCurrency = order?.currency ?? currency;
  const locale = order?.locale ?? null;

  const [email, setEmail] = useState(order?.email ?? '');
  const [name, setName] = useState(order?.customerName ?? '');
  const [phone, setPhone] = useState(s(ship.phone));
  const [address1, setAddress1] = useState(s(ship.address1));
  const [city, setCity] = useState(s(ship.city));
  const [postal, setPostal] = useState(s(ship.postal));
  const [country, setCountry] = useState(s(ship.country));
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [items, setItems] = useState<EditItem[]>(order ? editItemsFromOrder(order.items) : []);
  const [shipping, setShipping] = useState((Number(costs.shipping) || 0) / 100);
  const [discount, setDiscount] = useState((Number(costs.discount) || 0) / 100);
  const [surcharge, setSurcharge] = useState((Number(costs.surcharge) || 0) / 100);
  /*
   * The gift-wrap fee had no field here at all, so every save rebuilt the cost
   * breakdown without it and recomputed a total that left it out: an order that was
   * gift-wrapped came out of an unrelated edit charging as if it were not, while still
   * flagged as a gift and with the payment row showing the original amount (F-067).
   */
  const [giftWrap, setGiftWrap] = useState((Number(costs.giftWrap) || 0) / 100);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState<Status | null>(null);
  const [shipments, setShipments] = useState<ShipmentView[]>(order?.shipments ?? []);
  const { confirm, dialog } = useConfirm();
  /*
   * Unsaved edits are not thrown away without asking.
   *
   * The document editor grew a guard on every way out (F-012, F-031); this drawer is a
   * different component and never got one, so typing a correction and then closing with ✕ —
   * or clicking the backdrop, which is even easier by accident — discarded it with no
   * warning at all.
   */
  const [dirty, setDirty] = useState(false);

  async function closeGuarded() {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard your changes?',
        message: 'This order has edits that have not been saved. Closing now loses them.',
        confirmLabel: 'Discard changes',
        destructive: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const total = Math.max(0, subtotal - discount + shipping + surcharge + giftWrap);
  const fmt = (major: number) => money(Math.round(major * 100), orderCurrency, locale);
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const patchItem = (idx: number, p: Partial<EditItem>) =>
    setItems((list) => list.map((it, x) => (x === idx ? { ...it, ...p } : it)));

  async function save() {
    if (!email.trim()) return setError('Email is required.');
    if (items.length === 0) return setError('Add at least one item.');
    setSaving(true);
    setError(null);
    const body = {
      email: email.trim(),
      customerName: name.trim() || undefined,
      phone: phone.trim() || undefined,
      address1: address1.trim() || undefined,
      city: city.trim() || undefined,
      postal: postal.trim() || undefined,
      country: country.trim() || undefined,
      notes: notes.trim() || undefined,
      currency: orderCurrency,
      locale: order?.locale || undefined,
      items: editItemsPayload(items),
      shipping,
      discount,
      surcharge,
      giftWrap,
      coupon: order?.metadata?.coupon || undefined,
      /*
       * What this editor read. A save replaces the order outright, including every
       * line item, so without this the second of two admins on one order silently
       * undid the first — someone correcting a phone number removing a colleague's
       * just-added item (F-068). Absent on create, where there is nothing to conflict
       * with.
       */
      ...(order?.version !== undefined ? { expectedVersion: order.version } : {}),
    };
    try {
      if (order) await cmsApi.saveOrder(order.id, body);
      else await cmsApi.createOrder(body);
      onSaved();
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  /*
   * A reader gets the same panel, read-only.
   *
   * `canWrite` was spent entirely on the Save button and the status pills, so
   * every field under them still took typing from a role that cannot save any of
   * it — an invitation to make an edit the panel drops on close. `readonly`
   * rather than `disabled` throughout: an address on a pickup order is something
   * people copy out into a courier form, and a disabled input can be neither
   * selected nor tabbed to. Buttons have no read-only state, so the two ways of
   * changing the item list are removed below instead.
   */
  const field = (label: string, value: string, set: (v: string) => void, type = 'text') => (
    <label className="flex flex-col gap-1 text-xs text-neutral-600">
      {label}
      <input
        type={type}
        className={editInput}
        value={value}
        readOnly={!canWrite}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => void closeGuarded()}>
      {dialog}
      <div
        // Any typing in the panel means there is something to lose on close.
        onInput={() => setDirty(true)}
        className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-lg font-semibold">{order ? order.reference : 'New order'}</h2>
          <button onClick={() => void closeGuarded()} className="text-neutral-600 hover:text-neutral-700">
            ✕
          </button>
        </div>

        {/* Fulfilment (§8) — a collected order has no delivery address. */}
        {ship.method === 'pickup' ? (
          <div className="mb-4 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="font-semibold">Store pickup</span>
            {(() => {
              const loc = (ship.pickup ?? null) as { name?: string; address?: string | null } | null;
              const parts = [loc?.name, loc?.address].filter((v): v is string => Boolean(v));
              return parts.length ? ` — ${parts.join(', ')}` : '';
            })()}
          </div>
        ) : null}

        {/* Customer */}
        <div className="mb-5 grid grid-cols-2 gap-3">
          {field('Email *', email, setEmail, 'email')}
          {field('Customer name', name, setName)}
          {field('Phone', phone, setPhone)}
          {field('Address', address1, setAddress1)}
          {field('City', city, setCity)}
          {field('Postal code', postal, setPostal)}
          {field('Country', country, setCountry)}
        </div>

        {/* Items */}
        <h3 className="mb-2 text-sm font-semibold text-neutral-700">Items</h3>
        <div className="mb-3 flex flex-col gap-2">
          {items.map((it, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-sm border border-neutral-200 p-2">
              <input
                className={`${editInput} min-w-[8rem] flex-1`}
                placeholder="Name"
                readOnly={!canWrite}
                value={it.name}
                onChange={(e) => patchItem(i, { name: e.target.value })}
              />
              <input
                className={`${editInput} w-28`}
                placeholder="Variant"
                readOnly={!canWrite}
                value={it.variantLabel}
                onChange={(e) => patchItem(i, { variantLabel: e.target.value })}
              />
              <input
                className={`${editInput} w-20`}
                placeholder="SKU"
                readOnly={!canWrite}
                value={it.sku}
                onChange={(e) => patchItem(i, { sku: e.target.value })}
              />
              <input
                type="number"
                min={0}
                step="any"
                className={`${editInput} w-24`}
                placeholder="Price"
                readOnly={!canWrite}
                value={it.unitPrice || ''}
                onChange={(e) => patchItem(i, { unitPrice: num(e.target.value) })}
              />
              <span className="text-neutral-600">×</span>
              <input
                type="number"
                min={1}
                step={1}
                className={`${editInput} w-16`}
                readOnly={!canWrite}
                value={it.quantity}
                onChange={(e) => patchItem(i, { quantity: Math.max(1, Math.floor(num(e.target.value))) })}
              />
              <span className="w-20 text-right text-sm font-medium">{fmt(it.unitPrice * it.quantity)}</span>
              {canWrite ? (
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => setItems((list) => list.filter((_, x) => x !== i))}
                  className="text-neutral-600 hover:text-red-700"
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {canWrite ? <ProductSearch onPick={(it) => setItems((list) => [...list, it])} /> : null}

        {/* Costs */}
        <div className="mb-4 mt-5 grid grid-cols-3 gap-3">
          <Field label={`Shipping (${orderCurrency})`} description="Charged as entered — it is not recalculated from your shipping rates. Saving updates the order total, not the payment already taken.">
            <input
              type="number"
              min={0}
              step="any"
              className={editInput}
              readOnly={!canWrite}
              value={shipping || ''}
              onChange={(e) => setShipping(num(e.target.value))}
            />
          </Field>
          <Field label={`Discount (${orderCurrency})`} description="Taken off the order total as entered. It is not recalculated from the coupon.">
            <input
              type="number"
              min={0}
              step="any"
              className={editInput}
              readOnly={!canWrite}
              value={discount || ''}
              onChange={(e) => setDiscount(num(e.target.value))}
            />
          </Field>
          <Field label={`Surcharge (${orderCurrency})`} description="The payment fee added at checkout, e.g. for cash on delivery (see Payment surcharges in the shipping settings). Charged as entered.">
            <input
              type="number"
              min={0}
              step="any"
              className={editInput}
              readOnly={!canWrite}
              value={surcharge || ''}
              onChange={(e) => setSurcharge(num(e.target.value))}
            />
          </Field>
          <Field
            label={`Gift wrap (${orderCurrency})`}
            description="The gift-wrap fee this order was charged. Kept as entered, not taken from today’s setting."
          >
            {(control) => (
              <>
                <input
                  {...control}
                  type="number"
                  min={0}
                  step="any"
                  className={editInput}
                  readOnly={!canWrite}
                  value={giftWrap || ''}
                  onChange={(e) => setGiftWrap(num(e.target.value))}
                />
                {order?.metadata?.gift?.wrap ? (
                  // The one place the two facts can be seen together: an order flagged as a
                  // gift, and the fee it was actually charged for it.
                  <span className="text-[11px] text-neutral-500">This order is marked as a gift.</span>
                ) : null}
              </>
            )}
          </Field>
        </div>

        <dl className="mb-4 flex flex-col gap-1 border-t border-neutral-200 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-600">Subtotal</dt>
            <dd>{fmt(subtotal)}</dd>
          </div>
          {/*
            Every component of the total, not three of six.
            "What was this customer charged, and why" is the question this panel exists to
            answer, and it showed Subtotal, sometimes Gift wrap, and Total — leaving the
            reader to work out the gap from the editable fields above. Shipping, discount and
            surcharge are always shown now, so Subtotal plus the lines equals Total on the
            screen rather than in someone's head. A discount is written as a subtraction
            because that is what it does.
          */}

          <div className="flex justify-between">
            <dt className="text-neutral-600">Shipping</dt>
            <dd>{fmt(shipping)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-600">Payment surcharge</dt>
            <dd>{fmt(surcharge)}</dd>
          </div>
          {giftWrap ? (
            <div className="flex justify-between">
              <dt className="text-neutral-600">Gift wrap</dt>
              <dd>{fmt(giftWrap)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-neutral-600">Discount</dt>
            <dd>{discount ? `−${fmt(discount)}` : fmt(0)}</dd>
          </div>
          <div className="flex justify-between border-t border-neutral-200 pt-1 font-semibold">
            <dt>Total</dt>
            <dd>{fmt(total)}</dd>
          </div>
        </dl>

        <Field
          className="mb-4"
          label="Notes"
          description="The note the customer left at checkout, and anything you add. Internal: not shown to the customer or included in their emails."
        >
          <textarea
            className={editInput}
            rows={2}
            readOnly={!canWrite}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {/* Money taken, how it travels, and its parcels (existing orders only). */}
        {order?.refundDue ? (
          <p role="alert" className="mb-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {REFUND_DUE_TEXT[order.refundDue.reason] ?? REFUND_DUE_TEXT.captured_after_close}
          </p>
        ) : null}
        {order ? (
          <>
            <OrderDelivery shipping={ship} payments={order.payments} currency={orderCurrency} locale={locale} />
            <OrderPayments
              payments={order.payments}
              currency={orderCurrency}
              locale={locale}
              canWrite={canWrite}
              onRefund={async (paymentId, amount, reason) => {
                const res = await cmsApi.refundOrderPayment<{ order: OrderDetail | null }>(order.id, {
                  paymentId,
                  amount,
                  reason,
                });
                if (res.data.order) onChanged?.(res.data.order);
              }}
            />
            {ship.virtual ? null : (
              <OrderShipments
                orderId={order.id}
                shipments={shipments}
                orderCourier={orderCourier(ship)}
                canWrite={canWrite}
                onChange={setShipments}
              />
            )}
          </>
        ) : null}

        {/* Status (edit only) */}
        {order && onStatus ? (
          <div className="mb-4">
            <span className="mb-1 flex items-center gap-1 text-sm font-semibold text-neutral-700">
              Status
              <InfoTip label="About order statuses">
                Click a status to move the order to it. Fulfilled, cancelled and refunded email the customer; cancelled and
                refunded put the items back into stock. Only the next steps are offered: pending → paid or cancelled, paid →
                fulfilled, refunded or cancelled, fulfilled → refunded. Cancelled and refunded are final.
              </InfoTip>
            </span>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((st) => (
                <button
                  key={st}
                  type="button"
                  // The current status stays clickable-looking; a move the
                  // lifecycle does not allow is disabled (the server refuses it).
                  disabled={statusBusy !== null || (order.status !== st && !canMoveOrderStatus(order.status, st))}
                  title={
                    order.status !== st && !canMoveOrderStatus(order.status, st)
                      ? `A ${order.status} order cannot be moved to ${st}.`
                      : undefined
                  }
                  /*
                   * Refunding and cancelling ask first.
                   *
                   * Five pills of identical weight sat in one row, and two of them are not
                   * like the others: "refunded" concerns real money and "cancelled" concerns
                   * an order somebody is expecting. A mis-aimed click did either instantly,
                   * with no question and nothing to undo it — while deleting a review, one
                   * screen away in the same admin, has always asked. The message says what
                   * the app does and does not do, because "refunded" here is a record of a
                   * decision, not an instruction to the payment provider.
                   *
                   * The refusal is shown in the panel the user is looking at rather than
                   * escaping as an unhandled rejection.
                   */
                  onClick={async () => {
                    if (order.status === st) return;
                    if (st === 'refunded' || st === 'cancelled') {
                      const ok = await confirm({ ...ORDER_STATUS_CONFIRM[st], destructive: true });
                      if (!ok) return;
                    }
                    setError(null);
                    setStatusBusy(st);
                    try {
                      await onStatus(order.id, st);
                    } catch (err) {
                      setError(apiErrorText(err, 'Could not change the status.'));
                    } finally {
                      setStatusBusy(null);
                    }
                  }}
                  className={`rounded px-2 py-1 text-xs disabled:opacity-50 ${order.status === st ? 'ring-2 ring-neutral-900' : ''} ${STATUS_COLORS[st] ?? 'bg-neutral-100'}`}
                >
                  {statusBusy === st ? 'saving…' : st}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mb-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {/* Above the role notice: "someone else has this open" is the more
            actionable of the two, and it comes with a button. */}
        {lock ? <div className="mb-3"><EditLockBanner lock={lock} /></div> : null}

        {canWrite || lock?.readOnly ? null : (
          <p className="mb-3 rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
            Your role can view orders but not change them.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => void closeGuarded()} className="rounded-sm border border-neutral-300 px-4 py-2 text-sm">
            {canWrite ? 'Cancel' : 'Close'}
          </button>
          {canWrite ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-sm bg-warm-gold px-4 py-2 text-sm font-medium text-midnight-navy hover:bg-warm-gold-dark disabled:opacity-50"
            >
              {saving ? 'Saving…' : order ? 'Save order' : 'Create order'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface ProductHit {
  id: number;
  slug: string;
  data: Record<string, unknown>;
}

/** Typeahead to add a product as an order line (resolves name + price). */
function ProductSearch({ onPick }: { onPick: (item: EditItem) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = q.trim();
    let active = true;
    const id = setTimeout(() => {
      if (!term) {
        setHits([]);
        return;
      }
      cmsApi
        .list<ProductHit>('product', { search: term, pageSize: 15 })
        .then((r) => active && setHits(r.items))
        .catch(() => {});
    }, 250);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [q]);

  const pick = (hit: ProductHit) => {
    const data = hit.data ?? {};
    const title = typeof data.title === 'string' && data.title ? data.title : hit.slug;
    onPick({
      name: title,
      sku: typeof data.sku === 'string' ? data.sku : '',
      variantLabel: '',
      unitPrice: Number(data.price) || 0,
      quantity: 1,
      productId: hit.id,
    });
    setQ('');
    setHits([]);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        className={`${editInput} w-full`}
        placeholder="Add product… (search)"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && hits.length > 0 ? (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-sm border border-neutral-200 bg-white shadow-lg">
          {hits.map((h) => {
            const data = h.data ?? {};
            const title = typeof data.title === 'string' && data.title ? data.title : h.slug;
            return (
              <li key={h.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(h)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-neutral-50"
                >
                  <span>{title}</span>
                  <span className="text-neutral-600">{data.price != null ? String(data.price) : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
