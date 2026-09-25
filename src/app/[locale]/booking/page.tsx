import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isModuleEnabled } from '@/cms/core';
import {
  applyBookingQuery,
  countTermUsage,
  getBookingCurrency,
  listBookings,
  listBookingTermDocs,
  termIdsBySlug,
} from '@/cms/modules/booking';
import { BookingCard } from '@/components/booking/BookingCard';
import { BookingFilters, type FilterGroup } from '@/components/booking/BookingFilters';
import { BookingToolbar } from '@/components/booking/BookingToolbar';
import { Pagination } from '@/components/shop/Pagination';
import { Eyebrow } from '@/components/ui/Eyebrow';
import type { Locale } from '@/lib/i18n/config';
import { itemListSchema } from '@/lib/seo/commerce-schema';
import { localizedMetadata } from '@/lib/seo/metadata';
import { jsonLd } from '@/lib/seo/schemas';
import config from '@/site.config';

import { BOOKING_PAGE_SIZE, parseBookingParams, type RawSearchParams } from './booking-params';

interface PageProps {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<RawSearchParams>;
}

// Full SSR so a newly-published experience appears without a rebuild, and so the
// module gate is re-read per request.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'booking' });
  return localizedMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/booking',
    locale,
  });
}

export default async function BookingListingPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  if (!(await isModuleEnabled(config, 'booking'))) notFound();

  const parsed = parseBookingParams(sp);

  const [t, items, currency] = await Promise.all([
    getTranslations({ locale, namespace: 'booking' }),
    listBookings(locale),
    getBookingCurrency(),
  ]);

  // Facet counts are computed over the WHOLE published set, not the current
  // page — a count that only described the visible page would be worse than no
  // count at all.
  //
  // All three dimensions are term documents, and they are fetched in ONE query
  // rather than one per dimension; the counting is then pure, over the items
  // already in hand.
  const termDocs = await listBookingTermDocs(
    ['booking_category', 'vessel_type', 'departure_location'],
    locale,
  );
  const categoryDocs = termDocs.get('booking_category') ?? [];
  const typeDocs = termDocs.get('vessel_type') ?? [];
  const departureDocs = termDocs.get('departure_location') ?? [];

  const categories = countTermUsage(categoryDocs, items, (i) => i.categoryIds);
  const types = countTermUsage(typeDocs, items, (i) => i.typeIds);
  const departures = countTermUsage(departureDocs, items, (i) => i.departureIds);

  const filtered = applyBookingQuery(
    items,
    {
      q: parsed.q,
      sort: parsed.sort,
      categories: parsed.categories,
      types: parsed.types,
      departures: parsed.departures,
    },
    {
      categories: termIdsBySlug(categoryDocs),
      types: termIdsBySlug(typeDocs),
      departures: termIdsBySlug(departureDocs),
    },
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / BOOKING_PAGE_SIZE));
  const page = Math.min(parsed.page, pageCount);
  const visible = filtered.slice((page - 1) * BOOKING_PAGE_SIZE, page * BOOKING_PAGE_SIZE);

  const groups: FilterGroup[] = [
    { key: 'category', label: t('filterService'), terms: categories, selected: parsed.categories },
    { key: 'type', label: t('filterType'), terms: types, selected: parsed.types },
    { key: 'departure', label: t('filterDeparture'), terms: departures, selected: parsed.departures },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8 max-w-2xl">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h1 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">{t('title')}</h1>
        <p className="mt-3 text-neutral-600">{t('intro')}</p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <BookingFilters
          groups={groups}
          labels={{ filters: t('filters'), clear: t('clearFilters'), search: t('searchPlaceholder') }}
        />

        <div className="flex flex-col gap-6">
          <BookingToolbar
            q={parsed.q}
            sort={parsed.sort}
            labels={{
              searchPlaceholder: t('searchPlaceholder'),
              sortLabel: t('sortLabel'),
              resultCount: t('resultCount', { count: filtered.length }),
              sortOptions: [
                { value: 'title-asc', label: t('sortTitleAsc') },
                { value: 'title-desc', label: t('sortTitleDesc') },
                { value: 'price-asc', label: t('sortPriceAsc') },
                { value: 'price-desc', label: t('sortPriceDesc') },
              ],
            }}
          />

          {visible.length === 0 ? (
            // "Nothing published yet" and "nothing matches your filters" are
            // different problems for the reader, so they get different words.
            <p className="rounded-sm border border-neutral-200 bg-neutral-50 p-8 text-center text-neutral-600">
              {items.length === 0 ? t('empty') : t('noResults')}
            </p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((item) => (
                <BookingCard
                  key={item.slug}
                  item={item}
                  currency={currency}
                  locale={locale}
                  labels={{
                    fromPrice: (price) => t('fromPrice', { price }),
                    fromPriceNight: (price) => t('fromPriceNight', { price }),
                    onRequest: t('onRequest'),
                    viewDetails: t('viewDetails'),
                  }}
                />
              ))}
            </div>
          )}

          {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} namespace="booking" /> : null}
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            '@context': 'https://schema.org',
            ...itemListSchema(
              visible.map((i) => ({ name: i.title, path: i.href })),
              locale,
            ),
          }),
        }}
      />
    </main>
  );
}
