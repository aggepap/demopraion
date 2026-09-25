import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PrivacyPanel } from '@/components/account/AccountPanels';
import type { Locale } from '@/lib/i18n/config';

import { AccountShell } from '../AccountShell';
import { requireCustomerPage } from '../require-customer';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function AccountPrivacyPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The guard is what matters here; the panel fetches its own data.
  await requireCustomerPage(locale);

  const t = await getTranslations({ locale, namespace: 'account' });

  return (
    <AccountShell eyebrow={t('eyebrow')} title={t('privacyTitle')} intro={t('privacyIntro')}>
      <PrivacyPanel />
    </AccountShell>
  );
}
