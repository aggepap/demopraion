import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isModuleEnabled } from '@/cms/core';
import { documentSeo } from '@/cms/core/seo/document';
import { categoryForCollection, getSchemaPolicy } from '@/cms/core/structured-data';
import { getBookingMode, resolveBookingPricing, structuredOfferPrice } from '@/cms/modules/booking';
import { hasRichTextContent, readCancellationTerms } from '@/cms/modules/booking/cancellation';
import { AdminEditTarget } from '@/components/admin-bar/AdminEditTarget';
import { BookingForm } from '@/components/booking/BookingForm';
import { CancellationTerms } from '@/components/booking/CancellationTerms';
import { QuickInfoList } from '@/components/booking/QuickInfoList';
import { RichText } from '@/components/cms/RichText';
import { Breadcrumbs } from '@/components/shop/Breadcrumbs';
import { Eyebrow } from '@/components/ui/Eyebrow';
import type { Locale } from '@/lib/i18n/config';
import { localizedMetadata } from '@/lib/seo/metadata';
import { documentStructuredData, localePath, SITE_URL } from '@/lib/seo/schemas';
import config from '@/site.config';

interface PageProps {
  params: Promise<{ locale: Locale; slug: string }>;
}

export const dynamic = 'force-dynamic';

type Localized = string | Record<string, string> | undefined;

function loc(value: unknown, locale: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const map = value as Record<string, string>;
    return map[locale] ?? Object.values(map).find((v) => typeof v === 'string' && v.trim()) ?? '';
  }
  return '';
}

function arr(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Record<string, unknown>[]) : [];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const resolved = await resolveBookingPricing(slug, locale);
  if (!resolved) return {};
  const data = resolved.data;
  const seo = documentSeo(resolved.doc);
  return localizedMetadata({
    // The SEO title was not read here at all: an editor could fill it in and
    // the experience page went on using the experience's own title.
    title: seo.metaTitle || loc(data.title as Localized, locale) || slug,
    description: seo.metaDescription || loc(data.subtitle as Localized, locale),
    path: `/booking/${slug}`,
    locale,
    ogImage: seo.ogImageUuid ? `${SITE_URL}/api/cms/media/file/${seo.ogImageUuid}` : undefined,
    seo,
  });
}

