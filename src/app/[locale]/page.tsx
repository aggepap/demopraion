import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isModuleEnabled } from '@/cms/core';
import { filterByVisibility, listCategories, listProducts } from '@/cms/modules/commerce';
import { ProductCard } from '@/components/shop/ProductCard';
import { HomeNewsletter } from '@/components/site/HomeNewsletter';
import { ContactCta, HomeHero, LatestContent } from '@/components/site/HomeSections';
import type { Locale } from '@/lib/i18n/config';
import { Link } from '@/lib/i18n/routing';
import { localizedMetadata } from '@/lib/seo/metadata';
import { siteBrand } from '@/lib/brand';
import config from '@/site.config';

/**
 * Home: hero (CMS page `home`), categories and featured products while the
 * commerce module is on, latest content, contact CTA. Every block has an empty
 * state, so the page is complete before anything is published.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const [t, brand] = await Promise.all([getTranslations({ locale, namespace: 'home' }), siteBrand()]);
  return localizedMetadata({ title: brand.name, description: t('metaDescription'), path: '/', locale });
}

export default async function HomePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, commerceOn] = await Promise.all([
    getTranslations({ locale, namespace: 'home' }),
    isModuleEnabled(config, 'commerce'),
  ]);

  let categories: Awaited<ReturnType<typeof listCategories>> = [];
  let products: Awaited<ReturnType<typeof listProducts>> = [];
  if (commerceOn) {
    [categories, products] = await Promise.all([listCategories(locale), listProducts(locale, { limit: 24 })]);
  }
  // Same visibility rule as the shop's browse view: hidden products stay hidden.
  const featured = filterByVisibility(products, 'catalog').slice(0, 8);

  return (
    <>
      <HomeHero locale={locale} cta={commerceOn ? { href: '/shop', label: t('shopCta') } : undefined} />

      {commerceOn ? (
        <section className="max-w-7xl mx-auto px-6 py-20">
          {categories.length > 0 ? (
            <div className="mb-16">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-midnight-navy">
                {t('categoriesTitle')}
              </h2>
              <ul className="mt-6 flex flex-wrap gap-3">
                {categories.map((c) => (
                  <li key={c.slug}>
                    <Link
                      href={c.href}
                      className="inline-block rounded-sm border border-border-soft px-4 py-2 text-sm font-medium text-text-primary hover:border-midnight-navy"
                    >
                      {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-midnight-navy">{t('productsTitle')}</h2>
            <Link href="/shop" className="text-sm font-medium text-warm-gold-deep hover:underline underline-offset-4">
              {t('shopCta')}
            </Link>
          </div>
          {featured.length === 0 ? (
            <p className="mt-8 rounded-sm border border-border-soft bg-bone-cream p-8 text-center text-text-muted">
              {t('productsEmpty')}
            </p>
          ) : (
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((product) => (
                <ProductCard key={product.slug} product={product} locale={locale} />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <LatestContent locale={locale} />
      <HomeNewsletter />
      <ContactCta locale={locale} />
    </>
  );
}
