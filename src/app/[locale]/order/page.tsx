import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isModuleEnabled } from '@/cms/core';
import type { Locale } from '@/lib/i18n/config';
import { localizedMetadata } from '@/lib/seo/metadata';
import config from '@/site.config';

import { OrderLookupClient } from './OrderLookupClient';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'orderLookup' });
  return localizedMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/order',
    locale,
  });
}

export default async function OrderLookupPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await isModuleEnabled(config, 'commerce'))) notFound();

  return <OrderLookupClient locale={locale} />;
}
