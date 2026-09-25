'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { QuotedMethod } from '@/cms/modules/commerce';
import { formatPrice } from '@/lib/money';

import { LockerPicker } from './LockerPicker';

/**
 * How the parcel arrives.
 *
 * A radio group, because it is a single choice among a few — and because a
 * radio group is what a keyboard and a screen reader already know how to
 * operate. The quote is re-fetched whenever the address changes, since a
 * different country can mean a different zone, different prices, or nothing at
 * all.
 */
export function ShippingMethodPicker({
  country,
  postal,
  subtotalCents,
  currency,
  locale,
  value,
  locker,
  onChange,
}: {
  country: string;
  postal: string;
  subtotalCents: number;
  currency: string;
  locale: string;
  value: number | null;
  locker: { id: string; name: string } | null;
  onChange: (next: {
    methodId: number | null;
    locker: { id: string; name: string } | null;
  }) => void;
}) {
  const t = useTranslations('checkout');
  const [methods, setMethods] = useState<QuotedMethod[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // An address with no country cannot be quoted; resolved asynchronously so
      // the effect never sets state during its own run.
      if (!country.trim()) {
        if (!cancelled) setMethods(null);
        return;
      }
      try {
        const res = await fetch('/api/cms/commerce/shipping-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country, subtotalCents }),
        });
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          data?: { methods?: QuotedMethod[] };
        } | null;
        if (!cancelled) setMethods(body?.ok ? (body.data?.methods ?? []) : []);
      } catch {
        if (!cancelled) setMethods([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [country, subtotalCents]);

  // No methods defined at all: the shop uses its single shipping calculation,
  // and there is nothing for the customer to choose.
  if (methods === null || methods.length === 0) return null;

  const chosen = methods.find((method) => method.id === value);

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-display text-midnight-navy mb-1 text-lg font-semibold">
        {t('shippingMethod')}
      </legend>
      {methods.map((method) => (
        <label
          key={method.id}
          className="border-border-soft flex cursor-pointer items-center gap-3 rounded-sm border p-3"
        >
          <input
            type="radio"
            name="shipping-method"
            className="accent-warm-gold-deep h-4 w-4"
            checked={value === method.id}
            onChange={() => onChange({ methodId: method.id, locker: null })}
          />
          <span className="flex-1">
            <span className="font-body text-text-primary block text-sm font-medium">
              {method.name}
            </span>
            {method.etaMinDays !== null ? (
              <span className="font-body text-text-muted block text-xs">
                {t('etaDays', {
                  min: method.etaMinDays,
                  max: method.etaMaxDays ?? method.etaMinDays,
                })}
              </span>
            ) : null}
          </span>
          <span className="font-body text-text-primary text-sm">
            {method.cost === 0
              ? t('freeShipping')
              : formatPrice(method.cost / 100, currency, locale)}
          </span>
        </label>
      ))}

      {chosen?.kind === 'locker' ? (
        <LockerPicker
          postal={postal}
          value={locker}
          onChange={(next) => onChange({ methodId: chosen.id, locker: next })}
        />
      ) : null}
    </fieldset>
  );
}
