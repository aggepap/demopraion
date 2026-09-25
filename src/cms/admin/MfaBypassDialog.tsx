'use client';

import { useRef, useState } from 'react';

import { mfaErrorMessage } from './login-error';
import { Button, Field, MfaCodeInput } from './ui';
import { useDialog } from './ui/use-dialog';

/**
 * The break-glass dialog on the second-factor step.
 *
 * Opened by a deliberately undiscoverable shortcut (see `MFA_BYPASS_HOTKEY`).
 * The obscurity is a UI convenience, NOT the security boundary — the endpoint
 * behind this is reachable with curl like any other, and what actually keeps
 * the bypass code out of the ordinary 2FA field is that the two are separate
 * routes checking separate secrets.
 *
 * Undiscoverable is not the same as inaccessible: once open, this is an
 * ordinary modal. `useDialog` gives it the focus trap, Escape-to-close, scroll
 * lock and focus restore that every other dialog in the admin has, so somebody
 * who knows the shortcut can complete it on a keyboard alone.
 */
export function MfaBypassDialog({ open, onClose, onSuccess }: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useDialog({ open, onClose, panelRef, initialFocusRef: inputRef });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Imported lazily so the bypass endpoint is not named in the bundle that
      // every visitor to the login page downloads. Obscurity again, not a
      // boundary — but it costs nothing.
      const { cmsApi } = await import('./api-client');
      await cmsApi.bypass2fa(code);
      onSuccess();
    } catch (err) {
      setError(mfaErrorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mfa-bypass-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div onClick={onClose} aria-hidden="true" className="absolute inset-0 bg-neutral-900/50" />
      <div
        ref={panelRef}
        className="relative w-full max-w-xs rounded-sm border border-neutral-200 bg-white p-5 shadow-lg"
      >
        <h2 id="mfa-bypass-title" className="mb-1 font-display text-sm font-semibold text-neutral-900">
          Recovery access
        </h2>
        <p className="mb-4 text-xs text-neutral-600">
          Enter the six-digit recovery PIN for this site.
        </p>

        {error ? (
          <div
            role="alert"
            className="mb-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}

        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Recovery PIN">
            <MfaCodeInput
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              // Not `one-time-code`: this is a long-lived shared secret, and
              // offering to autofill it from an SMS would be nonsense.
              autoComplete="off"
              required
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Continue'}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
