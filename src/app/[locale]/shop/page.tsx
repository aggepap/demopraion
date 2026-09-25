import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isModuleEnabled } from '@/cms/core';
import {
  applyProductQuery,
  buildFacetCounts,
  buildTagFacet,
  getPriceControl,
  priceBounds,
  filterByVisibility,
  listCategories,
  listProducts,
} from '@/cms/modules/commerce';
import { CategoryNav } from '@/components/shop/CategoryNav';
import { Pagination } from '@/components/shop/Pagination';
import { ProductCard } from '@/components/shop/ProductCard';
import { ShopFilters } from '@/components/shop/ShopFilters';
import { ShopToolbar } from '@/components/shop/ShopToolbar';
import { Eyebrow } from '@/components/ui/Eyebrow';
import type { Locale } from '@/lib/i18n/config';
import { itemListSchema } from '@/lib/seo/commerce-schema';
import { localizedMetadata } from '@/lib/seo/metadata';
import { jsonLd } from '@/lib/seo/schemas';
import config from '@/site.config';

import { parseShopParams, type ShopSearchParams } from './shop-params';

interface PageProps {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<ShopSearchParams>;
}

// Full SSR so newly-published products appear without a rebuild.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'shop' });
  return localizedMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/shop',
    locale,
  });
}

export default async function ShopPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  if (!(await isModuleEnabled(config, 'commerce'))) notFound();

  const f = parseShopParams(sp);

  const [t, published, categories] = await Promise.all([
    getTranslations({ locale, namespace: 'shop' }),
    listProducts(locale, { limit: 1000 }),
    listCategories(locale),
  ]);

  // A keyword makes this a search results page, which surfaces a different
  // visibility set than plain browsing (a product can be listed in one only).
  const allProducts = filterByVisibility(published, f.q ? 'search' : 'catalog');

    const tagOptions = buildTagFacet(allProducts);
  /*
   * One query object, used for the list AND for the facet counts, so a
   * count can never describe a different query than the grid shows.
   */
  const filterQuery = {
    q: f.q,
    sort: f.sort,
    page: f.page,
    pageSize: 12,
    minPrice: f.minPrice,
    maxPrice: f.maxPrice,
    attrs: f.attrs,
    tags: f.tags,
  };
  const result = applyProductQuery(allProducts, filterQuery);
  const facets = buildFacetCounts(allProducts, filterQuery);
  /*
   * The slider's ends come from the whole set this page is about, before
   * the shopper's own price and attribute choices — otherwise each change
   * would move the ends under the handle they just dropped.
   */
  const bounds = priceBounds(allProducts);
  const priceControl = await getPriceControl();
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const currency = allProducts[0]?.currency ?? 'EUR';

  // ItemList of the products actually shown on this page (§7) — links only, so
  // the linked PDPs carry the full Product graph.
  const itemList = itemListSchema(
    result.items.map((p) => ({ name: p.title, path: `/shop/${p.slug}` })),
    locale,
  );

  return (
    <>
      {result.items.length > 0 ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd({ '@context': 'https://schema.org', ...itemList }) }}
        />
      ) : null}
      <section className="bg-soft-pearl pt-20 md:pt-28 pb-8">
        <div className="max-w-7xl mx-auto px-6">
          <Eyebrow className="mb-4">{t('eyebrow')}</Eyebrow>
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1] text-midnight-navy">
            {t('title')}
          </h1>
          <p className="mt-4 font-body text-base md:text-lg text-text-muted max-w-2xl">{t('intro')}</p>
          {categories.length > 0 ? (
            <div className="mt-8">
              <CategoryNav categories={categories} allLabel={t('allProducts')} />
            </div>
          ) : null}
          <div className="mt-6">
            <ShopToolbar q={f.q} sort={f.sort} />
          </div>
        </div>
      </section>

      <section className="bg-soft-pearl pb-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <ShopFilters
                facets={facets}
                selected={f.attrs}
                minPrice={f.minStr}
                maxPrice={f.maxStr}
                currency={currency}
                locale={locale}
                bounds={bounds}
                priceControl={priceControl}
                tags={tagOptions}
                selectedTags={f.tags}
              />
            </aside>
            <div>
              {result.items.length === 0 ? (
                <p className="font-body text-base text-text-muted">
                  {f.q || facets.length ? t('noResults') : t('empty')}
                </p>
              ) : (
                <>
                  <ul className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-3">
                    {result.items.map((product) => (
                      <ProductCard key={product.slug} product={product} locale={locale} />
                    ))}
                  </ul>
                  <Pagination page={result.page} pageCount={pageCount} />
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
