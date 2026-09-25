'use client';

import { useState } from 'react';

import { COURIER_LABELS, shipmentActions, type CourierKey } from '../modules/commerce/shipping-methods';
import { cmsApi } from './api-client';
import { apiErrorText } from './api-error-text';
import { Button, Field, InfoTip, Select, TextInput } from './ui';
import { useConfirm } from './ui/ConfirmDialog';

/**
 * The parts of the order panel that concern money already taken and parcels
 * already sent: payments (and refunding one), how the order travels, and its
 * shipments. Each section is told whether the viewer may write; the server
 * checks `ordersWrite` again on every action.
 */

export interface OrderPaymentView {
  id: number;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  method: string | null;
  providerRef: string | null;
  /** How much can still be refunded online (0 = no refund offered). Set by the server. */
  refundable?: number;
}

export interface ShipmentView {
  id: number;
  courier: string;
  voucher: string;
  trackingUrl: string | null;
  status: string;
  createdAt: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  stripe: 'Stripe',
  paypal: 'PayPal',
  viva: 'Viva Wallet',
  manual: 'Manual / bank transfer',
  giftcard: 'Gift card',
};

const providerLabel = (key: string) => PROVIDER_LABELS[key] ?? key;
const courierLabel = (key: string) => COURIER_LABELS[key as CourierKey] ?? key;

