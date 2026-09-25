'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Link, usePathname, useRouter } from '@/lib/i18n/routing';
import { formatPrice } from '@/lib/money';

interface Suggestion {
  slug: string;
  title: string;
  subtitle?: string;
  price: number;
  currency: string;
  image?: string;
  href: string;
}

/** Search box (with instant-search autocomplete) + sort select for the shop /
 *  category pages. Navigation is via URL query params (server re-renders); page
 *  resets to 1 on any change. */
export function ShopToolbar({ q, sort }: { q: string; sort: string }) {
  const t = useTranslations('shop');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [term, setTerm] = useState(q);

  // Autocomplete suggestions (§6) — debounced fetch, closes on select/blur.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const query = term.trim();
  useEffect(() => {
    // Short queries don't fetch; the render is guarded by the same length check
    // below, so no synchronous clear is needed here.
    if (query.length < 2) return;
    const controller = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/cms/commerce/search?q=${encodeURIComponent(query)}&locale=${locale}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.ok) setSuggestions(d.data as Suggestion[]);
        })
        .catch(() => {
          /* ignore — the full search still works on submit */
        });
    }, 250);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [query, locale]);

  const nav = (updates: Record<string, string>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete('page'); // any filter change returns to the first page
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const control =
    'rounded-sm border border-border-soft bg-white px-3 py-2 font-body text-sm text-text-primary focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div ref={boxRef} className="relative min-w-[220px] flex-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(false);
            nav({ q: term.trim() });
          }}
        >
          <input
            type="search"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={t('searchPlaceholder')}
            aria-autocomplete="list"
            className={`w-full ${control}`}
          />
        </form>
        {open && query.length >= 2 && suggestions.length > 0 ? (
          <ul className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-sm border border-border-soft bg-white shadow-lg">
            {suggestions.map((s) => (
              <li key={s.slug}>
                <Link
                  href={s.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-bone-cream/50"
                >
                  {s.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/cms/media/file/${s.image}`}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <span className="h-10 w-10 shrink-0 rounded-sm bg-bone-cream" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-body text-sm text-text-primary">{s.title}</span>
                    {s.subtitle ? (
                      <span className="block truncate font-body text-xs text-text-muted">{s.subtitle}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-body text-sm text-text-primary">
                    {formatPrice(s.price, s.currency, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <label className="flex items-center gap-2 font-body text-sm text-text-muted">
        {t('sortLabel')}
        <select
          value={sort}
          onChange={(e) => nav({ sort: e.target.value === 'newest' ? '' : e.target.value })}
          className={control}
        >
          <option value="newest">{t('sortNewest')}</option>
          <option value="manual">{t('sortManual')}</option>
          <option value="price-asc">{t('sortPriceAsc')}</option>
          <option value="price-desc">{t('sortPriceDesc')}</option>
          <option value="name">{t('sortName')}</option>
        </select>
      </label>
    </div>
  );
}
