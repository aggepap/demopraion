'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { choosePopup, popupPagePath, shouldShowAgain, type PopupRecord } from '@/cms/modules/popups/policy';
import type { PopupDesign } from '@/cms/modules/popups/presets';
import { useConsent } from '@/components/layout/CookieBanner';
import { locales } from '@/lib/i18n/config';
import { STORAGE_KEYS } from '@/lib/storage-keys';

import { PopupDialog } from './PopupDialog';

/**
 * Decides which popup this visitor sees, and when.
 *
 * Three rules that matter more than the popup does:
 *
 * - **Never before the cookie banner.** A visitor who has not answered the
 *   banner is looking at a decision we asked them to make; covering it with a
 *   discount is both rude and a consent problem.
 * - **One at a time**, chosen by priority — two dialogs is a broken page.
 * - **Fixed positioning only**, so nothing the page has already laid out moves
 *   (a popup that shifts the article under it is a Core Web Vitals failure as
 *   well as an annoyance).
 */

export interface PopupView {
  record: PopupRecord;
  title: string;
  body: ReactNode;
  image: string | null;
  buttonLabel: string;
  buttonUrl: string;
  position: string;
  size: string;
  design: PopupDesign;
  trigger: string;
  triggerValue: number;
}

// Named with the rest of the site's browser keys, so the cookie declaration lists it.
const SEEN_KEY = STORAGE_KEYS.popupSeen;

function readSeen(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function markSeen(id: number): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...readSeen(), [id]: Date.now() }));
  } catch {
    /* private mode: the popup simply shows again next time */
  }
}

function track(popupId: number, metric: 'impression' | 'click' | 'close'): void {
  void fetch('/api/cms/popups/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ popupId, metric }),
  }).catch(() => null);
}

export function PopupRuntime({ popups }: { popups: PopupView[] }) {
  const pathname = usePathname();
  const consent = useConsent();
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    /*
     * The banner is still on screen (or still loading): whatever this popup
     * is, it can wait. `undecided` is exactly the state where the visitor is
     * looking at a decision we asked them to make.
     */
    if (consent === 'loading' || consent === 'undecided') return;
    if (popups.length === 0) return;

    const seen = readSeen();
    const now = new Date();
    const chosen = choosePopup(
      popups.map((popup) => popup.record),
      // Targets are written without the locale segment (`/shop` means every language).
      { path: popupPagePath(pathname, locales) },
      now,
      (record) => {
        const last = seen[record.id];
        return shouldShowAgain(record.frequency, last ? new Date(last) : null, now);
      }
    );
    if (!chosen) return;

    const view = popups.find((popup) => popup.record.id === chosen.id);
    if (!view) return;

    const show = () => {
      setOpenId(chosen.id);
      markSeen(chosen.id);
      track(chosen.id, 'impression');
    };

    // Every trigger resolves to "later", never during this render.
    if (view.trigger === 'load') {
      const timer = setTimeout(show, 0);
      return () => clearTimeout(timer);
    }
    if (view.trigger === 'scroll') {
      const wanted = Math.min(100, Math.max(1, view.triggerValue || 50));
      const onScroll = () => {
        const height = document.body.scrollHeight - window.innerHeight;
        const percent = height > 0 ? (window.scrollY / height) * 100 : 100;
        if (percent >= wanted) {
          window.removeEventListener('scroll', onScroll);
          show();
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      return () => window.removeEventListener('scroll', onScroll);
    }
    if (view.trigger === 'exit') {
      // Desktop only: there is no "pointer left the window" on a touch screen,
      // and faking one with a scroll-up gesture is how popups get a bad name.
      const onLeave = (event: MouseEvent) => {
        if (event.clientY <= 0) {
          document.removeEventListener('mouseout', onLeave);
          show();
        }
      };
      document.addEventListener('mouseout', onLeave);
      return () => document.removeEventListener('mouseout', onLeave);
    }
    const delay = Math.max(0, (view.triggerValue || 5) * 1000);
    const timer = setTimeout(show, delay);
    return () => clearTimeout(timer);
  }, [popups, pathname, consent]);

  const open = popups.find((popup) => popup.record.id === openId);
  if (!open) return null;

  return (
    <PopupDialog
      view={open}
      onClose={() => {
        track(open.record.id, 'close');
        setOpenId(null);
      }}
      onAction={() => track(open.record.id, 'click')}
    />
  );
}
