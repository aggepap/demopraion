import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RegisterForm } from '@/components/account/AccountForms';
import type { Locale } from '@/lib/i18n/config';

import { AccountShell } from '../AccountShell';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'account' });

  return (
    <AccountShell eyebrow={t('eyebrow')} title={t('registerTitle')} intro={t('registerIntro')}>
      <RegisterForm />
    </AccountShell>
  );
}