/** Money is stored in minor units (cents). */
export function formatMinor(cents: number, currency: string, locale: string | null): string {
  const intlLocale = locale === 'el' ? 'el-GR' : 'en-US';
  try {
    return new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Only an http(s) tracking link is rendered as a link. */
const safeTrackingUrl = (url: string | null) => (url && /^https:\/\//i.test(url) ? url : null);

const sectionTitle = 'mb-2 text-sm font-semibold text-neutral-700';

// ── Payments ────────────────────────────────────────────────────────────────

export function OrderPayments({
  payments,
  currency,
  locale,
  canWrite,
  onRefund,
}: {
  payments: OrderPaymentView[];
  currency: string;
  locale: string | null;
  canWrite: boolean;
  /** Minor units; `amount` absent = everything still refundable. */
  onRefund: (paymentId: number, amount: number | undefined, reason: string | undefined) => Promise<void>;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const fmt = (cents: number, cur = currency) => formatMinor(cents, cur, locale);

  async function submit(payment: OrderPaymentView) {
    const max = payment.refundable ?? 0;
    const cents = Math.round(Number(amount.replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || cents <= 0 || cents > max) {
      setError(`Enter an amount between ${fmt(1, payment.currency)} and ${fmt(max, payment.currency)}.`);
      return;
    }
    const ok = await confirm({
      title: `Refund ${fmt(cents, payment.currency)}?`,
      message:
        `This sends ${fmt(cents, payment.currency)} back to the customer through ${providerLabel(payment.provider)}. ` +
        'It cannot be undone. ' +
        (cents === max
          ? 'The payment is then fully refunded, so the order is marked refunded, its items go back into stock and the customer is emailed.'
          : 'This is a partial refund: the order keeps its status and nothing goes back into stock.'),
      confirmLabel: 'Refund',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await onRefund(payment.id, cents === max ? undefined : cents, reason.trim() || undefined);
      setOpen(null);
    } catch (err) {
      setError(apiErrorText(err, 'The refund did not go through.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-5">
      {dialog}
      <h3 className={`${sectionTitle} flex items-center gap-1`}>
        Payments
        <InfoTip label="About payments">
          One line per payment for this order. Captured means the money was taken. Refund appears only on an online
          payment that still has money left to return.
        </InfoTip>
      </h3>
      {payments.length === 0 ? (
        <p className="text-sm text-neutral-600">No payments recorded.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-100 rounded-sm border border-neutral-200">
          {payments.map((payment) => {
            const refundable = payment.refundable ?? 0;
            const offerRefund = canWrite && payment.status === 'captured' && refundable > 0;
            return (
              <li key={payment.id} className="flex flex-col gap-2 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium text-neutral-900">{providerLabel(payment.provider)}</span>
                    {payment.method && payment.method !== payment.provider ? (
                      <span className="text-neutral-600"> · {payment.method}</span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3">
                    <span>{fmt(payment.amount, payment.currency)}</span>
                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">{payment.status}</span>
                    {offerRefund && open !== payment.id ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-label={`Refund payment ${payment.id}`}
                        onClick={() => {
                          setOpen(payment.id);
                          setAmount((refundable / 100).toFixed(2));
                          setReason('');
                          setError(null);
                        }}
                      >
                        Refund
                      </Button>
                    ) : null}
                  </span>
                </div>
                {offerRefund && refundable < payment.amount ? (
                  <p className="text-xs text-neutral-600">
                    {fmt(payment.amount - refundable, payment.currency)} already refunded ·{' '}
                    {fmt(refundable, payment.currency)} left
                  </p>
                ) : null}
                {offerRefund && open === payment.id ? (
                  <form
                    className="flex flex-wrap items-end gap-2 rounded-sm bg-neutral-50 p-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submit(payment);
                    }}
                  >
                    <Field
                      label={`Amount to refund (${payment.currency})`}
                      description={`Up to ${fmt(refundable, payment.currency)}. Less than that is a partial refund.`}
                    >
                      <TextInput
                        type="number"
                        min={0.01}
                        max={refundable / 100}
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-32"
                      />
                    </Field>
                    <Field
                      className="min-w-[10rem] flex-1"
                      label="Reason (optional)"
                      description="Sent to the payment provider with the refund and kept on the refund record."
                    >
                      <TextInput maxLength={191} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </Field>
                    <Button type="submit" size="sm" disabled={busy}>
                      {busy ? 'Refunding…' : 'Refund'}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

// ── Delivery ────────────────────────────────────────────────────────────────

interface ShippingMethodSnapshot {
  name?: string;
  courier?: string;
  kind?: string;
  cost?: number;
}

/** The courier the customer chose at checkout, if the order used a shipping method. */
export function orderCourier(shipping: Record<string, unknown> | undefined): string | null {
  const method = (shipping?.shippingMethod ?? null) as ShippingMethodSnapshot | null;
  return typeof method?.courier === 'string' ? method.courier : null;
}

export function OrderDelivery({
  shipping,
  payments,
  currency,
  locale,
}: {
  shipping: Record<string, unknown>;
  payments: OrderPaymentView[];
  currency: string;
  locale: string | null;
}) {
  const method = (shipping.shippingMethod ?? null) as ShippingMethodSnapshot | null;
  const locker = (shipping.locker ?? null) as { id?: string; name?: string } | null;
  const cards = payments.filter((p) => p.provider === 'giftcard' && p.status === 'captured' && p.amount > 0);
  const cardTotal = cards.reduce((sum, p) => sum + p.amount, 0);
  if (!method && !locker?.id && cards.length === 0) return null;

  return (
    <section className="mb-5">
      <h3 className={sectionTitle}>Delivery</h3>
      <dl className="flex flex-col gap-1 rounded-sm border border-neutral-200 px-3 py-2 text-sm">
        {method ? (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-neutral-600">Shipping method</dt>
            <dd>
              {method.name ?? '—'}
              {method.courier ? <span className="text-neutral-600"> · {courierLabel(method.courier)}</span> : null}
            </dd>
          </div>
        ) : null}
        {locker?.id ? (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-neutral-600">BoxNow locker</dt>
            <dd>
              {locker.name || '—'} <span className="font-mono text-xs text-neutral-600">({locker.id})</span>
            </dd>
          </div>
        ) : null}
        {cards.length > 0 ? (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-neutral-600">Gift cards used</dt>
            <dd>
              {formatMinor(cardTotal, currency, locale)}
              {cards.length > 1 ? <span className="text-neutral-600"> ({cards.length} cards)</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

// ── Shipments ───────────────────────────────────────────────────────────────

export function OrderShipments({
  orderId,
  shipments,
  orderCourier: courier,
  canWrite,
  onChange,
}: {
  orderId: number;
  shipments: ShipmentView[];
  /** The courier the customer chose, when the order used a shipping method. */
  orderCourier: string | null;
  canWrite: boolean;
  onChange: (shipments: ShipmentView[]) => void;
}) {
  const actions = shipmentActions(courier);
  const [trackingCourier, setTrackingCourier] = useState<string>(
    courier && actions.trackingCouriers.includes(courier as CourierKey) ? courier : actions.trackingCouriers[0] ?? 'custom',
  );
  const [voucher, setVoucher] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function run(body: { courier: string; voucher?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await cmsApi.createShipment<{ shipments: ShipmentView[] }>(orderId, body);
      onChange(res.data.shipments);
      setVoucher('');
    } catch (err) {
      setError(apiErrorText(err, 'Could not record the shipment.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-5">
      {dialog}
      <h3 className={`${sectionTitle} flex items-center gap-1`}>
        Shipments
        <InfoTip label="About shipments">
          The parcels sent for this order, with their tracking numbers. Recording one does not email the customer or
          change the order status — mark the order fulfilled for that.
        </InfoTip>
      </h3>
      {shipments.length === 0 ? (
        <p className="text-sm text-neutral-600">No shipments yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-100 rounded-sm border border-neutral-200">
          {shipments.map((shipment) => {
            const href = safeTrackingUrl(shipment.trackingUrl);
            return (
              <li key={shipment.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-neutral-900">{courierLabel(shipment.courier)}</span>{' '}
                  <span className="font-mono text-xs">{shipment.voucher}</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-neutral-600">
                  {String(shipment.createdAt).slice(0, 10)}
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-neutral-800 underline">
                      Track parcel
                    </a>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {canWrite ? (
        <div className="mt-2 flex flex-col gap-2">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!voucher.trim()) return setError('Type the tracking number the courier gave you.');
              void run({ courier: trackingCourier, voucher: voucher.trim() });
            }}
          >
            <Field label="Courier">
              <Select value={trackingCourier} onChange={(e) => setTrackingCourier(e.target.value)}>
                {actions.trackingCouriers.map((key) => (
                  <option key={key} value={key}>
                    {courierLabel(key)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              className="min-w-[10rem] flex-1"
              label="Tracking number"
              description="The voucher number from the courier’s own system. It becomes a tracking link where the courier has one."
            >
              <TextInput maxLength={64} value={voucher} onChange={(e) => setVoucher(e.target.value)} />
            </Field>
            <Button type="submit" variant="secondary" size="sm" disabled={busy}>
              Add tracking number
            </Button>
          </form>
          {actions.createVoucher ? (
            <div>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Create a BoxNow voucher?',
                    message:
                      'This books the parcel with BoxNow for the locker the customer chose, ' +
                      'and records its voucher number here.',
                    confirmLabel: 'Create voucher',
                    destructive: false,
                  });
                  if (ok) void run({ courier: 'boxnow' });
                }}
              >
                Create BoxNow voucher
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
