'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Modal dialog behaviour, in one place.
 *
 * Six components in this codebase render `role="dialog" aria-modal="true"` and
 * each had hand-rolled a different subset of the required behaviour — some had
 * Escape, some scroll-lock, some initial focus, none had a focus trap or focus
 * restore, and the two admin dialogs had drifted to binding `keydown` on
 * `document` while the site ones used `window`. `aria-modal` is a promise to
 * assistive tech that the rest of the page is inert; without a trap it is a lie,
 * and Tab walks straight out of the dialog into the page behind it.
 *
 * Pass the panel element (not the backdrop) as `panelRef` — the trap and the
 * initial-focus search are scoped to it.
 *
 * Works for dialogs that unmount when closed *and* for ones that stay mounted
 * behind a `visibility`/`opacity` toggle (CartDrawer), which is why every effect
 * keys off `open` rather than off mount.
 */

/* `:not([disabled])` filters the obvious dead entries; `tabindex="-1"` is
 * excluded because it means "focusable but not tabbable". */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function tabbable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // A hidden element still matches the selector but cannot take focus, which
    // would leave the trap cycling onto nothing.
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
  );
}

export interface UseDialogOptions {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  /** Opt out of the body scroll-lock (rare — a non-blocking popover). */
  lockScroll?: boolean;
  /** Where focus should land on open. Defaults to the first tabbable element;
   *  set it when the useful control is not the first one (ConfirmDialog wants
   *  the decision button, not Cancel). */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function useDialog({
  open,
  onClose,
  panelRef,
  lockScroll = true,
  initialFocusRef,
}: UseDialogOptions): void {
  // Escape + Tab trap share one listener so their ordering is unambiguous.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = tabbable(panel);
      if (items.length === 0) {
        // Nothing to tab to — keep focus on the panel rather than letting it
        // escape to the page behind.
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (active instanceof Node && !panel.contains(active)) {
        // Focus started outside (e.g. the dialog stayed mounted): pull it back.
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose, panelRef]);

  useEffect(() => {
    if (!open || !lockScroll) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open, lockScroll]);

  // Initial focus + restore. Captured in a ref rather than derived on close, so
  // the element is the one that actually opened the dialog even if the DOM moved.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const wanted = initialFocusRef?.current;
    if (wanted) wanted.focus();
    else {
      const panel = panelRef.current;
      if (panel) {
        const items = tabbable(panel);
        if (items.length > 0) items[0].focus();
        else {
          // Needs to be programmatically focusable for the announcement to land.
          if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
          panel.focus();
        }
      }
    }

    return () => {
      // `isConnected` guards the case where the opener itself was removed by the
      // dialog's own action (e.g. deleting the row its trigger lived in).
      const el = opener.current;
      if (el && el.isConnected) el.focus();
      opener.current = null;
    };
  }, [open, panelRef, initialFocusRef]);
}
