'use client';

import type { ComponentProps } from 'react';

import { NewsletterBand } from '@/components/layout/NewsletterBand';
import { usePathname } from '@/lib/i18n/routing';
import { showFooterNewsletter } from '@/lib/site/newsletter-placement';

/**
 * The footer's newsletter band, except on the home page, which carries its own
 * signup section (`HomeNewsletter`). The band itself still hides when the
 * newsletter module is off.
 */
export function FooterNewsletter({ copy }: { copy: ComponentProps<typeof NewsletterBand>['copy'] }) {
  const pathname = usePathname();
  if (!showFooterNewsletter(pathname)) return null;
  return <NewsletterBand copy={copy} />;
}
