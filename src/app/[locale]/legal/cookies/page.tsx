import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getPublicCookieDeclaration } from '@/cms/core/cookies/service';
import { PageIntro } from '@/components/site/PageIntro';
import type { Locale } from '@/lib/i18n/config';
import { localizedMetadata } from '@/lib/seo/metadata';
import { breadcrumbSchema, jsonLd, localePath, ORG_ID, SITE_URL, WEBSITE_ID } from '@/lib/seo/schemas';

/**
 * Cookie policy: a short intro plus the declaration an admin manages in
 * Admin → Cookies (and the Cookie scanner checks against what the site stores).
 *
 * Rendered per request: a legal declaration must be right more than it must be
 * cached, and a static entry is one that has to be regenerated.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legalCookies' });
  return localizedMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/legal/cookies',
    locale,
  });
}

/** The locale's text from a per-locale map, falling back to any language. */
function tx(map: Record<string, string> | null | undefined, locale: string): string {
  if (!map) return '';
  return map[locale] ?? Object.values(map)[0] ?? '';
}

export default async function CookiePolicyPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, catalog] = await Promise.all([
    getTranslations({ locale, namespace: 'legalCookies' }),
    getPublicCookieDeclaration(),
  ]);

  const webPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: t('title'),
    url: `${SITE_URL}${localePath(locale, '/legal/cookies')}`,
    isPartOf: { '@id': WEBSITE_ID },
    publisher: { '@id': ORG_ID },
    breadcrumb: breadcrumbSchema(
      [
        { name: t('breadcrumbHome'), path: '/' },
        { name: t('title'), path: '/legal/cookies' },
      ],
      locale,
    ),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(webPage) }} />
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-24">
        <PageIntro title={t('title')} intro={t('intro')} />

        {catalog.length > 0 ? (
          <div className="mt-16">
            <h2 className="font-display text-2xl font-semibold text-midnight-navy mb-8">{t('declaration')}</h2>
            <div className="flex flex-col gap-10">
              {catalog.map((cat) => (
                <div key={cat.id}>
                  <div className="flex items-baseline gap-3">
                    <h3 className="font-display text-lg font-semibold text-midnight-navy">{tx(cat.name, locale)}</h3>
                    {cat.required ? (
                      <span className="rounded-sm bg-bone-cream px-2 py-0.5 text-[11px] uppercase tracking-wider-2 text-text-muted">
                        {t('required')}
                      </span>
                    ) : null}
                  </div>
                  {tx(cat.description, locale) ? (
                    <p className="mt-2 text-sm md:text-base text-text-muted leading-relaxed">{tx(cat.description, locale)}</p>
                  ) : null}
                  {cat.services.length > 0 ? (
                    <div className="mt-4 overflow-x-auto rounded-sm border border-border-soft">
                      <table className="w-full text-sm">
                        <thead className="bg-bone-cream text-left text-xs uppercase tracking-wider-2 text-text-muted">
                          <tr>
                            <th scope="col" className="px-4 py-2">{t('service')}</th>
                            <th scope="col" className="px-4 py-2">{t('provider')}</th>
                            <th scope="col" className="px-4 py-2">{t('purpose')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-soft">
                          {cat.services.map((s) => (
                            <tr key={s.id}>
                              <td className="px-4 py-2 font-medium">{s.name}</td>
                              <td className="px-4 py-2 text-text-muted">{s.provider ?? '—'}</td>
                              <td className="px-4 py-2 text-text-muted">{tx(s.purpose, locale) || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
