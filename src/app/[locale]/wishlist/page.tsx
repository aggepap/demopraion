import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isModuleEnabled } from '@/cms/core';
import { getWishlistConfig } from '@/cms/modules/commerce';
import { Eyebrow } from '@/components/ui/Eyebrow';
import type { Locale } from '@/lib/i18n/config';
import config from '@/site.config';

import { WishlistClient } from './WishlistClient';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/** A personal list: never cached, never indexed. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function WishlistPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Off means gone, not empty: the page does not exist when the shop has not
  // switched the wishlist on.
  if (!(await isModuleEnabled(config, 'commerce'))) notFound();
  if (!(await getWishlistConfig()).enabled) notFound();

  const t = await getTranslations({ locale, namespace: 'wishlist' });

  return (
    <section className="bg-soft-pearl pt-20 pb-24 md:pt-28">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6">
        <div>
          <Eyebrow className="mb-4">{t('eyebrow')}</Eyebrow>
          <h1 className="font-display text-midnight-navy text-3xl leading-[1.1] font-semibold tracking-tight md:text-4xl">
            {t('title')}
          </h1>
        </div>
        <WishlistClient locale={locale} />
      </div>
    </section>
  );
}
