import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import {
  getCustomFieldsConfig,
  groupCustomFieldValues,
  isModuleEnabled,
  type CustomFieldGroupValues,
} from '@/cms/core';
import { documentSeo } from '@/cms/core/seo/document';
import { getSchemaPolicy } from '@/cms/core/structured-data';
import { log404 } from '@/cms/core/seo/resolve';
import {
  getCategoriesByIds,
  getGiftCardConfig,
  getGroupedComponents,
  getProduct,
  getRatingAggregate,
  getSiteCurrency,
  getSizeChartForProduct,
  getTagsByIds,
  groupedTotal,
  listApprovedReviews,
  quantityRules,
  toBadges,
} from '@/cms/modules/commerce';
import { AdminEditTarget } from '@/components/admin-bar/AdminEditTarget';
import { RichText } from '@/components/cms/RichText';
import { Breadcrumbs, type Crumb } from '@/components/shop/Breadcrumbs';
import { CustomFieldValues, type ValueRow } from '@/components/shop/CustomFieldValues';
import { ProductReviews } from '@/components/shop/ProductReviews';
import { ProductShowcase, type GroupedComponentView } from '@/components/shop/ProductShowcase';
import { projectShowcase } from '@/components/shop/showcase-data';
import { RecentlyViewed } from '@/components/shop/RecentlyViewed';
import { ProductTabs, type ProductTab } from '@/components/shop/ProductTabs';
import { SizeChart } from '@/components/shop/SizeChart';
import type { Locale } from '@/lib/i18n/config';
import { Link } from '@/lib/i18n/routing';
import { availabilityToOg, localeUrl, priceString, productSchema } from '@/lib/seo/commerce-schema';
import { localizedMetadata } from '@/lib/seo/metadata';
import { documentStructuredData, SITE_URL } from '@/lib/seo/schemas';
import config from '@/site.config';
import { PmStructuredData } from '@/cms/modules/pm/PmStructuredData';

interface PageProps {
  params: Promise<{ locale: Locale; slug: string }>;
}

export const dynamic = 'force-dynamic';

const mediaUrl = (uuid: string) => `/api/cms/media/file/${uuid}`;

type Localized = string | Record<string, string> | undefined;

interface GalleryImage {
  image?: string;
  alt?: string;
}

/** Resolve a (possibly localized) label to a display string for `locale`. */
function resolveLoc(v: Localized, locale: string, defaultLocale: string): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const pick = (l: string) => (typeof v[l] === 'string' && v[l].trim() ? v[l] : undefined);
    const any = Object.values(v).find((x) => typeof x === 'string' && x.trim());
    return (pick(locale) || pick(defaultLocale) || any || '').trim();
  }
  return '';
}
interface Spec {
  label?: string;
  value?: string;
}

/**
 * Flatten one admin-defined custom value into display text for the current
 * locale. Localized fields arrive as `{ [locale]: value }` maps; the rest are
 * scalars, arrays (multiselect / relation ids) or repeater rows.
 */
function resolveCustomValue(value: unknown, kind: string, locale: string, defaultLocale: string): string {
  if (value == null) return '';
  if (kind === 'boolean') return value ? '✓' : '—';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        entry && typeof entry === 'object'
          ? Object.values(entry as Record<string, unknown>)
              .filter((v) => typeof v === 'string' || typeof v === 'number')
              .join(' · ')
          : String(entry),
      )
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    // Either a localized map or a rich-text doc (rendered as its text runs).
    const obj = value as Record<string, unknown>;
    if (obj.type === 'doc') return '';
    return resolveLoc(obj as Record<string, string>, locale, defaultLocale);
  }
  return '';
}

