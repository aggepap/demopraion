import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ResetForm } from '@/components/account/AccountForms';
import type { Locale } from '@/lib/i18n/config';

import { AccountShell } from '../AccountShell';

interface PageProps {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'account' });
  const token = String((await searchParams).token ?? '');
  return (
    <AccountShell eyebrow={t('eyebrow')} title={t('resetTitle')} intro={t('resetIntro')}>
      <ResetForm token={token} />
    </AccountShell>
  );
}
