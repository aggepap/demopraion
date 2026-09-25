'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { formatPrice } from '@/lib/money';

/**
 * "Do you have a gift card?" at checkout.
 *
 * A card is checked before it is added, so a mistyped code is caught here
 * rather than at the end of a payment. Several codes can be added: a customer
 * with two small cards should be able to use both.
 *
 * The server re-checks and re-prices everything when the order is placed — this
 * is a convenience, never the authority.
 */
export function GiftCardField({
  codes,
  amountDue,
  currency,
  locale,
  onChange,
}: {
  codes: string[];
  /** Minor units, so the covered amount can be shown before paying. */
  amountDue: number;
  currency: string;
  locale: string;
  onChange: (codes: string[]) => void;
}) {
  const t = useTranslations('checkout');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [covered, setCovered] = useState(0);

  async function add() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/cms/commerce/gift-cards/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        data?: { balance?: number };
      } | null;
      if (!res.ok || !body?.ok) throw new Error(body?.message ?? t('giftCardInvalid'));

      const next = [...new Set([...codes, trimmed])];
      onChange(next);
      setCovered((current) => Math.min(amountDue, current + (body.data?.balance ?? 0)));
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('giftCardInvalid'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-display text-midnight-navy mb-1 text-lg font-semibold">
        {t('giftCardTitle')}
      </legend>
      <div className="flex gap-2">
        <input
          className="border-border-soft focus:border-warm-gold focus:ring-warm-gold w-full rounded-sm border bg-white px-3 py-2 font-mono text-sm tracking-widest uppercase focus:ring-1 focus:outline-none"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          aria-label={t('giftCardCode')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void add()}>
          {t('apply')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="font-body text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {codes.length > 0 ? (
        <p role="status" className="font-body text-text-muted text-sm">
          {t('giftCardApplied', {
            count: codes.length,
            amount: formatPrice(covered / 100, currency, locale),
          })}
        </p>
      ) : null}
    </fieldset>
  );
}
