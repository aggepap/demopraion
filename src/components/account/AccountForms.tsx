'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { useRouter } from '@/lib/i18n/routing';

import { accountPost } from './account-api';

/**
 * The unauthenticated account forms: sign in, register, ask for a reset link,
 * set a new password.
 *
 * They share one shell so every one of them announces its error the same way —
 * a `role="alert"` region tied to the form, rather than a red line a screen
 * reader never mentions.
 */

const inputClass =
  'w-full rounded-sm border border-border-soft bg-white px-3 py-2 font-body text-sm text-text-primary focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold';

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-body text-text-primary text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function FormShell({
  onSubmit,
  busy,
  error,
  done,
  submitLabel,
  children,
  footer,
}: {
  onSubmit: () => Promise<void>;
  busy: boolean;
  error: string | null;
  done: string | null;
  submitLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <form
      className="flex w-full max-w-sm flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
      noValidate
    >
      {children}
      {error ? (
        <p role="alert" className="font-body text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="font-body text-sm text-green-700">
          {done}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {submitLabel}
      </Button>
      {footer}
    </form>
  );
}

/** The state every one of these forms has. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const message = await action();
      if (typeof message === 'string') setDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, run };
}

export function LoginForm({ next = '/account' }: { next?: string }) {
  const t = useTranslations('account');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, done, run } = useSubmit();

  return (
    <FormShell
      busy={busy}
      error={error}
      done={done}
      submitLabel={t('signIn')}
      onSubmit={() =>
        run(async () => {
          await accountPost('login', { email, password }, t('signInFailed'));
          router.push(next);
          router.refresh();
        })
      }
    >
      <Field id="login-email" label={t('email')}>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field id="login-password" label={t('password')}>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
    </FormShell>
  );
}

export function RegisterForm() {
  const t = useTranslations('account');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, done, run } = useSubmit();

  return (
    <FormShell
      busy={busy}
      error={error}
      done={done}
      submitLabel={t('createAccount')}
      onSubmit={() =>
        run(async () => {
          await accountPost('register', { email, name, password }, t('registerFailed'));
          // Deliberately the same message whether or not the address was taken.
          return t('checkYourEmail');
        })
      }
    >
      <Field id="register-name" label={t('name')}>
        <input
          id="register-name"
          autoComplete="name"
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field id="register-email" label={t('email')}>
        <input
          id="register-email"
          type="email"
          autoComplete="email"
          required
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field id="register-password" label={t('password')}>
        <input
          id="register-password"
          type="password"
          autoComplete="new-password"
          required
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
    </FormShell>
  );
}

export function ForgotForm() {
  const t = useTranslations('account');
  const [email, setEmail] = useState('');
  const { busy, error, done, run } = useSubmit();

  return (
    <FormShell
      busy={busy}
      error={error}
      done={done}
      submitLabel={t('sendResetLink')}
      onSubmit={() =>
        run(async () => {
          await accountPost('forgot', { email }, t('somethingWrong'));
          // Says nothing about whether the address has an account.
          return t('resetLinkSent');
        })
      }
    >
      <Field id="forgot-email" label={t('email')}>
        <input
          id="forgot-email"
          type="email"
          autoComplete="email"
          required
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
    </FormShell>
  );
}

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations('account');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const { busy, error, done, run } = useSubmit();

  if (!token) {
    return (
      <p role="alert" className="font-body text-sm text-red-700">
        {t('linkInvalid')}
      </p>
    );
  }

  return (
    <FormShell
      busy={busy}
      error={error}
      done={done}
      submitLabel={t('setNewPassword')}
      onSubmit={() =>
        run(async () => {
          await accountPost('reset', { token, password }, t('linkInvalid'));
          router.push('/account/login');
        })
      }
    >
      <Field id="reset-password" label={t('newPassword')}>
        <input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          required
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
    </FormShell>
  );
}

export { inputClass };
