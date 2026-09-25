'use client';

import { useEffect, useRef, useState } from 'react';

import { formatPrice } from '@/lib/money';

import { clampRange, positionPercent, stepFromKey, type PriceBounds } from './price-range';

/**
 * A two-handle price slider.
 *
 * Each handle is its own focusable `role="slider"`, which is what makes the
 * control usable without a pointer: one element with two thumbs can be dragged
 * but never tabbed to. Dragging reports only on release (`onCommit`), so a
 * drag across the track is one navigation rather than one per pixel; the
 * keyboard commits on each press, which is what a screen-reader user needs to
 * hear the result.
 *
 * The number inputs in `ShopFilters` stay as they are — this sits above them.
 */
export function PriceRangeSlider({
  bounds,
  value,
  currency,
  locale = 'el',
  labels,
  onCommit,
}: {
  bounds: PriceBounds;
  value: PriceBounds;
  currency: string;
  locale?: string;
  labels: { min: string; max: string };
  onCommit: (range: PriceBounds) => void;
}) {
  const committed = clampRange(value, bounds);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'min' | 'max' | null>(null);

  /*
   * The URL is the truth; `draft` is only what the handle shows between a drag
   * (or key press) and the page coming back with the new list. Without it the
   * handle would snap back to its old place for as long as the navigation took.
   * It is dropped the moment the committed value changes — React's documented
   * "adjust state when a prop changes" pattern, which is why the comparison
   * happens during render rather than in an effect.
   */
  const [draft, setDraft] = useState<PriceBounds | null>(null);
  const [seen, setSeen] = useState(committed);
  if (seen.min !== committed.min || seen.max !== committed.max) {
    setSeen(committed);
    if (draft !== null) setDraft(null);
  }
  const range = draft ?? committed;

  /** A handle's new position, with the two never crossing. */
  const withHandle = (current: PriceBounds, handle: 'min' | 'max', next: number): PriceBounds =>
    handle === 'min'
      ? clampRange({ min: Math.min(next, current.max), max: current.max }, bounds)
      : clampRange({ min: current.min, max: Math.max(next, current.min) }, bounds);

  const valueFromPointer = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return bounds.min;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return bounds.min;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(bounds.min + ratio * (bounds.max - bounds.min));
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMove = (e: PointerEvent) => {
      const handle = dragging.current;
      if (!handle) return;
      setDraft((cur) => withHandle(cur ?? committed, handle, valueFromPointer(e.clientX)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = null;
      // Report on release, so one drag is one navigation rather than one per pixel.
      setDraft((cur) => {
        if (cur) onCommit(cur);
        return cur;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });

  const handleKey = (handle: 'min' | 'max') => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = stepFromKey(handle === 'min' ? range.min : range.max, e.key, bounds);
    if (next === null) return;
    // Only keys the slider actually uses are swallowed, so Tab still moves on.
    e.preventDefault();
    const updated = withHandle(range, handle, next);
    setDraft(updated);
    onCommit(updated);
  };

  const handle = (which: 'min' | 'max') => {
    const current = which === 'min' ? range.min : range.max;
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={labels[which]}
        aria-valuemin={which === 'min' ? bounds.min : range.min}
        aria-valuemax={which === 'min' ? range.max : bounds.max}
        aria-valuenow={current}
        aria-valuetext={formatPrice(current, currency, locale)}
        onKeyDown={handleKey(which)}
        onPointerDown={(e) => {
          dragging.current = which;
          e.currentTarget.focus();
        }}
        style={{ left: `${positionPercent(current, bounds)}%` }}
        className="border-warm-gold-deep focus-visible:ring-warm-gold absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border bg-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      />
    );
  };

  const from = positionPercent(range.min, bounds);
  const to = positionPercent(range.max, bounds);

  return (
    <div className="flex flex-col gap-2">
      <div ref={trackRef} className="relative h-4 w-full touch-none select-none">
        <div className="bg-border-soft absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full" />
        <div
          className="bg-warm-gold-deep absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
          style={{ left: `${from}%`, width: `${Math.max(0, to - from)}%` }}
        />
        {handle('min')}
        {handle('max')}
      </div>
      <div className="font-body text-text-muted flex justify-between text-xs">
        <span>{formatPrice(range.min, currency, locale)}</span>
        <span>{formatPrice(range.max, currency, locale)}</span>
      </div>
    </div>
  );
}
