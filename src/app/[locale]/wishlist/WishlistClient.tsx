'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { WishlistEntry } from '@/cms/modules/commerce';
import { useCart } from '@/components/shop/cart/CartProvider';
import { useWishlist } from '@/components/shop/wishlist/WishlistProvider';
import { Button } from '@/components/ui/Button';
import { Link } from '@/lib/i18n/routing';
import { formatPrice } from '@/lib/money';

/**
 * The wishlist page.
 *
 * The saved ids come from the provider; prices and stock are fetched fresh on
 * every visit, so nothing here can show a price the shop has stopped charging.
 * Anything unpublished or deleted simply does not come back and is quietly
 * dropped — a list of things nobody can buy is worse than a shorter list.
 */
export function WishlistClient({ locale }: { locale: string }) {
  const t = useTranslations('wishlist');
  const wishlist = useWishlist();
  const cart = useCart();
  /*
   * One state keyed by the list itself. When the saved items change, the key
   * changes and the state is reset during render — React's documented
   * "adjust state when a prop changes" pattern — so the effect only ever sets
   * state after an await, never synchronously.
   */
  const key = JSON.stringify(wishlist?.items ?? []);
  const [state, setState] = useState<{
    key: string;
    status: 'loading' | 'ready' | 'failed';
    entries: WishlistEntry[];
  }>({ key, status: 'loading', entries: [] });
  if (state.key !== key) setState({ key, status: 'loading', entries: [] });

  useEffect(() => {
    const items = JSON.parse(key) as { productId: number; variationId: string }[];
    let cancelled = false;
    const load = async () => {
      if (items.length === 0) {
        if (!cancelled) setState({ key, status: 'ready', entries: [] });
        return;
      }
      try {
        const res = await fetch('/api/cms/wishlist/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, locale }),
        });
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          data?: { items?: WishlistEntry[] };
        } | null;
        if (cancelled) return;
        if (body?.ok && body.data?.items) {
          setState({ key, status: 'ready', entries: body.data.items });
        } else {
          setState({ key, status: 'failed', entries: [] });
        }
      } catch {
        if (!cancelled) setState({ key, status: 'failed', entries: [] });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [key, locale]);

  if (!wishlist?.enabled) return null;

  if (state.status === 'failed') {
    return (
      <p role="alert" className="font-body text-text-muted text-sm">
        {t('loadFailed')}
      </p>
    );
  }

  if (state.status === 'loading') {
    return (
      <p role="status" className="font-body text-text-muted text-sm">
        {t('loading')}
      </p>
    );
  }

  if (state.entries.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="font-body text-text-muted text-sm">{t('empty')}</p>
        <Link href="/shop" className="text-warm-gold-deep font-body text-sm underline">
          {t('browseShop')}
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {state.entries.map((entry) => (
        <li
          key={`${entry.productId}:${entry.variationId}`}
          className="border-border-soft flex flex-wrap items-center gap-4 rounded-sm border bg-white p-4"
        >
          {entry.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- the URL is a CMS media route, not a static asset
            <img src={entry.image} alt="" className="h-16 w-16 rounded-sm object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <Link href={entry.href} className="font-body text-text-primary text-sm font-medium">
              {entry.title}
            </Link>
            <p className="font-body text-text-muted text-sm">
              {formatPrice(entry.price, entry.currency, locale)}
              {entry.availability === 'out-of-stock' ? ` — ${t('outOfStock')}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={entry.availability === 'out-of-stock'}
              onClick={() => {
                cart.addItem(
                  {
                    slug: entry.slug,
                    title: entry.title,
                    unitPrice: entry.price,
                    currency: entry.currency,
                    imageUrl: entry.image,
                    variationId: entry.variationId || undefined,
                    locale,
                  },
                  1
                );
                wishlist.remove(entry.productId, entry.variationId);
              }}
            >
              {t('moveToCart')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => wishlist.remove(entry.productId, entry.variationId)}
            >
              {t('remove')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
