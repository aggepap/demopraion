'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { cmsApi } from './api-client';
import { loginErrorMessage, mfaErrorMessage } from './login-error';
import { MfaBypassDialog } from './MfaBypassDialog';
import { isMfaBypassHotkey } from './mfa-bypass-hotkey';
import { MfaEnrollPanel } from './MfaEnrollPanel';
import { safeNextPath } from './safe-next';
import { Button, Field, Icon, MfaCodeInput, TextInput } from './ui';
import { Captcha } from './ui/Captcha';
import { PasswordInput } from './ui/PasswordInput';

/**
 * Sign-in, in up to three steps.
 *
 * One component rather than a second route, because `next`, the captcha token
 * and its reset counter all already live here and a separate page would have to
 * re-plumb every one of them through the URL — where `next` in particular is
 * attacker-controllable and has to go back through `safeNextPath`.
 *
 * The step is driven by what the server said, never by what the client thinks:
 * `POST /auth/login` answers with `{ user }`, `{ mfa: { method } }` or
 * `{ mfa: { enroll } }`, and there is no state here that can skip a step the
 * server has not already granted. The challenge itself lives in an httpOnly
 * cookie, so nothing in this file identifies who is signing in.
 */
type Step = 'password' | 'mfa' | 'enroll';

export function LoginForm({
  siteName,
  adminPath,
  captchaSiteKey,
  emailCodesAvailable = true,
}: {
  siteName: string;
  adminPath: string;
  /** `null` when reCAPTCHA is not configured — the form then has no widget. */
  captchaSiteKey?: string | null;
  /** False when the site has no mail configured, so enrollment cannot offer it. */
  emailCodesAvailable?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // `next` comes from the URL, so it is attacker-controllable — see `safeNextPath`.
  const next = safeNextPath(params.get('next'), adminPath);

  const [step, setStep] = useState<Step>('password');
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'email' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  /*
   * Seeded from `?timeout=1`, which `IdleLogout` adds on its way out. Without
   * it the user arrives at a login screen with no idea why — the most common
   * reading of which is "it logged me out at random", and the second most
   * common is "something is broken".
   */
  const [notice, setNotice] = useState<string | null>(
    params.get('timeout') === '1'
      ? 'You were signed out because you had been inactive. Please sign in again.'
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // Bumped on every failed submit to clear a spent (single-use) token.
  const [captchaResets, setCaptchaResets] = useState(0);
  const [bypassOpen, setBypassOpen] = useState(false);

  /*
   * The break-glass chord, bound ONLY while the code step is showing.
   *
   * Not on the password step, and not on the forced-enrollment step: the
   * bypass replaces a second factor that exists, so offering it anywhere else
   * would either be meaningless or would turn a site-wide "2FA required"
   * policy into a suggestion. The server enforces the same restriction — the
   * endpoint accepts only a `verify` challenge — this just keeps the UI from
   * implying otherwise.
   *
   * `preventDefault` because the chord collides with browser and OS shortcuts
   * on some platforms, and a dialog opening behind a print preview helps
   * nobody.
   */
  useEffect(() => {
    if (step !== 'mfa') return;
    const onKey = (e: KeyboardEvent) => {
      if (!isMfaBypassHotkey(e)) return;
      e.preventDefault();
      setBypassOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  function done() {
    router.push(next);
    router.refresh();
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    // Said here rather than by greying out the button: a disabled control
    // announces itself as "dimmed" and gives no reason, which for anyone using
    // a screen reader turns an unticked checkbox into a form that just does
    // nothing. The server enforces this regardless; this only saves a
    // round-trip and names the cause.
    if (captchaSiteKey && captchaToken === null) {
      setError('Please confirm you are not a robot.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await cmsApi.login(email, password, captchaToken);
      if (data.mfa?.enroll) {
        setStep('enroll');
        return;
      }
      if (data.mfa) {
        setMfaMethod(data.mfa.method ?? null);
        setNotice(
          data.mfa.method === 'email'
            ? 'We have sent a six-digit code to your email address.'
            : null,
        );
        setStep('mfa');
        return;
      }
      done();
    } catch (err) {
      setError(loginErrorMessage(err));
      // Whatever went wrong, the token that was just spent cannot be sent
      // again — without this the second attempt fails as a duplicate.
      if (captchaSiteKey) {
        setCaptchaToken(null);
        setCaptchaResets((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await cmsApi.verify2fa(code);
      done();
    } catch (err) {
      setError(mfaErrorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await cmsApi.send2faCode();
      setNotice('A new code is on its way.');
    } catch (err) {
      setError(mfaErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const heading =
    step === 'password' ? 'CMS · sign in' : step === 'mfa' ? 'CMS · verify' : 'CMS · set up 2FA';

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
      <div className="w-full max-w-sm rounded-sm border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-warm-gold text-midnight-navy">
            <Icon name="dashboard" size={18} />
          </span>
          <div className="flex flex-col leading-tight">
            <h1 className="font-display text-base font-semibold text-neutral-900">{siteName}</h1>
            <span className="text-[10px] uppercase tracking-wider text-neutral-600">{heading}</span>
          </div>
        </div>

        {error ? (
          // `role="alert"` so a failed sign-in is announced rather than
          // silently appearing above a form the user is still looking at.
          <div
            role="alert"
            className="mb-4 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}
        {notice ? (
          // `status` rather than `alert`: "we sent a code" is information, and
          // an assertive announcement would interrupt whatever is being read.
          <div
            role="status"
            className="mb-4 rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700"
          >
            {notice}
          </div>
        ) : null}

        {step === 'password' ? (
          <form onSubmit={submitPassword} className="flex flex-col gap-4">
            <Field label="Email">
              <TextInput
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Password">
              <PasswordInput
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {captchaSiteKey ? (
              <Captcha
                siteKey={captchaSiteKey}
                onToken={setCaptchaToken}
                resetSignal={captchaResets}
              />
            ) : null}
            <Button type="submit" disabled={busy} className="mt-1 w-full justify-center py-2.5">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        ) : null}

        {step === 'mfa' ? (
          <form onSubmit={submitCode} className="flex flex-col gap-4">
            <p className="text-sm text-neutral-600">
              {mfaMethod === 'email'
                ? 'Enter the code from your email, or one of your recovery codes.'
                : 'Enter the code from your authenticator app, or one of your recovery codes.'}
            </p>
            <Field label="Code">
              <MfaCodeInput
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Button type="submit" disabled={busy} className="w-full justify-center py-2.5">
              {busy ? 'Checking…' : 'Verify'}
            </Button>
            {mfaMethod === 'email' ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={resend}>
                Send a new code
              </Button>
            ) : null}
          </form>
        ) : null}

        {/* Rendered only alongside the code step, mirroring the key binding. */}
        {step === 'mfa' ? (
          <MfaBypassDialog
            open={bypassOpen}
            onClose={() => setBypassOpen(false)}
            onSuccess={() => {
              setBypassOpen(false);
              done();
            }}
          />
        ) : null}

        {step === 'enroll' ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-neutral-600">
              This site requires two-factor authentication. Set it up now to finish signing in.
            </p>
            <MfaEnrollPanel onEnrolled={done} emailAvailable={emailCodesAvailable} siteName={siteName} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
