import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NotFoundContent } from '@/components/site/NotFoundContent';
import type { Locale } from '@/lib/i18n/config';
import { siteBrand } from '@/lib/brand';

/**
 * The 404 page the `[...rest]` catch-all redirects to. A real route (so it has
 * the header, footer and styles) that is kept out of search results.
 */
interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const [t, brand] = await Promise.all([getTranslations({ locale, namespace: 'notFound' }), siteBrand()]);
  return {
    title: { absolute: `${t('h1')} | ${brand.name}` },
    alternates: { canonical: null },
    robots: { index: false, follow: false },
  };
}

export default async function PageNotFound({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <NotFoundContent />;
}
