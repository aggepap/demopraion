import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PasswordForm, ProfileForm } from '@/components/account/AccountPanels';
import type { Locale } from '@/lib/i18n/config';

import { AccountShell } from '../AccountShell';
import { requireCustomerPage } from '../require-customer';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function AccountProfilePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const customer = await requireCustomerPage(locale);

  const t = await getTranslations({ locale, namespace: 'account' });

  return (
    <AccountShell
      eyebrow={t('eyebrow')}
      title={t('profileTitle')}
      intro={t('signedInAs', { email: customer.email })}
    >
      <ProfileForm
        initial={{
          name: customer.name ?? '',
          phone: customer.phone ?? '',
          marketingOptIn: customer.marketingOptIn,
        }}
      />
      <hr className="border-border-soft" />
      <h2 className="font-display text-midnight-navy text-lg font-semibold">
        {t('changePassword')}
      </h2>
      <PasswordForm />
    </AccountShell>
  );
}
