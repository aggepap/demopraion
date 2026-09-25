'use client';

import { useTranslations } from 'next-intl';

import { useCompare } from '@/components/shop/compare/CompareProvider';
import { Link } from '@/lib/i18n/routing';

/** Floating bar showing the current comparison selection + a link to the table. */
export function CompareTray() {
  const t = useTranslations('shop');
  const { items, remove, clear } = useCompare();
  if (items.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border-soft bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-6 py-3">
        <span className="font-body text-sm font-medium text-midnight-navy">
          {t('compareTitle')} ({items.length})
        </span>
        <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {items.map((i) => (
            <li
              key={i.slug}
              className="inline-flex items-center gap-1 rounded-sm bg-bone-cream px-2 py-1 font-body text-xs text-text-primary"
            >
              <span className="max-w-[10rem] truncate">{i.title}</span>
              <button
                type="button"
                onClick={() => remove(i.slug)}
                aria-label={t('remove')}
                className="text-text-muted hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={clear} className="font-body text-xs text-text-muted hover:text-red-600">
          {t('clear')}
        </button>
        <Link
          href="/shop/compare"
          className={`rounded-sm px-4 py-2 font-body text-sm font-medium text-white ${
            items.length >= 2 ? 'bg-warm-gold-deep hover:opacity-90' : 'pointer-events-none bg-neutral-300'
          }`}
        >
          {t('compareNow')}
        </Link>
      </div>
    </div>
  );
}
