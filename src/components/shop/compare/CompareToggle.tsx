'use client';

import { useTranslations } from 'next-intl';

import { useCompare } from '@/components/shop/compare/CompareProvider';

/** A small "compare" checkbox chip overlaid on a product card. */
export function CompareToggle({ slug, title }: { slug: string; title: string }) {
  const t = useTranslations('shop');
  const { has, toggle, full } = useCompare();
  const active = has(slug);
  const disabled = !active && full;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) toggle({ slug, title });
      }}
      disabled={disabled}
      aria-pressed={active}
      title={disabled ? t('compareFull') : t('compare')}
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 font-body text-[11px] font-medium shadow-sm transition-colors ${
        active
          ? 'bg-warm-gold-deep text-white'
          : 'bg-white/95 text-midnight-navy hover:bg-white disabled:opacity-40'
      }`}
    >
      <span
        aria-hidden
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border ${
          active ? 'border-white bg-white/20' : 'border-border-soft'
        }`}
      >
        {active ? '✓' : ''}
      </span>
      {t('compare')}
    </button>
  );
}