/** A resolved custom-field group → the rows its table renders. */
function toValueRows(
  group: CustomFieldGroupValues,
  locale: string,
  defaultLocale: string,
): ValueRow[] {
  return group.fields
    .map((field) => ({
      label: resolveLoc(field.label, locale, defaultLocale) || field.key,
      value: resolveCustomValue(field.value, field.kind, locale, defaultLocale),
    }))
    .filter((row) => row.value !== '');
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const [doc, currency] = await Promise.all([getProduct(slug, locale), getSiteCurrency()]);
  if (!doc) return {};
  const data = doc.data as Record<string, unknown>;
  const seo = documentSeo(doc);
  const title = seo.metaTitle || String(data.title ?? '');
  const description = seo.metaDescription || (data.subtitle ? String(data.subtitle) : '');

  const gallery = (Array.isArray(data.gallery) ? data.gallery : []) as GalleryImage[];
  const firstImage = gallery.find((g) => g.image)?.image;
  // A social image chosen in the SEO panel beats the first gallery shot, which
  // is only ever a guess at what the product looks like in a feed.
  const ogUuid = seo.ogImageUuid ?? firstImage;
  const ogImage = ogUuid ? `${SITE_URL}${mediaUrl(ogUuid)}` : undefined;

  const meta = await localizedMetadata({
    title,
    description,
    path: `/shop/${slug}`,
    locale,
    ogImage,
    seo,
  });

  // Open Graph / Twitter product tags — price + availability that Facebook,
  // Pinterest and rich-preview unfurlers read (schema.org covers crawlers; see
  // the JSON-LD below). Added via `other` so they sit alongside the standard OG
  // tags localizedMetadata already emits.
  const price = Number(data.price ?? 0);
  return {
    ...meta,
    other: {
      'og:type': 'product',
      'product:price:amount': priceString(price),
      'product:price:currency': currency,
      'product:availability': availabilityToOg(String(data.availability ?? 'in-stock')),
      'twitter:label1': 'Price',
      'twitter:data1': `${priceString(price)} ${currency}`,
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  if (!(await isModuleEnabled(config, 'commerce'))) notFound();

  const doc = await getProduct(slug, locale);
  if (!doc) {
    await log404(`/shop/${slug}`, locale);
    notFound();
  }

  const [t, currency, customFields] = await Promise.all([
    getTranslations({ locale, namespace: 'shop' }),
    getSiteCurrency(),
    getCustomFieldsConfig('product'),
  ]);

  const data = doc.data as Record<string, unknown>;
  const title = String(data.title ?? doc.metaTitle ?? '');
  const subtitle = data.subtitle ? String(data.subtitle) : '';
  const price = Number(data.price ?? 0);
  const compareAt = data.compareAtPrice != null ? Number(data.compareAtPrice) : undefined;
  const availability = String(data.availability ?? 'in-stock');
  const gallery = (Array.isArray(data.gallery) ? data.gallery : []) as GalleryImage[];
  const specs = (Array.isArray(data.specs) ? data.specs : []) as Spec[];
  // Media/label projection shared with the quick-view modal (`showcase-data.ts`).
  const sc = projectShowcase(data, { locale, defaultLocale: config.defaultLocale });
  const categoryIds = (Array.isArray(data.categories) ? data.categories : []) as number[];
  const tagIds = (Array.isArray(data.tags) ? data.tags : []) as number[];
  // Moderated reviews for this product group (stable across locales).
  const productGroupId = doc.translationGroupId ?? String(doc.id);

  // One wave: every input here comes from `doc`/`data`, which are already
  // resolved, so none of these five depends on another's result. They used to
  // run as two sequential `Promise.all` groups, which cost a round trip for
  // nothing.
  const [categories, tags, aggregate, reviews, sizeChart] = await Promise.all([
    getCategoriesByIds(categoryIds, locale),
    getTagsByIds(tagIds, locale),
    getRatingAggregate(productGroupId),
    listApprovedReviews(productGroupId, 20),
    getSizeChartForProduct(data, locale),
  ]);
  const badges = toBadges(data, locale);

  // ── Product type (§5) ──────────────────────────────────────────────────────
  // `external` / `digital` come from the shared projection; `grouped` needs an
  // async component lookup, so it's resolved here.
  const { productType, external, digital } = sc;

  let grouped: GroupedComponentView[] | undefined;
  let displayPrice = price;
  if (productType === 'grouped') {
    const entries = Array.isArray(data.components) ? data.components : [];
    const components = await getGroupedComponents(entries, locale);
    grouped = components.map((c) => ({
      slug: c.slug,
      title: c.title,
      quantity: c.quantity,
      unitPrice: c.price,
      imageUrl: c.image?.image ? mediaUrl(c.image.image) : undefined,
      href: `/shop/${c.slug}`,
      availability: c.availability,
    }));
    // The group's own price wins when set; otherwise the summed components.
    displayPrice = price > 0 ? price : groupedTotal(components.map((c) => ({ price: c.price, quantity: c.quantity })));
  }

  // Gift card: the amounts and limits come from Settings → Ecommerce → Gift
  // cards. Switched off, the page says so instead of offering a form.
  const giftCard =
    productType === 'giftcard'
      ? (({ enabled, presets, allowCustom, minAmount, maxAmount }) => ({
          enabled,
          presets,
          allowCustom,
          minAmount,
          maxAmount,
        }))(await getGiftCardConfig())
      : undefined;

  // Admin-defined fields, scoped to this product's categories and split by the
  // group each was assigned to: `tab` groups become their own tab, everything
  // else joins the specifications table.
  const customGroups = groupCustomFieldValues(customFields, data, categoryIds);
  const specRows: ValueRow[] = [
    ...specs
      .filter((s) => s.label && s.value)
      .map((s) => ({ label: String(s.label), value: String(s.value) })),
    ...customGroups
      .filter((g) => g.renderAs !== 'tab')
      .flatMap((g) => toValueRows(g, locale, config.defaultLocale)),
  ];

  const tabs: ProductTab[] = [];
  const description = <RichText value={data.description} className="flex flex-col gap-4 font-body text-base md:text-lg text-text-primary leading-relaxed" />;
  if (data.description) tabs.push({ id: 'description', label: t('tabs.description'), content: description });
  if (specRows.length > 0) {
    tabs.push({
      id: 'specifications',
      label: t('tabs.specifications'),
      content: <CustomFieldValues rows={specRows} />,
    });
  }
  for (const group of customGroups) {
    if (group.renderAs !== 'tab') continue;
    const rows = toValueRows(group, locale, config.defaultLocale);
    if (rows.length === 0) continue;
    tabs.push({
      id: group.key,
      label: resolveLoc(group.label, locale, config.defaultLocale) || group.key,
      content: <CustomFieldValues rows={rows} />,
    });
  }

  const images = sc.images;
  const showcaseAttributes = sc.attributes;
  const showcaseVariations = sc.variations;
  const allImageUrls = sc.allImageUrls;

  // ── Structured data (§7) ─────────────────────────────────────────────────
  // Breadcrumbs: Shop → first category (if any) → this product. The visible
  // trail and the BreadcrumbList JSON-LD are built from the same list so they
  // can't drift.
  const productPath = `/shop/${slug}`;
  const crumbs: Crumb[] = [
    { label: t('title'), href: '/shop' },
    ...(categories[0] ? [{ label: categories[0].title, href: categories[0].href }] : []),
    { label: title },
  ];
  const breadcrumbPaths = [
    { name: t('title'), path: '/shop' },
    ...(categories[0] ? [{ name: categories[0].title, path: categories[0].href }] : []),
    { name: title, path: productPath },
  ];

  const productLd = productSchema({
    name: title,
    description: subtitle || undefined,
    path: productPath,
    locale,
    images: allImageUrls.map((url) => `${SITE_URL}${url}`),
    sku: data.sku ? String(data.sku) : undefined,
    gtin: data.gtin ? String(data.gtin) : undefined,
    mpn: data.mpn ? String(data.mpn) : undefined,
    brand: data.brand ? String(data.brand) : undefined,
    condition: data.condition ? String(data.condition) : undefined,
    currency,
    availability,
    price,
    variantPrices: showcaseVariations
      .filter((v) => v.enabled !== false && v.price != null)
      .map((v) => Number(v.price)),
    category: categories[0]?.title,
    // Only real, approved reviews reach structured data.
    aggregateRating:
      aggregate.count > 0
        ? { ratingValue: aggregate.average, reviewCount: aggregate.count }
        : undefined,
    reviews: reviews.map((r) => ({
      author: r.authorName,
      ratingValue: r.rating,
      title: r.title ?? undefined,
      body: r.body,
      datePublished: new Date(r.createdAt).toISOString(),
    })),
  });

  return (
    <section className="bg-soft-pearl pt-20 md:pt-28 pb-24">
      <AdminEditTarget doc={doc} />
      <PmStructuredData
        path={`/shop/${slug}`}
        locale={locale}
        fallbackJson={documentStructuredData({
          category: 'products',
          seo: documentSeo(doc),
          policy: await getSchemaPolicy(config),
          url: localeUrl(productPath, locale),
          locale,
          // Which parts of it (brand, reviews, price) are kept is set in
          // Settings → Structured data.
          facts: { name: title, productNode: productLd },
          crumbs: breadcrumbPaths,
        })}
      />
      <div className="max-w-7xl mx-auto px-6">
        <Breadcrumbs items={crumbs} className="mb-8" />

        <ProductShowcase
          productId={doc.id}
          slug={slug}
          title={title}
          subtitle={subtitle || undefined}
          images={images}
          attributes={showcaseAttributes}
          variations={showcaseVariations}
          basePrice={displayPrice}
          compareAt={compareAt}
          currency={currency}
          locale={locale}
          baseAvailability={availability}
          badges={badges}
          rating={aggregate.count > 0 ? aggregate : undefined}
          hasSizeGuide={Boolean(sizeChart)}
          external={external}
          grouped={grouped}
          digital={digital}
          quantityRules={quantityRules(data)}
          giftCard={giftCard}
        />

        {categories.length > 0 ? (
          <div className="mt-10 flex flex-wrap items-center gap-2">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={c.href}
                className="rounded-sm border border-border-soft px-3 py-1.5 font-body text-sm text-text-primary hover:border-warm-gold hover:text-warm-gold-deep"
              >
                {c.title}
              </Link>
            ))}
          </div>
        ) : null}

        {tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {tags.map((tag) => (
              <Link
                key={tag.slug}
                href={tag.href}
                className="rounded-full bg-bone-cream px-3 py-1 font-body text-xs text-text-muted hover:text-warm-gold-deep"
              >
                #{tag.title}
              </Link>
            ))}
          </div>
        ) : null}

        {/* Description, specifications + any admin-defined field groups */}
        {tabs.length > 0 ? (
          <div className="mt-16 max-w-3xl">
            <ProductTabs tabs={tabs} />
          </div>
        ) : null}

        {sizeChart ? <SizeChart chart={sizeChart} locale={locale} /> : null}

        <ProductReviews
          productSlug={slug}
          locale={locale}
          aggregate={aggregate}
          reviews={reviews}
        />

        <RecentlyViewed
          locale={locale}
          current={{
            id: doc.id,
            slug,
            title,
            subtitle: subtitle || undefined,
            price,
            currency,
            image: gallery.find((g) => g.image),
            href: `/shop/${slug}`,
          }}
        />
      </div>
    </section>
  );
}
