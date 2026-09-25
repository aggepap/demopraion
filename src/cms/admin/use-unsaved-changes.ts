'use client';

import { useEffect } from 'react';

/**
 * Warn before unsaved work is thrown away.
 *
 * Two handlers, because neither covers the other. `beforeunload` catches leaving
 * the document — reload, closing the tab, an external link — and never fires for
 * navigation inside a single-page router. The capture-phase click handler catches
 * exactly that: a sidebar link, the logo, a breadcrumb.
 *
 * This lived inline in the document editor (F-012, where a sidebar link silently
 * discarded an article). The Settings screen — eight tabs of state, including
 * module and language toggles — had no guard at all, and rather than write a
 * second copy that could drift from the first, both use this.
 *
 * `dirty` is the caller's own judgement of whether anything is unsaved. When it
 * is false nothing is registered, so the common case costs nothing.
 */
export function useUnsavedChangesGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    const onClickCapture = (e: MouseEvent) => {
      // Leave modified clicks alone: they open a new tab or window, so this
      // document — and its unsaved state — stays exactly where it is.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const href = link.getAttribute('href') ?? '';
      // Only guard navigation that actually leaves this screen.
      if (!href.startsWith('/') || href === window.location.pathname) return;
      if (!window.confirm('You have unsaved changes. Leave without saving?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [dirty]);
}
