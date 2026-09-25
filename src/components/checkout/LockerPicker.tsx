'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { Locker } from '@/cms/modules/commerce';

/**
 * Choosing a BoxNow locker.
 *
 * A searchable list rather than a map, and deliberately so: a map means an
 * embedded third-party tile service, which means a request to somebody else's
 * server with the visitor's IP address before they have agreed to anything.
 * The list is keyboard-operable, works on a slow connection, and is the thing
 * most people actually use — they know their own neighbourhood.
 *
 * The lockers come from our own endpoint, which caches BoxNow's list for a day.
 */
export function LockerPicker({
  postal,
  value,
  onChange,
}: {
  postal: string;
  value: { id: string; name: string } | null;
  onChange: (locker: { id: string; name: string } | null) => void;
}) {
  const t = useTranslations('checkout');
  const [search, setSearch] = useState(postal);
  const [lockers, setLockers] = useState<Locker[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/cms/commerce/lockers?postal=${encodeURIComponent(search)}`);
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          data?: { lockers?: Locker[] };
        } | null;
        if (!cancelled) setLockers(body?.ok ? (body.data?.lockers ?? []) : []);
      } catch {
        if (!cancelled) setLockers([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [search]);

  return (
    <div className="border-border-soft flex flex-col gap-2 rounded-sm border p-3">
      <label className="font-body text-text-primary text-sm font-medium" htmlFor="locker-search">
        {t('chooseLocker')}
      </label>
      <input
        id="locker-search"
        inputMode="numeric"
        placeholder={t('postal')}
        className="border-border-soft focus:border-warm-gold focus:ring-warm-gold w-full rounded-sm border bg-white px-3 py-2 text-sm focus:ring-1 focus:outline-none"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {lockers === null ? (
        <p className="font-body text-text-muted text-sm">{t('loadingLockers')}</p>
      ) : lockers.length === 0 ? (
        <p className="font-body text-text-muted text-sm">{t('noLockers')}</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto">
          {lockers.map((locker) => (
            <li key={locker.id}>
              <label className="flex cursor-pointer items-start gap-2 py-1.5">
                <input
                  type="radio"
                  name="locker"
                  className="accent-warm-gold-deep mt-1 h-4 w-4"
                  checked={value?.id === locker.id}
                  onChange={() => onChange({ id: locker.id, name: locker.name })}
                />
                <span className="font-body text-text-primary text-sm">
                  {locker.name}
                  <span className="text-text-muted block text-xs">
                    {locker.address} {locker.postal}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
