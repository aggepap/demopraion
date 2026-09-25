'use client';

import { useState, type FormEvent } from 'react';

import {
  balanceDue,
  canRecordPayment,
  canResendPaymentLink,
  parseMoneyInput,
  recordPaymentRefusal,
  refundRefusal,
} from '../modules/booking/payment-actions';
import { Badge, Button, InfoTip, Select, TextInput } from './ui';

export interface ReservationPaymentRow {
  id: number;
  provider: string;
  status: string;
  amount: number;
  /** Minor units that can still be refunded online; 0 = no refund offered. */
  refundable: number;
  refundedAmount: number;
  createdAt: string;
}

export interface ReservationPaymentsPanelProps {
  reservation: { status: string; total: number; amountPaid: number; currency: string; expiresAt: string | null };
  payments: ReservationPaymentRow[];
  /** The site's configured payment method (Settings → Booking). */
  gateway: { online: boolean; label: string; linkTtlDays: number };
  canWrite: boolean;
  busy: boolean;
  /** Injected for tests; the drawer uses the real clock. */
  now?: Date;
  onResend: () => void;
  onRecord: (amountMinor: number) => void;
  onRefund: (paymentId: number, amountMinor: number | undefined) => void;
}

export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('el-GR', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

const PAYMENT_STATUS_TONE: Record<string, 'neutral' | 'green' | 'amber' | 'red'> = {
  captured: 'green',
  pending: 'amber',
  failed: 'red',
  refunded: 'neutral',
};

/**
 * The reservation drawer's money section: what was paid, and the three actions —
 * resend the payment link, record a payment that arrived outside the website,
 * and refund one taken through a gateway.
 *
 * Each action is offered only where its route would accept it (the same rules,
 * from `payment-actions.ts`), and none is offered to a read-only role. The
 * confirmations and the calls themselves live with the drawer.
 */
export function ReservationPaymentsPanel({
  reservation,
  payments,
  gateway,
  canWrite,
  busy,
  now,
  onResend,
  onRecord,
  onRefund,
}: ReservationPaymentsPanelProps) {
  const [recordText, setRecordText] = useState('');
  const [recordError, setRecordError] = useState<string | null>(null);
  const refundable = payments.filter((p) => p.refundable > 0);
  const [refundId, setRefundId] = useState<number | null>(null);
  const [refundText, setRefundText] = useState('');
  const [refundError, setRefundError] = useState<string | null>(null);

  const money = (minor: number) => formatMoney(minor, reservation.currency);
  const selected = refundable.find((p) => p.id === refundId) ?? refundable[0];
  const clock = now ?? new Date();

  const showResend = canWrite && gateway.online && canResendPaymentLink(reservation, clock);
  const showRecord = canWrite && canRecordPayment(reservation);
  const showRefund = canWrite && selected !== undefined;

  function submitRecord(e: FormEvent) {
    e.preventDefault();
    const amount = parseMoneyInput(recordText);
    const refusal = amount === null ? 'Enter an amount such as 120 or 120.50.' : recordPaymentRefusal(reservation, amount);
    setRecordError(refusal);
    if (refusal || amount === null) return;
    onRecord(amount);
    setRecordText('');
  }

  function submitRefund(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const amount = refundText.trim() === '' ? undefined : parseMoneyInput(refundText);
    const refusal = amount === null ? 'Enter an amount such as 50 or 49.90.' : refundRefusal(selected.refundable, amount);
    setRefundError(refusal);
    if (refusal || amount === null) return;
    onRefund(selected.id, amount);
    setRefundText('');
  }

  return (
    <section aria-labelledby="reservation-payments-title">
      <h3 id="reservation-payments-title" className="mb-1 flex items-center gap-1 font-medium">
        Payments
        <InfoTip label="About payment statuses">
          One line per payment. Captured: the money was taken. Pending: started but not completed. Failed: it did not go
          through. Refunded: returned to the customer.
        </InfoTip>
      </h3>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
        <dt className="flex items-center gap-1 text-neutral-500">
          Paid so far
          <InfoTip label="About Paid so far">Money received for this booking, online or recorded here by hand.</InfoTip>
        </dt>
        <dd>{money(reservation.amountPaid)}</dd>
        <dt className="flex items-center gap-1 text-neutral-500">
          Balance due
          <InfoTip label="About Balance due">The booking total minus what has been paid so far.</InfoTip>
        </dt>
        <dd>{money(balanceDue(reservation))}</dd>
      </dl>

      {payments.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-2">
              <span className="text-neutral-500">{new Date(p.createdAt).toLocaleDateString()}</span>
              <span className="capitalize">{p.provider}</span>
              <Badge tone={PAYMENT_STATUS_TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
              <span>{money(p.amount)}</span>
              {p.refundedAmount > 0 ? <span className="text-neutral-500">{money(p.refundedAmount)} refunded</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-neutral-500">No payments recorded yet.</p>
      )}

      {showResend ? (
        <div className="mt-3 flex flex-col gap-1">
          <div>
            <Button variant="secondary" size="sm" disabled={busy} onClick={onResend}>
              Resend payment link
            </Button>
          </div>
          <p className="text-xs text-neutral-600">
            Emails the customer a new {gateway.label} link, valid for {gateway.linkTtlDays}{' '}
            {gateway.linkTtlDays === 1 ? 'day' : 'days'}. The previous link stops working.
          </p>
        </div>
      ) : null}

      {showRecord ? (
        <form onSubmit={submitRecord} className="mt-3 flex flex-col gap-1" noValidate>
          <label htmlFor="reservation-record-amount" className="text-xs font-medium text-neutral-700">
            Amount received ({reservation.currency})
          </label>
          <div className="flex gap-2">
            <TextInput
              id="reservation-record-amount"
              inputMode="decimal"
              autoComplete="off"
              value={recordText}
              onChange={(e) => setRecordText(e.target.value)}
              placeholder={(balanceDue(reservation) / 100).toFixed(2)}
              aria-invalid={recordError ? true : undefined}
              aria-describedby={recordError ? 'reservation-record-error' : 'reservation-record-help'}
              className="w-32"
            />
            <Button type="submit" variant="secondary" size="sm" disabled={busy}>
              Record payment
            </Button>
          </div>
          {recordError ? (
            <p id="reservation-record-error" role="alert" className="text-xs text-red-700">
              {recordError}
            </p>
          ) : null}
          <p id="reservation-record-help" className="text-xs text-neutral-600">
            For money that reached you outside the website — a bank transfer or cash. Nothing is charged.
          </p>
        </form>
      ) : null}

      {showRefund && selected ? (
        <form onSubmit={submitRefund} className="mt-3 flex flex-col gap-1" noValidate>
          {refundable.length > 1 ? (
            <>
              <label htmlFor="reservation-refund-payment" className="text-xs font-medium text-neutral-700">
                Payment to refund
              </label>
              <Select
                id="reservation-refund-payment"
                value={selected.id}
                onChange={(e) => setRefundId(Number(e.target.value))}
              >
                {refundable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.provider} · {money(p.amount)} · {money(p.refundable)} refundable
                  </option>
                ))}
              </Select>
            </>
          ) : null}
          <label htmlFor="reservation-refund-amount" className="text-xs font-medium text-neutral-700">
            Refund amount ({reservation.currency})
          </label>
          <div className="flex gap-2">
            <TextInput
              id="reservation-refund-amount"
              inputMode="decimal"
              autoComplete="off"
              value={refundText}
              onChange={(e) => setRefundText(e.target.value)}
              placeholder={(selected.refundable / 100).toFixed(2)}
              aria-invalid={refundError ? true : undefined}
              aria-describedby={refundError ? 'reservation-refund-error' : 'reservation-refund-help'}
              className="w-32"
            />
            <Button type="submit" variant="danger" size="sm" disabled={busy}>
              Refund
            </Button>
          </div>
          {refundError ? (
            <p id="reservation-refund-error" role="alert" className="text-xs text-red-700">
              {refundError}
            </p>
          ) : null}
          <p id="reservation-refund-help" className="text-xs text-neutral-600">
            Leave empty to refund the full {money(selected.refundable)}. The money is returned to the customer through{' '}
            <span className="capitalize">{selected.provider}</span>; the booking&apos;s status does not change.
          </p>
        </form>
      ) : null}
    </section>
  );
}
