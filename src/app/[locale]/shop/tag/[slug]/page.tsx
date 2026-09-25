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
  listProductsByTag,
} from '@/cms/modules/commerce';
import { AdminEditTarget } from '@/components/admin-bar/AdminEditTarget';
import { Breadcrumbs, type Crumb } from '@/components/shop/Breadcrumbs';
import { Pagination } from '@/components/shop/Pagination';
import { ProductCard } from '@/components/shop/ProductCard';
import { ShopFilters } from '@/components/shop/ShopFilters';
import { ShopToolbar } from '@/components/shop/ShopToolbar';
import { Eyebrow } from '@/components/ui/Eyebrow';
import type { Locale } from '@/lib/i18n/config';
import { itemListSchema } from '@/lib/seo/commerce-schema';
import { localizedMetadata } from '@/lib/seo/metadata';
import { breadcrumbSchema, jsonLd } from '@/lib/seo/schemas';
import config from '@/site.config';

import { parseShopParams, type ShopSearchParams } from '../../shop-params';

interface PageProps {
  params: Promise<{ locale: Locale; slug: string }>;
  searchParams: Promise<ShopSearchParams>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const result = await listProductsByTag(slug, locale);
  if (!result) return {};
  return localizedMetadata({
    title: result.tag.title,
    description: result.tag.title,
    path: `/shop/tag/${slug}`,
    locale,
  });
}

export default async function TagPage({ params, searchParams }: PageProps) {
  const { locale, slug } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  if (!(await isModuleEnabled(config, 'commerce'))) notFound();

  const f = parseShopParams(sp);

  const [t, result] = await Promise.all([
    getTranslations({ locale, namespace: 'shop' }),
    listProductsByTag(slug, locale),
  ]);
  if (!result) notFound();

  // Same visibility rule as /shop: a keyword turns this into a search.
  const products = filterByVisibility(result.products, f.q ? 'search' : 'catalog');
    // The archive tag is already applied, so offer only the *other* tags in the set.
  const tagOptions = buildTagFacet(products).filter((tag) => tag.slug !== slug);
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
  const query = applyProductQuery(products, filterQuery);
  const facets = buildFacetCounts(products, filterQuery);
  /*
   * The slider's ends come from the whole set this page is about, before
   * the shopper's own price and attribute choices — otherwise each change
   * would move the ends under the handle they just dropped.
   */
  const bounds = priceBounds(products);
  const priceControl = await getPriceControl();
  const pageCount = Math.max(1, Math.ceil(query.total / query.pageSize));
  const currency = products[0]?.currency ?? 'EUR';

  const crumbs: Crumb[] = [{ label: t('title'), href: '/shop' }, { label: result.tag.title }];
  const breadcrumbLd = breadcrumbSchema(
    [
      { name: t('title'), path: '/shop' },
      { name: result.tag.title, path: `/shop/tag/${slug}` },
    ],
    locale,
  );
  const itemList = itemListSchema(
    query.items.map((p) => ({ name: p.title, path: `/shop/${p.slug}` })),
    locale,
  );

  return (
    <>
      <AdminEditTarget doc={result.document} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            '@context': 'https://schema.org',
            '@graph': query.items.length > 0 ? [breadcrumbLd, itemList] : [breadcrumbLd],
          }),
        }}
      />
      <section className="bg-soft-pearl pt-20 md:pt-28 pb-8">
        <div className="max-w-7xl mx-auto px-6">
          <Breadcrumbs items={crumbs} className="mb-4" />
          <Eyebrow className="mb-3">{t('tagEyebrow')}</Eyebrow>
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1] text-midnight-navy">
            {result.tag.title}
          </h1>
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
              {query.items.length === 0 ? (
                <p className="font-body text-base text-text-muted">
                  {f.q || facets.length ? t('noResults') : t('empty')}
                </p>
              ) : (
                <>
                  <ul className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-3">
                    {query.items.map((product) => (
                      <ProductCard key={product.slug} product={product} locale={locale} />
                    ))}
                  </ul>
                  <Pagination page={query.page} pageCount={pageCount} />
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
