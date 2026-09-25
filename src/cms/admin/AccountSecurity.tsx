'use client';

import { useState } from 'react';

import { cmsApi } from './api-client';
import { mfaErrorMessage } from './login-error';
import { MfaEnrollPanel } from './MfaEnrollPanel';
import { RecoveryCodesPanel } from './RecoveryCodesPanel';
import { Button, Field, InfoTip, Section } from './ui';
import { PasswordInput } from './ui/PasswordInput';

/**
 * The signed-in user's own second-factor settings.
 *
 * This screen is deliberately NOT behind `cms.users.manage`. Two-factor
 * authentication is a property of an account, and gating it behind the
 * user-management permission would leave every editor on the site unable to
 * protect their own login — which is the exact population the feature is for.
 *
 * Both destructive actions re-ask for the password. A session cookie on an
 * unattended laptop is enough to reach this page; it must not be enough to
 * remove the second factor or to print a fresh set of recovery codes. The
 * server enforces that too — this is so the prompt is not a surprise.
 */
export interface MfaState {
  method: 'totp' | 'email' | null;
  enrolledAt: string | null;
  recoveryCodesRemaining: number;
  required: boolean;
}

const METHOD_LABEL: Record<'totp' | 'email', string> = {
  totp: 'Authenticator app',
  email: 'Emailed codes',
};

export function AccountSecurity({
  initial,
  emailAvailable,
  siteName,
}: {
  initial: MfaState;
  emailAvailable: boolean;
  /** Named in the downloaded recovery-code file so it identifies itself later. */
  siteName?: string;
}) {
  const [state, setState] = useState(initial);
  const [enrolling, setEnrolling] = useState(false);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<'disable' | 'regenerate' | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const { data } = await cmsApi.get2faStatus();
    setState(data);
  }

  async function confirmPending() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      if (pending === 'disable') {
        await cmsApi.disable2fa(password);
        setNotice('Two-factor authentication is off.');
        setCodes(null);
      } else {
        const { data } = await cmsApi.regenerate2faRecoveryCodes(password);
        setCodes(data.recoveryCodes);
        setNotice('Your old recovery codes no longer work.');
      }
      setPending(null);
      setPassword('');
      await refresh();
    } catch (err) {
      setError(mfaErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Two-factor authentication"
      info="A second step after your password: a six-digit code from an app on your phone, or one sent to your email. Someone who only has your password cannot sign in."
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <div
            role="alert"
            className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}
        {notice ? (
          <div
            role="status"
            className="rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700"
          >
            {notice}
          </div>
        ) : null}

        {enrolling ? (
          <MfaEnrollPanel
            emailAvailable={emailAvailable}
            siteName={siteName}
            onEnrolled={async () => {
              setEnrolling(false);
              setNotice('Two-factor authentication is on.');
              await refresh();
            }}
          />
        ) : state.method ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-neutral-600">Method</dt>
              <dd className="text-neutral-900">{METHOD_LABEL[state.method]}</dd>
              <dt className="text-neutral-600">Turned on</dt>
              <dd className="text-neutral-900">
                {state.enrolledAt ? new Date(state.enrolledAt).toLocaleDateString() : '—'}
              </dd>
              <dt className="flex items-center gap-1 text-neutral-600">
                Recovery codes left
                <InfoTip label="About recovery codes">
                  One-time codes for signing in when you cannot get a code from your app or email. Each works
                  once. “New recovery codes” replaces the whole set.
                </InfoTip>
              </dt>
              <dd className="text-neutral-900">{state.recoveryCodesRemaining}</dd>
            </dl>

            {state.recoveryCodesRemaining === 0 ? (
              // Worth saying loudly. Somebody with no codes left and a lost
              // phone needs another administrator, and finds that out at the
              // worst possible moment.
              <div
                role="alert"
                className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                You have no recovery codes left. Generate a new set now — without them, losing your
                device means asking another administrator to reset your access.
              </div>
            ) : null}

            {codes ? (
              <RecoveryCodesPanel
                codes={codes}
                siteName={siteName}
                heading="Save these new recovery codes now."
              />
            ) : null}

            {pending ? (
              <div className="flex flex-col gap-3 rounded-sm border border-neutral-200 p-3">
                <p className="text-sm text-neutral-700">
                  {pending === 'disable'
                    ? 'Enter your password to turn two-factor authentication off.'
                    : 'Enter your password to replace your recovery codes.'}
                </p>
                <Field label="Password">
                  <PasswordInput
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                    required
                  />
                </Field>
                <div className="flex gap-2">
                  <Button type="button" onClick={confirmPending} disabled={busy}>
                    {busy ? 'Working…' : 'Confirm'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setPending(null);
                      setPassword('');
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => setPending('regenerate')}>
                  New recovery codes
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={state.required}
                  onClick={() => setPending('disable')}
                >
                  Turn off
                </Button>
              </div>
            )}

            {state.required ? (
              <p className="text-xs text-neutral-500">
                This site requires two-factor authentication, so it cannot be turned off. An
                administrator can change that in Settings → Security.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-600">
              Two-factor authentication is off. Adding it means a leaked password is not enough on
              its own to reach this admin.
            </p>
            <div>
              <Button type="button" onClick={() => setEnrolling(true)}>
                Set up two-factor authentication
              </Button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
