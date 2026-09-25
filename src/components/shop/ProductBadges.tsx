import { useTranslations } from 'next-intl';

import type { ProductBadge } from '@/cms/modules/commerce';

/**
 * Merchandising badges (Sale / New / Bestseller / a custom label). Server-safe:
 * `useTranslations` works in server components, and every caller here is one.
 * `sale` is derived from the compare-at price in the read layer, so it can't
 * contradict the displayed price.
 */

const TONE: Record<ProductBadge['kind'], string> = {
  sale: 'bg-warm-gold-deep text-white',
  new: 'bg-midnight-navy text-white',
  bestseller: 'bg-white text-midnight-navy ring-1 ring-border-soft',
  custom: 'bg-white text-warm-gold-deep ring-1 ring-warm-gold',
};

export function ProductBadges({
  badges,
  className = '',
}: {
  badges: ProductBadge[];
  className?: string;
}) {
  const t = useTranslations('shop');
  if (badges.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {badges.map((badge, i) => (
        <span
          key={`${badge.kind}-${i}`}
          className={`inline-flex items-center rounded-sm px-2 py-0.5 font-body text-[11px] font-medium uppercase tracking-wide ${TONE[badge.kind]}`}
        >
          {badge.kind === 'custom' ? badge.label : t(`badges.${badge.kind}`)}
        </span>
      ))}
    </div>
  );
}
