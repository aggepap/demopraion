'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { ButtonLink } from '@/components/ui/Button';

import type { PopupView } from './PopupRuntime';

/**
 * The popup itself, drawn in whichever design was chosen.
 *
 * It is a real dialog: `aria-modal`, a label, focus moved into it and returned
 * where it came from, Escape to close, and Tab kept inside while it is open. A
 * div that merely looks like a dialog traps a keyboard user behind content they
 * cannot reach or dismiss.
 *
 * The colours arrive already validated as hex (see `presets.ts`) — this file
 * puts them into `style` and nothing else, so a colour field can never become
 * a way to write CSS.
 *
 * Every position is `fixed`, so opening one never moves the page underneath.
 */

const SIZES: Record<string, string> = {
  s: 'max-w-sm',
  m: 'max-w-md',
  l: 'max-w-xl',
};

const POSITIONS: Record<string, string> = {
  center: 'inset-0 flex items-center justify-center p-4',
  'bottom-bar': 'inset-x-0 bottom-0 flex justify-center p-4',
  'top-bar': 'inset-x-0 top-0 flex justify-center p-4',
  'bottom-right': 'right-4 bottom-4 flex justify-end',
};

export function PopupDialog({
  view,
  onClose,
  onAction,
}: {
  view: PopupView;
  onClose: () => void;
  onAction: () => void;
}) {
  const t = useTranslations('ui');
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { design } = view;
  const layout = design.preset.layout;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      // Keep Tab inside: the page behind is inert while this is open.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Back where they were, not to the top of the document.
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  /* The full-screen design fills the viewport whatever position was chosen;
     the bar designs sit along an edge; everything else is a centred card. */
  const position =
    layout === 'takeover'
      ? POSITIONS.center
      : layout === 'bar'
        ? POSITIONS['bottom-bar']
        : layout === 'corner'
          ? POSITIONS['bottom-right']
          : (POSITIONS[view.position] ?? POSITIONS.center);

  const overlay = layout === 'takeover' || position === POSITIONS.center;

  const width =
    layout === 'takeover'
      ? 'max-w-3xl'
      : layout === 'split'
        ? 'max-w-2xl'
        : layout === 'bar'
          ? 'max-w-5xl'
          : (SIZES[view.size] ?? SIZES.m);

  const showImage = design.preset.usesImage && design.backgroundImage !== null;
  const asBackdrop = showImage && layout === 'takeover';

  return (
    <div className={`fixed z-40 ${position}`}>
      {overlay ? (
        <div className="bg-midnight-navy/40 absolute inset-0" aria-hidden onClick={onClose} />
      ) : null}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={view.title}
        className={`relative w-full overflow-hidden rounded-sm shadow-lg ${width} ${
          layout === 'split' ? 'sm:flex sm:items-stretch' : ''
        } ${layout === 'bar' ? 'sm:flex sm:items-center sm:gap-6' : ''}`}
        style={{
          backgroundColor: design.background,
          color: design.text,
          ...(asBackdrop
            ? {
                backgroundImage: `url(${design.backgroundImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : {}),
        }}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="absolute top-2 right-2 z-10 rounded-sm p-2 opacity-70 hover:opacity-100"
          style={{ color: design.text }}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        {showImage && !asBackdrop ? (
          // eslint-disable-next-line @next/next/no-img-element -- our own media route
          <img
            src={design.backgroundImage ?? ''}
            alt=""
            className={
              layout === 'split'
                ? 'hidden w-1/2 object-cover sm:block'
                : 'max-h-44 w-full object-cover'
            }
          />
        ) : null}

        <div
          className={`flex flex-col gap-3 p-6 ${design.textClass} ${
            layout === 'split' ? 'sm:w-1/2' : ''
          } ${asBackdrop ? 'bg-midnight-navy/50 sm:py-16' : ''} ${
            layout === 'bar' ? 'sm:flex-row sm:items-center sm:gap-6 sm:py-4' : ''
          }`}
        >
          <div className="flex flex-col gap-2 sm:flex-1">
            <h2 className="font-display text-lg font-semibold">{view.title}</h2>
            <div className="font-body">{view.body}</div>
          </div>
          {view.buttonLabel && view.buttonUrl ? (
            <ButtonLink
              href={view.buttonUrl}
              onClick={onAction}
              className="w-fit shrink-0"
              style={{ backgroundColor: design.buttonBackground, color: design.buttonText }}
            >
              {view.buttonLabel}
            </ButtonLink>
          ) : null}
        </div>
      </div>
    </div>
  );
}
