'use client';

import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from './index';
import { cn } from './cn';
import { useDialog } from './use-dialog';

export interface ConfirmOptions {
  title: string;
  /** What exactly is about to happen, in the user's terms. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button. Default true — this is used for deletions. */
  destructive?: boolean;
}

/**
 * In-app replacement for `window.confirm`.
 *
 * The native dialog looked like it belonged to the browser rather than the CMS,
 * blocked the whole page while open, and could not be styled or made to match
 * the surrounding UI. This keeps the same call shape — `await confirm({…})`
 * returns a boolean — so a call site changes by one `await`.
 *
 * Returns the dialog element to render plus the function that opens it.
 */
export function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setState(null);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setState(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  // Escape cancels (a dialog you cannot dismiss with the keyboard is worse than
  // the native one it replaced), plus scroll-lock, focus trap and focus restore.
  // `initialFocusRef` keeps the original behaviour of landing on the decision
  // button rather than on Cancel, which is merely first in the DOM.
  const panelRef = useRef<HTMLDivElement>(null);
  const cancel = useCallback(() => settle(false), [settle]);
  useDialog({ open: state !== null, onClose: cancel, panelRef, initialFocusRef: confirmRef });

  const dialog = state ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        onClick={() => settle(false)}
        aria-hidden="true"
        className="absolute inset-0 bg-neutral-900/50"
      />
      <div
        ref={panelRef}
        className="relative w-full max-w-sm rounded-sm border border-neutral-200 bg-white p-5 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="font-display text-base font-semibold text-neutral-900">
          {state.title}
        </h2>
        {state.message ? (
          <p className="mt-2 text-sm leading-relaxed text-neutral-600">{state.message}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(false)}
            className="rounded-sm border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
          >
            {state.cancelLabel ?? 'Cancel'}
          </button>
          <Button
            ref={confirmRef}
            type="button"
            onClick={() => settle(true)}
            className={cn(
              (state.destructive ?? true) &&
                'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
            )}
          >
            {state.confirmLabel ?? 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
