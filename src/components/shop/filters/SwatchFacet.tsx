'use client';

import type { FacetCountValue } from '@/cms/modules/commerce';

/**
 * A colour/image attribute in the shop filters, as swatches with counts.
 *
 * Presentational on purpose — no hooks, no navigation — so the markup can be
 * asserted directly in a test and the URL logic stays in `ShopFilters`.
 *
 * The accessible name carries the count, because "(3)" beside a colour circle
 * is information a screen reader would otherwise read as a stray number, and
 * selection is shown with a check mark as well as a ring: a ring in the brand
 * colour is no distinction at all for anyone who cannot see colour.
 */
export function SwatchFacet({
  name,
  values,
  selected,
  onToggle,
}: {
  name: string;
  values: FacetCountValue[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap gap-2">
      {values.map((value) => {
        const isSelected = selected.includes(value.label);
        // An empty value stays visible so the list does not reshuffle, but it
        // cannot be chosen: the result would be a page with no products.
        const disabled = value.count === 0 && !isSelected;
        return (
          <button
            key={value.label}
            type="button"
            onClick={() => onToggle(value.label)}
            disabled={disabled}
            title={`${value.label} (${value.count})`}
            aria-label={`${value.label} (${value.count})`}
            aria-pressed={isSelected}
            className={`relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white bg-cover bg-center ${
              isSelected
                ? 'ring-warm-gold-deep ring-2 ring-offset-1'
                : 'ring-border-soft hover:ring-warm-gold ring-1'
            } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
            style={{
              backgroundColor: value.color,
              backgroundImage: value.image ? `url(${value.image})` : undefined,
            }}
          >
            {isSelected ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="h-4 w-4 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 8.5 6.5 12 13 4.5" />
              </svg>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
