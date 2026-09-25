import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AdminEditTarget } from '@/components/admin-bar/AdminEditTarget';
import { RichText } from '@/components/cms/RichText';
import { ContactForm } from '@/components/site/ContactForm';
import { PageIntro } from '@/components/site/PageIntro';
import { resolveRenderDoc } from '@/lib/cms/resolve-doc';
import type { Locale } from '@/lib/i18n/config';
import { localizedMetadata } from '@/lib/seo/metadata';
import { siteBrand } from '@/lib/brand';

/**
 * /contact — the form plus contact details. The title and intro come from the
 * CMS page with slug `contact` when it is published; the messages are the
 * fallback until then.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contact' });
  return localizedMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/contact', locale });
}

export default async function ContactPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, doc, brand] = await Promise.all([
    getTranslations({ locale, namespace: 'contact' }),
    resolveRenderDoc('page', 'contact', locale),
    siteBrand(),
  ]);
  const data = (doc?.data ?? {}) as Record<string, unknown>;
  const title = typeof data.title === 'string' && data.title ? data.title : t('title');
  const address = [brand.address.street, [brand.address.postcode, brand.address.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');

  return (
    <section className="max-w-7xl mx-auto px-6 pt-20 pb-24">
      {doc ? <AdminEditTarget doc={doc} /> : null}
      <PageIntro eyebrow={t('eyebrow')} title={title} />
      <RichText value={data.body} className="article-prose mt-6 max-w-2xl text-lg text-text-muted" />

      <div className="mt-12 grid gap-12 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ContactForm />
        </div>
        <aside aria-labelledby="contact-details" className="rounded-sm bg-bone-cream p-6">
          <h2 id="contact-details" className="font-display text-lg font-semibold text-midnight-navy">
            {t('detailsTitle')}
          </h2>
          <ul className="mt-4 flex flex-col gap-3 text-text-muted">
            {brand.email ? (
              <li>
                <a href={`mailto:${brand.email}`} className="hover:text-text-primary">
                  {brand.email}
                </a>
              </li>
            ) : null}
            {brand.phone ? (
              <li>
                <a href={`tel:${brand.phoneHref}`} className="hover:text-text-primary">
                  {brand.phone}
                </a>
              </li>
            ) : null}
            {address ? <li>{address}</li> : null}
          </ul>
        </aside>
      </div>
    </section>
  );
}
