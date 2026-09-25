'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { ButtonLink } from '@/components/ui/Button';

import { accountPost } from './account-api';

/**
 * Spends the confirmation link from the email.
 *
 * A POST rather than a GET on the link itself, because mail scanners and link
 * previewers follow GETs: a one-time link that a security appliance opens
 * before the customer does is a link the customer finds already used. The page
 * loads, then posts the token once.
 */
export function VerifyClient({ token }: { token: string }) {
  const t = useTranslations('account');
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    accountPost('verify', { token }, t('linkInvalid'))
      .then(() => {
        if (!cancelled) setState('done');
      })
      .catch(() => {
        if (!cancelled) setState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  if (state === 'working') {
    return (
      <p role="status" className="font-body text-text-muted text-sm">
        {t('verifying')}
      </p>
    );
  }

  if (state === 'failed') {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="font-body text-sm text-red-700">
          {t('linkInvalid')}
        </p>
        <ButtonLink href="/account/login">{t('signIn')}</ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4">
      <p role="status" className="font-body text-sm text-green-700">
        {t('emailConfirmed')}
      </p>
      <ButtonLink href="/account">{t('myAccount')}</ButtonLink>
    </div>
  );
}
