import { getTranslations } from 'next-intl/server';

import { FooterLink } from '@/components/layout/FooterLink';
import { FooterNewsletter } from '@/components/site/FooterNewsletter';
import { siteBrand } from '@/lib/brand';
import { LEGAL_LINKS, NAV_ITEMS } from '@/lib/nav';

const linkClass = 'text-sm text-soft-pearl/75 hover:text-soft-pearl transition-colors duration-200';

/**
 * Site footer: newsletter band (when the module is on, and not on the home page,
 * which has its own signup section), brand, links, contact, legal.
 */
export async function Footer() {
  const [t, nav, brand] = await Promise.all([getTranslations('footer'), getTranslations('nav'), siteBrand()]);
  const year = new Date().getFullYear();
  const socials = Object.entries(brand.socials).filter(([, url]) => url);

  return (
    <footer className="bg-midnight-navy text-soft-pearl/85">
      <div className="max-w-7xl mx-auto px-6">
        <FooterNewsletter
          copy={{
            eyebrow: t('newsletter.eyebrow'),
            headline: t('newsletter.headline'),
            description: t('newsletter.description'),
            emailLabel: t('newsletter.emailLabel'),
            emailPlaceholder: t('newsletter.emailPlaceholder'),
            submitLabel: t('newsletter.submitLabel'),
            submittingLabel: t('newsletter.submittingLabel'),
            successHeadline: t('newsletter.successHeadline'),
            successBody: t('newsletter.successBody'),
            alreadyHeadline: t('newsletter.alreadyHeadline'),
            alreadyBody: t('newsletter.alreadyBody'),
            errorBody: t('newsletter.errorBody'),
          }}
        />

        <div className="grid gap-10 border-t border-soft-pearl/15 py-12 md:grid-cols-3">
          <div>
            {brand.logoDarkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- an uploaded file of unknown size; SVG allowed
              <img src={brand.logoDarkUrl} alt={brand.name} className="h-10 w-auto" />
            ) : (
              <p className="font-display text-lg font-semibold text-soft-pearl">{brand.name}</p>
            )}
            {brand.tagline ? <p className="mt-3 max-w-xs text-sm text-soft-pearl/70">{brand.tagline}</p> : null}
          </div>

          <nav aria-labelledby="footer-explore">
            <h2 id="footer-explore" className="mb-4 text-xs font-semibold uppercase tracking-wider-2 text-soft-pearl/60">
              {t('columns.explore')}
            </h2>
            <ul className="flex flex-col gap-3">
              {NAV_ITEMS.map((link) => (
                <li key={link.labelKey}>
                  <FooterLink href={link.href} className={linkClass}>
                    {nav(link.labelKey)}
                  </FooterLink>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider-2 text-soft-pearl/60">
              {t('columns.contact')}
            </h2>
            <ul className="flex flex-col gap-3">
              {brand.email ? (
                <li>
                  <a href={`mailto:${brand.email}`} className={linkClass}>
                    {brand.email}
                  </a>
                </li>
              ) : null}
              {brand.phone ? (
                <li>
                  <a href={`tel:${brand.phoneHref}`} className={linkClass}>
                    {brand.phone}
                  </a>
                </li>
              ) : null}
              {socials.map(([network, url]) => (
                <li key={network}>
                  <a href={url} target="_blank" rel="noopener noreferrer" className={`${linkClass} capitalize`}>
                    {network}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-soft-pearl/15 py-6 text-xs text-soft-pearl/60 md:flex-row md:items-center md:justify-between">
          <p>{t('copyright', { year })}</p>
          <ul className="flex flex-wrap items-center gap-4">
            {LEGAL_LINKS.map((link) => (
              <li key={link.labelKey}>
                <FooterLink href={link.href} className="hover:text-soft-pearl/85">
                  {t(`legal.${link.labelKey}`)}
                </FooterLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
