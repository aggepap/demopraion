import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isModuleEnabled } from '@/cms/core';
import { Eyebrow } from '@/components/ui/Eyebrow';
import type { Locale } from '@/lib/i18n/config';
import { localizedMetadata } from '@/lib/seo/metadata';
import config from '@/site.config';

import { BookingLookupClient } from './BookingLookupClient';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'bookingLookup' });
  return localizedMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/booking/lookup',
    locale,
  });
}

export default async function BookingLookupPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await isModuleEnabled(config, 'booking'))) notFound();

  const t = await getTranslations({ locale, namespace: 'bookingLookup' });

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <Eyebrow>{t('title')}</Eyebrow>
      <h1 className="mt-2 font-display text-3xl font-semibold">{t('title')}</h1>
      <p className="mt-2 mb-6 text-neutral-600">{t('intro')}</p>

      <BookingLookupClient
        locale={locale}
        labels={{
          reference: t('reference'),
          email: t('email'),
          submit: t('submit'),
          searching: t('searching'),
          notFound: t('notFound'),
          status: t('status'),
          date: t('date'),
          persons: t('persons'),
          total: t('total'),
          statusPending: t('statusPending'),
          statusAwaitingPayment: t('statusAwaitingPayment'),
          statusConfirmed: t('statusConfirmed'),
          statusPaid: t('statusPaid'),
          statusCancelled: t('statusCancelled'),
          statusExpired: t('statusExpired'),
        }}
      />
    </main>
  );
}
