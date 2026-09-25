'use client';

import { useState } from 'react';

import { cmsApi } from './api-client';
import { mfaErrorMessage } from './login-error';
import { RecoveryCodesPanel } from './RecoveryCodesPanel';
import { Button, Field, InfoTip, MfaCodeInput } from './ui';

/**
 * Setting up a second factor, in one component.
 *
 * Shared by the two places enrollment happens — the account screen, and the
 * forced-enrollment step inside the sign-in form when the site requires 2FA —
 * because they are the same three states (choose a method, prove it works, save
 * the recovery codes) and duplicating them is how the two drift apart.
 *
 * `onEnrolled` is what differs: the account screen refreshes its status, the
 * login form navigates into the admin with the session it has just been issued.
 */
type Step =
  | { name: 'choose' }
  | { name: 'totp'; secret: string; qrSvgDataUri: string; otpauthUri: string }
  | { name: 'email' }
  | { name: 'codes'; codes: string[] };

export function MfaEnrollPanel({
  onEnrolled,
  emailAvailable = true,
  siteName,
}: {
  /** Called once the factor is live and the user has seen their recovery codes. */
  onEnrolled: () => void;
  /** False when the site has no mail configured — see `graphMailConfigured`. */
  emailAvailable?: boolean;
  /** Named in the downloaded recovery-code file so it identifies itself later. */
  siteName?: string;
}) {
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(method: 'totp' | 'email') {
    setBusy(true);
    setError(null);
    try {
      const { data } = await cmsApi.start2faEnroll(method);
      setStep(
        data.method === 'totp'
          ? {
              name: 'totp',
              secret: data.secret,
              qrSvgDataUri: data.qrSvgDataUri,
              otpauthUri: data.otpauthUri,
            }
          : { name: 'email' },
      );
    } catch (err) {
      setError(mfaErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (step.name !== 'totp' && step.name !== 'email') return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await cmsApi.confirm2faEnroll(step.name, code);
      setStep({ name: 'codes', codes: data.recoveryCodes });
      setCode('');
    } catch (err) {
      setError(mfaErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div
          role="alert"
          className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {step.name === 'choose' ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-1 text-sm text-neutral-600">
            Choose how you want to confirm it is you when you sign in.
            <InfoTip label="About the two methods">
              An authenticator app (such as Google Authenticator or 1Password) shows a new code every 30
              seconds and works without a signal. An emailed code is sent each time you sign in, so it needs
              access to your inbox.
            </InfoTip>
          </p>
          <Button type="button" disabled={busy} onClick={() => start('totp')}>
            Use an authenticator app
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !emailAvailable}
            onClick={() => start('email')}
          >
            Email me a code
          </Button>
          {!emailAvailable ? (
            // Said rather than shown as a dimmed button with no reason: a
            // disabled control announces itself as "dimmed" and explains
            // nothing, which is the same a11y decision the login form makes.
            <p className="text-xs text-neutral-500">
              Emailed codes are unavailable because this site has no mail configured.
            </p>
          ) : null}
        </div>
      ) : null}

      {step.name === 'totp' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-neutral-600">
            Scan this with your authenticator app, then enter the six-digit code it shows.
          </p>
          {/*
            An <img> with a data URI, not dangerouslySetInnerHTML. The SVG is
            generated here, but the admin is the last DOM in this app that
            should be in the habit of accepting markup from anywhere.

            next/image is the wrong tool for a `data:` URI it cannot fetch,
            resize or cache — there is no network request to optimise.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data: URI, nothing for next/image to optimise */}
          <img
            src={step.qrSvgDataUri}
            alt="QR code for setting up your authenticator app"
            width={180}
            height={180}
            className="self-start rounded-sm border border-neutral-200 bg-white p-2"
          />
          <div className="text-xs text-neutral-600">
            Cannot scan? Enter this key manually:
            <code className="ml-1 select-all break-all font-mono text-[11px] text-neutral-900">
              {step.secret}
            </code>
          </div>
        </div>
      ) : null}

      {step.name === 'email' ? (
        <p className="text-sm text-neutral-600">
          We have sent a six-digit code to your email address. Enter it below to finish.
        </p>
      ) : null}

      {step.name === 'totp' || step.name === 'email' ? (
        <>
          <Field label="Code from your app or email">
            <MfaCodeInput
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              required
            />
          </Field>
          <div className="flex gap-2">
            <Button type="button" onClick={confirm} disabled={busy}>
              {busy ? 'Checking…' : 'Turn on two-factor'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setStep({ name: 'choose' });
                setCode('');
                setError(null);
              }}
            >
              Back
            </Button>
          </div>
        </>
      ) : null}

      {step.name === 'codes' ? (
        <RecoveryCodesPanel codes={step.codes} siteName={siteName}>
          <Button type="button" onClick={onEnrolled}>
            I have saved them
          </Button>
        </RecoveryCodesPanel>
      ) : null}
    </div>
  );
}
