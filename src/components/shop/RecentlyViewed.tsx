'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { ProductCard, type ProductCardData } from '@/components/shop/ProductCard';
import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * "Recently viewed" strip (addendum §6). Client-only: on mount it records the
 * current product in localStorage (a capped, de-duplicated MRU list) and shows
 * the previously-viewed products. Purely a browser convenience — nothing is
 * sent to the server, so it needs no personalization backend.
 */

const STORAGE_KEY = STORAGE_KEYS.recentlyViewed;
const MAX = 8;

type RecentItem = ProductCardData;

function readList(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function RecentlyViewed({ current, locale }: { current: RecentItem; locale: string }) {
  const t = useTranslations('shop');
  const [others, setOthers] = useState<RecentItem[]>([]);

  useEffect(() => {
    // Reading a browser store + recording the visit is exactly what an effect
    // is for; the visible list is everything seen *before* this product. This
    // one-shot post-mount sync matches the cart's localStorage hydration (a
    // lazy initializer would mismatch the SSR-empty render).
    const prior = readList();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOthers(prior.filter((i) => i.slug !== current.slug).slice(0, MAX));
    const next = [current, ...prior.filter((i) => i.slug !== current.slug)].slice(0, MAX);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [current]);

  if (others.length === 0) return null;

  return (
    <section className="mt-16 max-w-7xl">
      <h2 className="mb-6 font-display text-2xl font-semibold text-midnight-navy">{t('recentlyViewed')}</h2>
      <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 xl:grid-cols-4">
        {others.map((product) => (
          <ProductCard key={product.slug} product={product} locale={locale} />
        ))}
      </ul>
    </section>
  );
}
