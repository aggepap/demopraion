'use client';

import { useId, useRef, type ReactNode } from 'react';

import { cn } from './cn';
import { Icon } from './Icon';
import { useDialog } from './use-dialog';

/**
 * Right-side slide-over panel (replaces the two hand-rolled drawer copies).
 *
 * It is a modal, so it says so: `role="dialog" aria-modal="true"` and a name
 * taken from the visible title. It was two bare `<div>`s for a while, which
 * looked right to a mouse and to nobody else — no announcement, no Escape, and
 * focus left behind on the page the backdrop covers.
 *
 * The behaviour (Escape, focus trap, initial focus, focus restore, scroll-lock)
 * is `useDialog`'s, shared with every other dialog here rather than hand-rolled
 * a seventh time. `open` is a constant because every caller mounts the drawer
 * only while it is open; the hook keys off it for the ones that don't.
 */
export function Drawer({
  title,
  onClose,
  children,
  className,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Generated, not a literal: ReservationsTable mounts a drawer per row, and two
  // panels sharing one id would leave both naming the first one's heading.
  const titleId = useId();
  useDialog({ open: true, onClose, panelRef });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      {/* A mouse-only shortcut. Hidden from assistive tech because the close
          button is the real exit, and an announced full-viewport click target
          sitting over the dialog is noise. */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl',
          className,
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-display text-lg font-semibold text-neutral-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-sm p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
