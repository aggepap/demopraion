'use client';

import { useState } from 'react';

import { bookedDatesText } from '@/cms/modules/booking/lifecycle';
import { formatPrice } from '@/lib/money';

interface LookupResult {
  reference: string;
  status: string;
  bookingTitle: string;
  slotDate: string;
  /** Check-out, for a stay; null for transport. */
  endDate: string | null;
  nights: number;
  persons: number;
  resourceLabel: string | null;
  currency: string;
  total: number;
  amountPaid: number;
  items: { label: string; quantity: number; amount: number }[];
}

/**
 * Guest booking lookup — reference plus the email it was made with.
 *
 * That pair is the whole auth story for someone with no account, and it is
 * enough because this surface can only READ. Paying requires the separate,
 * single-purpose token that only the payment email carries.
 */
export function BookingLookupClient({
  locale,
  labels,
}: {
  locale: string;
  labels: Record<string, string>;
}) {
  const [reference, setReference] = useState('');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/cms/booking/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reference, email }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(labels.notFound);
        return;
      }
      setResult(body.data as LookupResult);
    } catch {
      setError(labels.notFound);
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = (status: string) =>
    labels[`status${status.replace(/(^|_)(\w)/g, (_, __, c: string) => c.toUpperCase())}`] ?? status;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-sm border border-neutral-200 bg-white p-6">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{labels.reference}</span>
          <input
            required
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="BKG-2026-XXXXXXXX"
            className="rounded-sm border border-neutral-300 px-3 py-2 font-mono"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{labels.email}</span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-sm border border-neutral-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded-sm bg-warm-gold px-4 py-2 font-medium text-midnight-navy disabled:opacity-50"
        >
          {busy ? labels.searching : labels.submit}
        </button>
      </form>

      {error ? (
        <p role="alert" className="rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {result ? (
        <section className="rounded-sm border border-neutral-200 bg-white p-6 text-sm">
          <h2 className="font-display text-lg font-semibold">{result.bookingTitle}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <dt className="text-neutral-600">{labels.reference}</dt>
            <dd className="font-mono">{result.reference}</dd>
            <dt className="text-neutral-600">{labels.status}</dt>
            <dd className="font-medium">{statusLabel(result.status)}</dd>
            <dt className="text-neutral-600">{labels.date}</dt>
            <dd>{bookedDatesText(result, locale)}</dd>
            <dt className="text-neutral-600">{labels.persons}</dt>
            <dd>{result.persons}</dd>
            <dt className="text-neutral-600">{labels.total}</dt>
            <dd className="font-semibold">{formatPrice(result.total / 100, result.currency, locale)}</dd>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
