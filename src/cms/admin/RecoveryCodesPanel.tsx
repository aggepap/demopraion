'use client';

import { useEffect, useRef, useState } from 'react';

import { recoveryCodesFilename, recoveryCodesFileText } from './recovery-codes-file';
import { Button } from './ui';

/**
 * The one-and-only showing of a set of recovery codes.
 *
 * Shared by the two places that display them — the forced-enrollment step
 * inside sign-in, and the account screen after a regenerate — because they are
 * the same moment with the same stakes, and duplicating it is how one of them
 * quietly loses the download button.
 *
 * ## Why the feedback matters more than usual
 *
 * "Copy" wrote to the clipboard and said nothing. For an ordinary copy button
 * that is a small rudeness; here it is a real one, because the user is being
 * asked to trust that a credential they will never see again is now somewhere
 * safe, and the button gave them no reason to. Worse, `navigator.clipboard` is
 * absent outside a secure context — an admin opened over plain HTTP on a LAN
 * address has no clipboard API at all — so the silent path was also sometimes
 * the *failing* path, with nothing on screen to say so.
 *
 * The result is announced in a `role="status"` region rather than only shown as
 * a colour change, so it reaches a screen reader too.
 *
 * Download exists because copying is not saving. A clipboard survives until the
 * next copy; these codes need to survive until the phone is lost.
 */
export function RecoveryCodesPanel({
  codes,
  siteName,
  heading = 'Save these recovery codes now.',
  children,
}: {
  codes: string[];
  /** Named in the downloaded file so it identifies itself months later. */
  siteName?: string;
  heading?: string;
  /** Trailing actions — e.g. the "I have saved them" confirm on the login step. */
  children?: React.ReactNode;
}) {
  const [status, setStatus] = useState<null | { tone: 'ok' | 'error'; message: string }>(null);
  // Cleared on unmount: this component is unmounted by the very button that
  // sets the timer ("I have saved them"), and a setState afterwards is a React
  // warning at best.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function announce(tone: 'ok' | 'error', message: string) {
    setStatus({ tone, message });
    if (timer.current) clearTimeout(timer.current);
    // Long enough to read, and it clears itself so the panel does not keep
    // claiming something that happened a while ago.
    timer.current = setTimeout(() => setStatus(null), 6000);
  }

  async function copy() {
    const text = codes.join('\n');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      announce('ok', `Copied ${codes.length} recovery codes to the clipboard.`);
    } catch {
      // Names the way out rather than just reporting failure: the codes are
      // right there on screen and selectable, and Download does not need a
      // clipboard at all.
      announce(
        'error',
        'Could not reach the clipboard. Use Download, or select the codes above and copy them.',
      );
    }
  }

  function download() {
    try {
      const at = new Date();
      const blob = new Blob([recoveryCodesFileText(codes, { siteName, generatedAt: at })], {
        type: 'text/plain;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = recoveryCodesFilename(siteName, at);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick, not immediately: revoking synchronously after
      // click() cancels the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      announce('ok', `Downloaded ${recoveryCodesFilename(siteName, at)}.`);
    } catch {
      announce('error', 'Could not start the download. Copy the codes instead.');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <strong>{heading}</strong> Each one works once, and this is the only time they are shown.
        They are the way back in if you lose your phone.
      </div>

      <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="select-all rounded-sm bg-neutral-100 px-2 py-1 text-center">
            {code}
          </li>
        ))}
      </ul>

      {/*
        Always in the DOM, even when empty. A live region that is added to the
        page at the same moment its text appears is unreliably announced —
        assistive tech has to be watching the node already.
      */}
      <p
        role="status"
        aria-live="polite"
        className={
          status?.tone === 'error'
            ? 'min-h-[1.25rem] text-xs text-red-700'
            : 'min-h-[1.25rem] text-xs text-green-700'
        }
      >
        {status?.message ?? ''}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={copy}>
          Copy codes
        </Button>
        <Button type="button" variant="secondary" onClick={download}>
          Download .txt
        </Button>
        {children}
      </div>
    </div>
  );
}
