'use client';

import { ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useCart } from './CartProvider';

/** Header cart button with an item-count badge. Rendered only when commerce is
 *  enabled (the Header gates it). */
export function CartButton() {
  const t = useTranslations('cart');
  const { count, open } = useCart();

  return (
    <button
      type="button"
      onClick={open}
      aria-label={t('open')}
      className="relative p-2 -m-2 text-midnight-navy hover:text-warm-gold-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold rounded-sm"
    >
      <ShoppingBag className="h-6 w-6" aria-hidden />
      {count > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warm-gold px-1 text-[10px] font-semibold text-midnight-navy">
          {count}
        </span>
      ) : null}
    </button>
  );
}
