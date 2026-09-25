import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isModuleEnabled } from '@/cms/core';
import { getGiftWrapFee, getShippingConfig, getSiteCurrency } from '@/cms/modules/commerce';
import {
  checkoutPrefill,
  listCustomerAddresses,
  readCurrentCustomer,
} from '@/cms/modules/customers';
import type { Locale } from '@/lib/i18n/config';
import { localizedMetadata } from '@/lib/seo/metadata';
import config from '@/site.config';

import { CheckoutClient } from './CheckoutClient';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'checkout' });
  return localizedMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/checkout',
    locale,
  });
}

export default async function CheckoutPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await isModuleEnabled(config, 'commerce'))) notFound();

  const [currency, giftWrapFee, shipping, accountsEnabled] = await Promise.all([
    getSiteCurrency(),
    getGiftWrapFee(),
    getShippingConfig(),
    isModuleEnabled(config, 'customers'),
  ]);

  /*
   * A signed-in customer's form starts filled in; a guest is offered an
   * account. The server decides both — the page is already `force-dynamic`
   * because a cart is never the same twice.
   */
  const customer = accountsEnabled ? await readCurrentCustomer() : null;
  const prefill = customer
    ? checkoutPrefill(customer, await listCustomerAddresses(customer.id))
    : null;
  return (
    <CheckoutClient
      locale={locale}
      currency={currency}
      giftWrapFee={giftWrapFee}
      // Store pickup (§8) — only the pickup block is needed client-side.
      pickup={shipping.pickup.enabled ? shipping.pickup : undefined}
      account={{ offerAccount: accountsEnabled && !customer, prefill }}
    />
  );
}
