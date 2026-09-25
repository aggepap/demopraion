'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import type { FacetWithCounts } from '@/cms/modules/commerce';
import { usePathname, useRouter } from '@/lib/i18n/routing';

import { PriceRangeSlider } from './filters/PriceRangeSlider';
import { SwatchFacet } from './filters/SwatchFacet';
import { clampRange, rangeToParams, type PriceBounds } from './filters/price-range';

/** A number the slider can use, or undefined for an empty or unreadable box. */
function numberOrUndefined(raw: string): number | undefined {
  const value = Number(raw.trim());
  return raw.trim() !== '' && Number.isFinite(value) ? value : undefined;
}

/** A selectable tag: the slug goes in the URL, the title labels the checkbox. */
export interface TagOption {
  slug: string;
  title: string;
}

/** Price-range + attribute + tag filters for the shop / category pages.
 *  Navigation is via URL query params (`price_min`, `price_max`,
 *  `attr_<name>=v1,v2`, `tag=slug1,slug2`). */
export function ShopFilters({
  facets,
  selected,
  minPrice,
  maxPrice,
  currency,
  locale,
  bounds = null,
  priceControl = 'fields',
  tags = [],
  selectedTags = [],
}: {
  facets: FacetWithCounts[];
  selected: Record<string, string[]>;
  minPrice: string;
  maxPrice: string;
  currency: string;
  locale?: string;
  /** Cheapest/dearest in the current list; `null` hides the slider. */
  bounds?: PriceBounds | null;
  /** `Settings → Ecommerce → Price filter`. */
  priceControl?: 'slider' | 'fields';
  /** Tags present in the current product set (§6). Empty hides the group. */
  tags?: TagOption[];
  selectedTags?: string[];
}) {
  const t = useTranslations('shop');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [min, setMin] = useState(minPrice);
  const [max, setMax] = useState(maxPrice);

  const hasActive =
    !!minPrice ||
    !!maxPrice ||
    selectedTags.length > 0 ||
    Object.values(selected).some((v) => v.length > 0);

  const nav = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(sp.toString());
    mutate(params);
    params.delete('page');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const applyPrice = () =>
    nav((params) => {
      if (min.trim()) params.set('price_min', min.trim());
      else params.delete('price_min');
      if (max.trim()) params.set('price_max', max.trim());
      else params.delete('price_max');
    });

  const toggleAttr = (name: string, value: string) =>
    nav((params) => {
      const key = `attr_${name}`;
      const cur = (params.get(key) ?? '').split(',').filter(Boolean);
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      if (next.length) params.set(key, next.join(','));
      else params.delete(key);
    });

  const toggleTag = (slug: string) =>
    nav((params) => {
      const cur = (params.get('tag') ?? '').split(',').filter(Boolean);
      const next = cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug];
      if (next.length) params.set('tag', next.join(','));
      else params.delete('tag');
    });

  const clearAll = () => {
    setMin('');
    setMax('');
    nav((params) => {
      for (const k of [...params.keys()]) {
        if (k.startsWith('attr_') || k === 'price_min' || k === 'price_max' || k === 'tag') {
          params.delete(k);
        }
      }
    });
  };

  const control =
    'w-full rounded-sm border border-border-soft bg-white px-2.5 py-1.5 font-body text-sm text-text-primary focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-midnight-navy">{t('filters')}</h2>
        {hasActive ? (
          <button
            type="button"
            onClick={clearAll}
            className="font-body text-xs text-text-muted hover:text-warm-gold-deep"
          >
            {t('clearFilters')}
          </button>
        ) : null}
      </div>

      {/* Price */}
      <div className="flex flex-col gap-2">
        <span className="font-body text-sm font-medium text-text-primary">
          {t('price')} ({currency})
        </span>
        {/*
         * The slider is an addition, never a replacement: the from/to boxes
         * below stay in the page whatever the setting says, so the filter is
         * always operable by keyboard and always states its values as text.
         */}
        {priceControl === 'slider' && bounds && bounds.max > bounds.min ? (
          <PriceRangeSlider
            bounds={bounds}
            value={clampRange({ min: numberOrUndefined(min), max: numberOrUndefined(max) }, bounds)}
            currency={currency}
            locale={locale}
            labels={{ min: t('min'), max: t('max') }}
            onCommit={(range) => {
              const params = rangeToParams(range, bounds);
              setMin(params.price_min ?? '');
              setMax(params.price_max ?? '');
              nav((sp2) => {
                for (const [key, value] of Object.entries(params)) {
                  if (value === null) sp2.delete(key);
                  else sp2.set(key, value);
                }
              });
            }}
          />
        ) : null}
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            inputMode="decimal"
            placeholder={t('min')}
            value={min}
            onChange={(e) => setMin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyPrice()}
            className={control}
          />
          <span className="text-text-muted">–</span>
          <input
            type="number"
            min={0}
            inputMode="decimal"
            placeholder={t('max')}
            value={max}
            onChange={(e) => setMax(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyPrice()}
            className={control}
          />
        </div>
        <button
          type="button"
          onClick={applyPrice}
          className="w-fit rounded-sm border border-border-soft px-3 py-1.5 font-body text-xs hover:border-warm-gold hover:text-warm-gold-deep"
        >
          {t('apply')}
        </button>
      </div>

      {/* Tags (§6) — slugs in the URL, titles on the labels. */}
      {tags.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="font-body text-sm font-medium text-text-primary">{t('tags')}</span>
          <ul className="flex flex-col gap-1.5">
            {tags.map((tag) => (
              <li key={tag.slug}>
                <label className="flex cursor-pointer items-center gap-2 font-body text-sm text-text-primary">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-warm-gold-deep"
                    checked={selectedTags.includes(tag.slug)}
                    onChange={() => toggleTag(tag.slug)}
                  />
                  {tag.title}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Attributes */}
      {facets.map((facet) => (
        <div key={facet.name} className="flex flex-col gap-2">
          <span className="font-body text-sm font-medium text-text-primary">{facet.name}</span>
          {facet.display === 'swatches' ? (
            <SwatchFacet
              name={facet.name}
              values={facet.values}
              selected={selected[facet.name] ?? []}
              onToggle={(value) => toggleAttr(facet.name, value)}
            />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {facet.values.map((value) => {
                const checked = selected[facet.name]?.includes(value.label) ?? false;
                // Kept visible at zero so the list does not reshuffle as
                // choices change; unpickable because it would empty the page.
                const disabled = value.count === 0 && !checked;
                return (
                  <li key={value.label}>
                    <label
                      className={`flex items-center gap-2 font-body text-sm text-text-primary ${
                        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-warm-gold-deep"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleAttr(facet.name, value.label)}
                      />
                      {value.label}
                      <span className="text-text-muted">({value.count})</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
