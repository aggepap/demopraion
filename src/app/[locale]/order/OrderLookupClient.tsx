'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { formatPrice } from '@/lib/money';

interface LookupItem {
  id: number;
  name: string;
  variantLabel: string | null;
  quantity: number;
  lineTotal: number;
}
interface LookupOrder {
  reference: string;
  status: string;
  currency: string;
  total: number;
  locale: string | null;
  metadata: { shipping?: Record<string, unknown> } | null;
  items: LookupItem[];
}

const inputClass =
  'w-full rounded-sm border border-border-soft bg-white px-3 py-2 font-body text-sm text-text-primary focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold';

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  paid: 'bg-blue-100 text-blue-800',
  fulfilled: 'bg-green-100 text-green-800',
  cancelled: 'bg-neutral-200 text-neutral-600',
  refunded: 'bg-red-100 text-red-700',
};

export function OrderLookupClient({ locale }: { locale: string }) {
  const t = useTranslations('orderLookup');
  const [reference, setReference] = useState('');
  const [email, setEmail] = useState('');
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<LookupOrder | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLooking(true);
    setError(null);
    setOrder(null);
    try {
      const res = await fetch('/api/cms/commerce/order-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, email }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(t('notFound'));
      }
      setOrder(data.data as LookupOrder);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notFound'));
    } finally {
      setLooking(false);
    }
  }

  const shipping = (order?.metadata?.shipping ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : '');
  const shipStr = order
    ? [str(shipping.address1), str(shipping.city), str(shipping.postal), str(shipping.country)]
        .filter(Boolean)
        .join(', ')
    : '';
  const statusKey = order ? `statuses.${order.status}` : '';

  return (
    <section className="bg-soft-pearl pt-20 md:pt-28 pb-24">
      <div className="max-w-2xl mx-auto px-6">
        <Eyebrow className="mb-3">{t('title')}</Eyebrow>
        <h1 className="mb-4 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-midnight-navy">
          {t('title')}
        </h1>
        <p className="mb-8 font-body text-text-muted">{t('intro')}</p>

        <form onSubmit={submit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 font-body text-sm text-text-primary">
            {t('reference')}
            <input className={inputClass} required value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label className="flex flex-1 flex-col gap-1 font-body text-sm text-text-primary">
            {t('email')}
            <input type="email" className={inputClass} required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" size="sm" disabled={looking}>
            {looking ? t('looking') : t('lookup')}
          </Button>
        </form>

        {error ? <p className="mt-4 font-body text-sm text-red-600">{error}</p> : null}

        {order ? (
          <div className="mt-10 rounded-sm border border-border-soft bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-lg font-semibold text-midnight-navy">{order.reference}</span>
              <span
                className={`rounded-sm px-2.5 py-1 text-xs font-medium ${STATUS_TONE[order.status] ?? 'bg-neutral-100 text-neutral-600'}`}
              >
                {t(statusKey)}
              </span>
            </div>

            <ul className="flex flex-col gap-2">
              {order.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3 font-body text-sm">
                  <span className="min-w-0">
                    {i.name}
                    {i.variantLabel ? <span className="text-text-muted"> — {i.variantLabel}</span> : null}
                    <span className="text-text-muted"> × {i.quantity}</span>
                  </span>
                  <span className="whitespace-nowrap">
                    {formatPrice(i.lineTotal / 100, order.currency, locale)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between border-t border-border-soft pt-4">
              <span className="font-body text-sm text-text-muted">{t('total')}</span>
              <span className="font-display text-lg font-semibold text-midnight-navy">
                {formatPrice(order.total / 100, order.currency, locale)}
              </span>
            </div>

            {shipStr ? (
              <p className="mt-4 font-body text-sm text-text-muted">
                {t('shipTo')}: {shipStr}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
