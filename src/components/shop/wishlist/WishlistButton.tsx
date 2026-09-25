'use client';

import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useWishlist } from './WishlistProvider';

/**
 * The heart on a product card, in quick view and on the product page.
 *
 * A button with `aria-pressed`, not a decorative heart: "saved" is a state a
 * screen reader has to be able to hear, and the icon alone says nothing. It
 * renders nothing at all when the wishlist is off, so callers do not each need
 * to check.
 */
export function WishlistButton({
  productId,
  variationId = '',
  className,
}: {
  productId: number;
  variationId?: string;
  className?: string;
}) {
  const t = useTranslations('wishlist');
  const wishlist = useWishlist();
  if (!wishlist?.enabled) return null;

  const saved = wishlist.has(productId, variationId);
  // A full list still lets you REMOVE — only adding is capped.
  const disabled = !saved && wishlist.full;

  return (
    <button
      type="button"
      onClick={() => wishlist.toggle(productId, variationId)}
      disabled={disabled}
      aria-pressed={saved}
      aria-label={saved ? t('remove') : t('add')}
      title={disabled ? t('full', { max: wishlist.maxItems }) : saved ? t('remove') : t('add')}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
        saved
          ? 'border-warm-gold-deep text-warm-gold-deep'
          : 'border-border-soft text-text-muted hover:border-warm-gold hover:text-warm-gold-deep'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''} ${className ?? ''}`}
    >
      <Heart className="h-4 w-4" aria-hidden fill={saved ? 'currentColor' : 'none'} />
    </button>
  );
}
