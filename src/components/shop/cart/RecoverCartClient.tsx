'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { localePrefix } from '@/cms/core/paths';
import { defaultLocale } from '@/lib/i18n/config';
import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * Restores a cart from an abandoned-cart recovery link (addendum §9). Reads the
 * `token`, fetches the stored cart, writes it into the cart's localStorage key,
 * then does a FULL navigation to checkout so the persistent `CartProvider`
 * re-hydrates from storage (a client push wouldn't remount it).
 */
const CART_KEY = STORAGE_KEYS.cart;

export function RecoverCartClient({ locale }: { locale: string }) {
  const t = useTranslations('cart');
  const sp = useSearchParams();
  const token = sp.get('token') ?? '';
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/cms/commerce/abandoned-cart?token=${encodeURIComponent(token)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        const items = d?.ok && Array.isArray(d.data?.items) ? d.data.items : [];
        if (items.length === 0) {
          setFailed(true);
          return;
        }
        try {
          localStorage.setItem(CART_KEY, JSON.stringify(items));
        } catch {
          /* ignore quota / private-mode */
        }
        // Full reload so CartProvider hydrates the restored cart.
        window.location.href = new URL(
          `${localePrefix(locale, defaultLocale)}/checkout`,
          window.location.origin,
        ).href;
      })
      .catch(() => setFailed(true));
    return () => controller.abort();
  }, [token, locale]);

  return (
    <section className="bg-soft-pearl pt-28 pb-24">
      <div className="mx-auto max-w-xl px-6 text-center">
        <p className="font-body text-base text-text-muted">
          {failed ? t('empty') : `${t('title')}…`}
        </p>
      </div>
    </section>
  );
}
