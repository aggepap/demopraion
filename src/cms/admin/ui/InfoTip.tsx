'use client';

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { cn } from './cn';

/**
 * The "i" that explains an option, in its two shapes.
 *
 * `FieldTip` sits next to a labelled control (a `Field`, a `Checkbox`). It is
 * deliberately NOT focusable: the control already carries the same text through
 * `aria-describedby`, so a screen reader reads it on focus without meeting the
 * icon. A focusable icon beside every field once added dozens of tab stops and
 * made every `getByLabel('Slug')` match twice. The bubble shows on hover of the
 * icon, on focus of the control (`group/field` focus-within on the owning box) and,
 * for touch, on a tap of the icon.
 *
 * `InfoTip` is for places with no control to hang the text on — a column header,
 * a section title, a badge, a legend. There the tip has to be its own button, or
 * keyboard and screen-reader users could never reach it. Its bubble is placed
 * with fixed positioning from the icon's box, because these tips live inside
 * tables and cards that scroll or clip (`overflow-x-auto`), which would cut an
 * absolutely positioned bubble in half.
 */

const ICON =
  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-[10px] leading-none font-semibold text-neutral-600 transition-colors hover:border-neutral-500 hover:text-neutral-800';
const BUBBLE =
  'z-50 w-64 rounded-sm bg-neutral-900 px-2.5 py-1.5 text-left text-xs leading-snug font-normal normal-case tracking-normal whitespace-normal text-neutral-100 shadow-lg';

/** Close when the pointer goes down anywhere outside `ref`. */
function useOutsidePointer(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, ref, close]);
}

/**
 * The icon beside a field label. `id` is the id the control's
 * `aria-describedby` already points at. The bubble is positioned against the
 * nearest `relative` ancestor — the field box — so it starts where the field
 * starts and never overhangs the column (see `Field`).
 */
export function FieldTip({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutsidePointer(open, ref, close);

  return (
    <span ref={ref} className="group/tip inline-flex">
      <span
        aria-hidden="true"
        className={cn(ICON, 'cursor-help')}
        // A tap is the only way a touch user can open it. Inside a checkbox's
        // <label> the click would also toggle the box — the icon explains the
        // option, it must never change it.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        i
      </span>
      <span
        id={id}
        role="tooltip"
        className={cn(
          BUBBLE,
          'pointer-events-none absolute bottom-full left-0 mb-1.5 max-w-full opacity-0 transition-opacity duration-100 group-focus-within/field:opacity-100 group-hover/tip:opacity-100',
          open && 'opacity-100',
        )}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * A standalone, focusable "i" button. Opens on hover, keyboard focus and tap;
 * closes on Escape, blur, leaving it, or a tap elsewhere.
 */
export function InfoTip({
  children,
  label = 'More information',
  className,
}: {
  children: ReactNode;
  /** Accessible name of the button. The tip text itself is its description. */
  label?: string;
  className?: string;
}) {
  const bubbleId = `${useId()}-tip`;
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPinned(false);
  }, []);
  useOutsidePointer(open, wrapRef, close);

  const show = useCallback(() => {
    const box = buttonRef.current?.getBoundingClientRect();
    if (box) {
      const width = Math.min(256, window.innerWidth - 16);
      const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
      // Above the icon when there is room, below it otherwise.
      const above = box.top > 120;
      setStyle({
        position: 'fixed',
        left,
        width,
        ...(above ? { bottom: window.innerHeight - box.top + 6 } : { top: box.bottom + 6 }),
      });
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onMove = () => close();
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close]);

  return (
    <span ref={wrapRef} className={cn('inline-flex align-middle', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={bubbleId}
        aria-expanded={open}
        className={cn(
          ICON,
          'cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold focus-visible:ring-offset-1',
        )}
        onMouseEnter={show}
        onMouseLeave={() => {
          if (!pinned) setOpen(false);
        }}
        onFocus={show}
        onBlur={close}
        onClick={(e) => {
          // Inside a sortable header or a label, the tap is for the tip only.
          e.preventDefault();
          e.stopPropagation();
          if (open && pinned) close();
          else {
            show();
            setPinned(true);
          }
        }}
      >
        i
      </button>
      <span id={bubbleId} role="tooltip" hidden={!open} style={style} className={BUBBLE}>
        {children}
      </span>
    </span>
  );
}
