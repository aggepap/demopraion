'use client';

import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/lib/i18n/routing';

import { useWishlist } from './WishlistProvider';

/** The header's wishlist link, with how many things are on it. */
export function WishlistCount() {
  const t = useTranslations('wishlist');
  const wishlist = useWishlist();
  if (!wishlist?.enabled) return null;

  return (
    <Link
      href="/wishlist"
      className="text-text-primary hover:text-warm-gold-deep relative -m-2 p-2 transition-colors"
      // The count is in the name, not only in the badge: a screen reader
      // otherwise announces "wishlist" and never says it has anything in it.
      aria-label={t('countLabel', { count: wishlist.count })}
    >
      <Heart className="h-5 w-5" aria-hidden />
      {wishlist.count > 0 ? (
        <span
          aria-hidden
          className="bg-warm-gold-deep absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium text-white"
        >
          {wishlist.count}
        </span>
      ) : null}
    </Link>
  );
}
