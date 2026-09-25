'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useRouter } from '@/lib/i18n/routing';

import { accountPost } from './account-api';
import { inputClass } from './AccountForms';

/**
 * The panels behind a signed-in session: details, password, addresses, and the
 * two privacy controls.
 *
 * Each one posts to the account API and then asks the server component above it
 * to re-render (`router.refresh()`), so what is on screen is always what the
 * database actually holds rather than an optimistic guess.
 */

export interface AccountAddress {
  id: number;
  label: string | null;
  name: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  postal: string | null;
  country: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

function useAction() {
  const router = useRouter();
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
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, run, router };
}

function Status({ error, done }: { error: string | null; done: string | null }) {
  return (
    <>
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
    </>
  );
}

export function ProfileForm({
  initial,
}: {
  initial: { name: string; phone: string; marketingOptIn: boolean };
}) {
  const t = useTranslations('account');
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [marketingOptIn, setMarketing] = useState(initial.marketingOptIn);
  const { busy, error, done, run } = useAction();

  return (
    <form
      className="flex max-w-sm flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await accountPost(
            'profile',
            { name, phone, marketingOptIn },
            t('somethingWrong'),
            'PATCH'
          );
          return t('saved');
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="profile-name" className="font-body text-text-primary text-sm font-medium">
          {t('name')}
        </label>
        <input
          id="profile-name"
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="profile-phone" className="font-body text-text-primary text-sm font-medium">
          {t('phone')}
        </label>
        <input
          id="profile-phone"
          className={inputClass}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <label className="font-body text-text-primary flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-warm-gold-deep h-4 w-4"
          checked={marketingOptIn}
          onChange={(e) => setMarketing(e.target.checked)}
        />
        {t('marketingOptIn')}
      </label>
      <Status error={error} done={done} />
      <Button type="submit" disabled={busy}>
        {t('save')}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const t = useTranslations('account');
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const { busy, error, done, run, router } = useAction();

  return (
    <form
      className="flex max-w-sm flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await accountPost('password', { currentPassword, newPassword }, t('somethingWrong'));
          // Changing the password ends every session, this one included.
          router.push('/account/login');
          return t('passwordChanged');
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cur-password" className="font-body text-text-primary text-sm font-medium">
          {t('currentPassword')}
        </label>
        <input
          id="cur-password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-password" className="font-body text-text-primary text-sm font-medium">
          {t('newPassword')}
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          className={inputClass}
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
      </div>
      <p className="font-body text-text-muted text-xs">{t('passwordEndsSessions')}</p>
      <Status error={error} done={done} />
      <Button type="submit" disabled={busy}>
        {t('changePassword')}
      </Button>
    </form>
  );
}

const EMPTY_ADDRESS = {
  label: '',
  name: '',
  phone: '',
  address1: '',
  address2: '',
  city: '',
  postal: '',
  country: '',
};

export function AddressesPanel({ addresses }: { addresses: AccountAddress[] }) {
  const t = useTranslations('account');
  const [draft, setDraft] = useState(EMPTY_ADDRESS);
  const { busy, error, done, run } = useAction();

  const field = (key: keyof typeof EMPTY_ADDRESS, label: string, autoComplete?: string) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`addr-${key}`} className="font-body text-text-primary text-sm font-medium">
        {label}
      </label>
      <input
        id={`addr-${key}`}
        autoComplete={autoComplete}
        className={inputClass}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      {addresses.length === 0 ? (
        <p className="font-body text-text-muted text-sm">{t('noAddresses')}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="border-border-soft flex flex-col gap-2 rounded-sm border bg-white p-4"
            >
              <p className="font-body text-text-primary text-sm">
                {address.label ? <strong>{address.label} — </strong> : null}
                {address.name}
              </p>
              <p className="font-body text-text-muted text-sm">
                {[address.address1, address.address2, address.postal, address.city, address.country]
                  .filter(Boolean)
                  .join(', ')}
              </p>
              {address.isDefaultShipping ? (
                <p className="font-body text-warm-gold-deep text-xs">{t('defaultShipping')}</p>
              ) : null}
              <div className="flex gap-2">
                {address.isDefaultShipping ? null : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await accountPost(
                          `addresses/${address.id}`,
                          { isDefaultShipping: true },
                          t('somethingWrong'),
                          'PATCH'
                        );
                      })
                    }
                  >
                    {t('makeDefault')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await accountPost(
                        `addresses/${address.id}`,
                        undefined,
                        t('somethingWrong'),
                        'DELETE'
                      );
                    })
                  }
                >
                  {t('remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex max-w-lg flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await accountPost('addresses', draft, t('somethingWrong'));
            setDraft(EMPTY_ADDRESS);
            return t('saved');
          });
        }}
      >
        <h3 className="font-display text-midnight-navy text-base font-semibold">
          {t('addAddress')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('label', t('addressLabel'))}
          {field('name', t('name'), 'name')}
          {field('address1', t('address1'), 'address-line1')}
          {field('address2', t('address2'), 'address-line2')}
          {field('postal', t('postal'), 'postal-code')}
          {field('city', t('city'), 'address-level2')}
          {field('country', t('country'), 'country')}
          {field('phone', t('phone'), 'tel')}
        </div>
        <Status error={error} done={done} />
        <Button type="submit" disabled={busy}>
          {t('save')}
        </Button>
      </form>
    </div>
  );
}

export function PrivacyPanel() {
  const t = useTranslations('account');
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const { busy, error, done, run, router } = useAction();

  return (
    <div className="flex max-w-sm flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h3 className="font-display text-midnight-navy text-base font-semibold">
          {t('downloadData')}
        </h3>
        <p className="font-body text-text-muted text-sm">{t('downloadDataHint')}</p>
        {/*
          An anchor, not `next/link`: this is a file download from an API
          route, not a page. Routing it through the client router would fetch
          the JSON as a navigation and never save it.
        */}
        <a
          download
          href="/api/cms/customer/export"
          className="font-body text-warm-gold-deep w-fit text-sm underline"
        >
          {t('downloadData')}
        </a>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-display text-midnight-navy text-base font-semibold">
          {t('deleteAccount')}
        </h3>
        <p className="font-body text-text-muted text-sm">{t('deleteAccountHint')}</p>
        {confirming ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await accountPost('delete', { password }, t('somethingWrong'));
                router.push('/');
              });
            }}
          >
            <label htmlFor="delete-password" className="font-body text-text-primary text-sm">
              {t('confirmWithPassword')}
            </label>
            <input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Status error={error} done={done} />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {t('deleteAccount')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            {t('deleteAccount')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function SignOutButton() {
  const t = useTranslations('account');
  const { busy, run, router } = useAction();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={busy}
      onClick={() =>
        void run(async () => {
          await accountPost('logout', {}, t('somethingWrong'));
          router.push('/');
        })
      }
    >
      {t('signOut')}
    </Button>
  );
}
