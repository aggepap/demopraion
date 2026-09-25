'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { Icon } from './ui';

/**
 * Open/closed state for the admin navigation on small screens.
 *
 * The sidebar is a fixed 240px column that never collapsed, so every phone
 * viewport scrolled sideways and the collection names were clipped to "Art…".
 * Below `md` it becomes an off-canvas drawer; from `md` up nothing changes.
 *
 * The state lives in context because the layout that renders the sidebar and
 * the top bar is a Server Component, and a server component cannot hand a
 * toggle function to a client one.
 */
const AdminNavContext = createContext<{
  open: boolean;
  toggle: () => void;
  close: () => void;
} | null>(null);

export function AdminNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [openedAt, setOpenedAt] = useState(pathname);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Navigating is the end of the interaction the drawer exists for: leaving it
  // open would cover the page the user just asked for. Adjusted during render
  // rather than in an effect — an effect would paint the new page with the
  // drawer still over it for a frame, and React flags the pattern.
  if (openedAt !== pathname) {
    setOpenedAt(pathname);
    setOpen(false);
  }

  // Escape closes it, like every other dismissible overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return <AdminNavContext.Provider value={{ open, toggle, close }}>{children}</AdminNavContext.Provider>;
}

/** Safe outside the provider: the nav simply behaves as permanently closed. */
export function useAdminNav() {
  return useContext(AdminNavContext) ?? { open: false, toggle: () => {}, close: () => {} };
}

/** Hamburger. Rendered by the top bar; hidden from `md` up. */
export function MobileNavToggle() {
  const { open, toggle } = useAdminNav();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
      aria-expanded={open}
      aria-controls="admin-sidebar"
      className="-ml-1 mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-neutral-600 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold md:hidden"
    >
      <Icon name={open ? 'x' : 'menu'} size={18} />
    </button>
  );
}

/** Dimmed backdrop behind the open drawer. Click closes. */
export function MobileNavBackdrop() {
  const { open, close } = useAdminNav();
  if (!open) return null;
  return (
    <div
      onClick={close}
      aria-hidden="true"
      className="fixed inset-0 z-30 bg-neutral-900/50 md:hidden"
    />
  );
}
