'use client';

import { useTranslations } from 'next-intl';

import { NewsletterBand } from '@/components/layout/NewsletterBand';
import { useNewsletterEnabled } from '@/components/layout/NewsletterProvider';

/**
 * The home page's newsletter section.
 *
 * Follows the newsletter module exactly as the footer band does: switched off in
 * Admin → Settings → Modules, nothing renders — not even the section around the
 * form, so the page is not left with an empty strip. On the home page the footer
 * band steps aside (`FooterNewsletter`), so there is one signup per page.
 * Signups from here are recorded with source `home`.
 */
export function HomeNewsletter() {
  const t = useTranslations('home.newsletter');
  const form = useTranslations('footer.newsletter');
  const enabled = useNewsletterEnabled();
  if (!enabled) return null;

  return (
    <section className="bg-midnight-navy">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <NewsletterBand
          source="home"
          copy={{
            eyebrow: t('eyebrow'),
            headline: t('headline'),
            description: t('description'),
            emailLabel: form('emailLabel'),
            emailPlaceholder: form('emailPlaceholder'),
            submitLabel: form('submitLabel'),
            submittingLabel: form('submittingLabel'),
            successHeadline: form('successHeadline'),
            successBody: form('successBody'),
            alreadyHeadline: form('alreadyHeadline'),
            alreadyBody: form('alreadyBody'),
            errorBody: form('errorBody'),
          }}
        />
      </div>
    </section>
  );
}
