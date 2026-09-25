import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isModuleEnabled } from '@/cms/core';
import { RecoverCartClient } from '@/components/shop/cart/RecoverCartClient';
import type { Locale } from '@/lib/i18n/config';
import config from '@/site.config';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export const dynamic = 'force-dynamic';

// A one-shot redirect page reached from a recovery email — keep it out of search.
export const metadata = { robots: { index: false, follow: false } };

export default async function RecoverCartPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await isModuleEnabled(config, 'commerce'))) notFound();
  return <RecoverCartClient locale={locale} />;
}