export default async function BookingDetailPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  if (!(await isModuleEnabled(config, 'booking'))) notFound();

  const resolved = await resolveBookingPricing(slug, locale);
  if (!resolved) notFound();

  const { data, pricing } = resolved;
  const [t, tf, siteMode] = await Promise.all([
    getTranslations({ locale, namespace: 'booking' }),
    getTranslations({ locale, namespace: 'bookingForm' }),
    getBookingMode(),
  ]);

  const itemMode = typeof data.bookingMode === 'string' ? data.bookingMode : 'inherit';
  const mode = itemMode === 'request' || itemMode === 'instant' ? itemMode : siteMode;

  const title = loc(data.title as Localized, locale) || slug;
  // Keep the editor's alt text: the gallery repeater collects one per image
  // (booking/collection.ts), and projecting to the uuid alone silently threw it
  // away, leaving screen-reader users with an empty alt on real content.
  const gallery = arr(data.gallery)
    .map((g) => ({
      uuid: typeof g.image === 'string' ? g.image : null,
      alt: typeof g.alt === 'string' ? g.alt.trim() : '',
    }))
    .filter((g): g is { uuid: string; alt: string } => Boolean(g.uuid));
  const faq = arr(data.faq);
  // Both were editable on the experience and shown nowhere.
  const cancellation = readCancellationTerms(data);
  const formNote = hasRichTextContent(data.formNote) ? data.formNote : null;

  const offerPrice = structuredOfferPrice(data, pricing.basePrice);

  // A day trip and a stay are different things to search engines; each kind's
  // type (TouristTrip, Apartment…) is set in Settings → Structured data.
  const structuredData = documentStructuredData({
    category: categoryForCollection('booking', { kind: resolved.kind }) ?? 'bookingTransport',
    seo: documentSeo(resolved.doc),
    policy: await getSchemaPolicy(config),
    url: `${SITE_URL}${localePath(locale, `/booking/${slug}`)}`,
    locale,
    facts: {
      name: title,
      description: loc(data.subtitle as Localized, locale) || undefined,
      images: gallery.map((g) => `${SITE_URL}/api/cms/media/file/${g.uuid}`),
      // A stay has no base price — it is priced per night — so it advertises
      // its lowest nightly rate instead of nothing.
      offers: offerPrice != null ? { '@type': 'Offer', price: offerPrice, priceCurrency: pricing.currency } : null,
    },
    crumbs: [
      { name: t('title'), path: '/booking' },
      { name: title, path: `/booking/${slug}` },
    ],
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <AdminEditTarget doc={resolved.doc} />
      <Breadcrumbs
        items={[
          { label: t('title'), href: '/booking' },
          { label: title, href: `/booking/${slug}` },
        ]}
      />

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-6">
          <header>
            <Eyebrow>{t('eyebrow')}</Eyebrow>
            <h1 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">{title}</h1>
            {data.subtitle ? (
              <p className="mt-2 text-lg text-neutral-600">{loc(data.subtitle as Localized, locale)}</p>
            ) : null}
            <QuickInfoList
              showLabels
              className="mt-4 text-sm"
              items={arr(data.quickInfo).map((q) => ({
                icon: typeof q.icon === 'string' ? q.icon : undefined,
                label: loc(q.label as Localized, locale),
                value: String(q.value ?? ''),
                suffix: loc(q.suffix as Localized, locale) || undefined,
              }))}
            />
          </header>

          {gallery.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {gallery.map((img, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- CMS media is served by uuid, not a static import
                <img
                  key={img.uuid}
                  src={`/api/cms/media/file/${img.uuid}`}
                  alt={img.alt || `${title} — ${i + 1}`}
                  className="aspect-[4/3] w-full rounded-sm object-cover"
                  loading="lazy"
                />
              ))}
            </div>
          ) : null}

          {data.availableFrom && data.availableTo ? (
            <p className="text-sm text-neutral-600">
              {t('season', { from: String(data.availableFrom), to: String(data.availableTo) })}
            </p>
          ) : null}

          <CancellationTerms
            freeCancellationDays={cancellation.freeCancellationDays}
            policy={cancellation.policy}
            labels={{
              title: t('cancellationTitle'),
              freeCancellation: t('freeCancellation', { days: cancellation.freeCancellationDays ?? 0 }),
            }}
          />

          {faq.length > 0 ? (
            <section>
              <h2 className="font-display text-xl font-semibold">{t('faq')}</h2>
              <dl className="mt-3 flex flex-col gap-4">
                {faq.map((row, i) => {
                  const answer = row.answer && typeof row.answer === 'object' ? row.answer : null;
                  return (
                    <div key={String(row.id ?? i)}>
                      <dt className="font-medium">{loc(row.question as Localized, locale)}</dt>
                      {answer ? (
                        <dd className="mt-1 text-sm text-neutral-600">
                          <RichText value={answer} />
                        </dd>
                      ) : null}
                    </div>
                  );
                })}
              </dl>
            </section>
          ) : null}
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <BookingForm
            slug={slug}
            locale={locale}
            currency={pricing.currency}
            mode={mode}
            kind={resolved.kind}
            hasPersons={pricing.hasPersons}
            minPersons={pricing.minPersons}
            maxPersons={pricing.maxPersons}
            resourceLabel={loc(data.optionsLabel as Localized, locale) || undefined}
            resources={resolved.resources.map((r) => ({ id: r.groupId, title: r.title }))}
            extras={pricing.extras.enabled ? pricing.extras.options : []}
            extrasMultiplyPerPerson={pricing.extras.multiplyPerPerson}
            choices={arr(data.choices).map((c) => ({
              id: String(c.id ?? ''),
              title: loc(c.title as Localized, locale),
              options: arr(c.options).map((o) => String(o.value ?? '')),
            }))}
            labels={{
              title: tf('title'),
              date: tf('date'),
              datePlaceholder: tf('datePlaceholder'),
              persons: tf('persons'),
              personsRange: tf('personsRange', { min: pricing.minPersons, max: pricing.maxPersons }),
              resource: tf('resource'),
              extras: tf('extras'),
              extrasPerPerson: tf('extrasPerPerson'),
              yourDetails: tf('yourDetails'),
              name: tf('name'),
              email: tf('email'),
              phone: tf('phone'),
              notes: tf('notes'),
              terms: tf('terms'),
              submitRequest: tf('submitRequest'),
              submitInstant: tf('submitInstant', { price: '{price}' }),
              submitting: tf('submitting'),
              noteRequest: tf('noteRequest'),
              noteInstant: tf('noteInstant'),
              breakdownTitle: tf('breakdownTitle'),
              total: tf('total'),
              pricePending: tf('pricePending'),
              onRequest: t('onRequest'),
              successTitle: tf('successTitle'),
              successBody: tf('successBody', { reference: '{reference}' }),
              lookupLink: tf('lookupLink'),
              errorGeneric: tf('errorGeneric'),
              checkIn: tf('checkIn'),
              checkOut: tf('checkOut'),
              adults: tf('adults'),
              children: tf('children'),
              childrenHint: tf('childrenHint', { age: '{age}' }),
              nights: tf('nights', { count: '{count}' }),
              perNight: tf('perNight'),
              minNights: tf('minNights', { count: '{count}' }),
              maxNights: tf('maxNights', { count: '{count}' }),
              occupancyRange: tf('occupancyRange', { max: '{max}' }),
              clearDates: tf('clearDates'),
              pickCheckOut: tf('pickCheckOut'),
              calendarAvailable: tf('calendarAvailable'),
              calendarUnavailable: tf('calendarUnavailable'),
              calendarSelected: tf('calendarSelected'),
              calendarPrevMonth: tf('calendarPrevMonth'),
              calendarNextMonth: tf('calendarNextMonth'),
              // Keyed by the server's `DayStatus`, so a new reason surfaces as
              // a missing key rather than as a silently generic message.
              unavailable: {
                past: tf('unavailablePast'),
                out_of_season: tf('unavailableOutOfSeason'),
                wrong_weekday: tf('unavailableWrongWeekday'),
                too_soon: tf('unavailableTooSoon'),
                too_far: tf('unavailableTooFar'),
                full: tf('unavailableFull'),
                closed: tf('unavailableClosed'),
                invalid_range: tf('unavailableInvalidRange'),
                min_nights: tf('unavailableMinNights'),
                max_nights: tf('unavailableMaxNights'),
                bad_checkin_day: tf('unavailableBadCheckinDay'),
                bad_checkout_day: tf('unavailableBadCheckoutDay'),
              },
            }}
          />
          {formNote ? <RichText value={formNote} className="mt-4 text-sm text-neutral-600" /> : null}
        </div>
      </div>

      {structuredData ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      ) : null}
    </main>
  );
}
