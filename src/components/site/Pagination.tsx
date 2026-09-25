'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { usePathname, useRouter } from '@/lib/i18n/routing';

/**
 * Paginator — preserves the current search/sort query params.
 *
 * `namespace` defaults to `shop` for the storefront that has always used it.
 * Booking passes its own, so its pager does not depend on commerce's strings
 * still existing when commerce is switched off.
 */
export function Pagination({
  page,
  pageCount,
  namespace = 'shop',
}: {
  page: number;
  pageCount: number;
  namespace?: string;
}) {
  const t = useTranslations(namespace);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  if (pageCount <= 1) return null;

  const go = (p: number) => {
    const params = new URLSearchParams(sp.toString());
    if (p <= 1) params.delete('page');
    else params.set('page', String(p));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const btn =
    'rounded-sm border border-border-soft px-4 py-2 font-body text-sm transition-colors hover:border-warm-gold disabled:opacity-40 disabled:hover:border-border-soft';

  return (
    <div className="mt-12 flex items-center justify-center gap-4">
      <button type="button" disabled={page <= 1} onClick={() => go(page - 1)} className={btn}>
        {t('prev')}
      </button>
      <span className="font-body text-sm text-text-muted">{t('pageOf', { page, count: pageCount })}</span>
      <button type="button" disabled={page >= pageCount} onClick={() => go(page + 1)} className={btn}>
        {t('next')}
      </button>
    </div>
  );
}
