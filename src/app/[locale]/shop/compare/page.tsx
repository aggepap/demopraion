import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isModuleEnabled } from '@/cms/core';
import { CompareClient } from '@/components/shop/compare/CompareClient';
import { Breadcrumbs, type Crumb } from '@/components/shop/Breadcrumbs';
import { Eyebrow } from '@/components/ui/Eyebrow';
import type { Locale } from '@/lib/i18n/config';
import { localizedMetadata } from '@/lib/seo/metadata';
import config from '@/site.config';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'shop' });
  const meta = await localizedMetadata({
    title: t('compareTitle'),
    description: t('compareTitle'),
    path: '/shop/compare',
    locale,
  });
  // A personal, client-state page — keep it out of search results.
  return { ...meta, robots: { index: false, follow: false } };
}

export default async function ComparePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await isModuleEnabled(config, 'commerce'))) notFound();

  const t = await getTranslations({ locale, namespace: 'shop' });
  const crumbs: Crumb[] = [{ label: t('title'), href: '/shop' }, { label: t('compareTitle') }];

  return (
    <section className="bg-soft-pearl pt-20 md:pt-28 pb-24">
      <div className="max-w-7xl mx-auto px-6">
        <Breadcrumbs items={crumbs} className="mb-4" />
        <Eyebrow className="mb-3">{t('compareTitle')}</Eyebrow>
        <h1 className="mb-8 font-display text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1] text-midnight-navy">
          {t('compareTitle')}
        </h1>
        <CompareClient locale={locale} />
      </div>
    </section>
  );
}
