import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AddressesPanel } from '@/components/account/AccountPanels';
import { listCustomerAddresses } from '@/cms/modules/customers';
import type { Locale } from '@/lib/i18n/config';

import { AccountShell } from '../AccountShell';
import { requireCustomerPage } from '../require-customer';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function AccountAddressesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const customer = await requireCustomerPage(locale);

  const [t, addresses] = await Promise.all([
    getTranslations({ locale, namespace: 'account' }),
    listCustomerAddresses(customer.id),
  ]);

  return (
    <AccountShell eyebrow={t('eyebrow')} title={t('addressesTitle')} intro={t('addressesIntro')}>
      <AddressesPanel
        addresses={addresses.map((a) => ({
          id: a.id,
          label: a.label,
          name: a.name,
          phone: a.phone,
          address1: a.address1,
          address2: a.address2,
          city: a.city,
          postal: a.postal,
          country: a.country,
          isDefaultShipping: a.isDefaultShipping,
          isDefaultBilling: a.isDefaultBilling,
        }))}
      />
    </AccountShell>
  );
}
