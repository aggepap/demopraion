import type { Metadata } from 'next';

import { seoRestrictsRobots, type DocumentSeo } from '@/cms/core/seo/document';
import { getHeadPayload, getMetaOverride } from '@/cms/core/seo/resolve';
import { defaultLocale, locales, type Locale } from '@/lib/i18n/config';
import type { SiteBrand } from '@/cms/core/brand/policy';
import { siteBrand } from '@/lib/brand';
import { getLocaleSettings } from '@/lib/i18n/locale-settings';

import { SITE_URL } from './schemas';

/** Root-relative URL for a locale; the main locale is unprefixed. */
function localeRelPath(locale: string, rawPath: string, main: string): string {
  if (locale === main) return rawPath === '' ? '/' : rawPath;
  return rawPath === '' ? `/${locale}` : `/${locale}${rawPath}`;
}

/** App locale → Open Graph locale (extend as languages land). */
const OG_LOCALE: Record<string, string> = { el: 'el_GR', en: 'en_US' };
const ogLocaleOf = (locale: string): string => OG_LOCALE[locale] ?? locale;

const defaultLanguages: Record<string, string> = Object.fromEntries(
  locales.map((l) => [l, l === defaultLocale ? '/' : `/${l}`]),
);

/**
 * Site-wide defaults, applied once in the locale layout. Pages override through
 * `localizedMetadata()`. The brand comes from Settings → Branding (`siteBrand()`).
 */
export function siteMetadata(brand: SiteBrand): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: brand.tagline ? `${brand.name} — ${brand.tagline}` : brand.name,
      template: `%s | ${brand.name}`,
    },
    description: brand.tagline || null,
    applicationName: brand.name,
    authors: [{ name: brand.name }],
    creator: brand.name,
    publisher: brand.name,
    openGraph: {
      type: 'website',
      siteName: brand.name,
      locale: ogLocaleOf(defaultLocale),
      alternateLocale: locales.filter((l) => l !== defaultLocale).map(ogLocaleOf),
      ...(brand.ogImageUrl ? { images: [{ url: brand.ogImageUrl }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: brand.name,
      description: brand.tagline || undefined,
      ...(brand.ogImageUrl ? { images: [brand.ogImageUrl] } : {}),
    },
    alternates: {
      canonical: '/',
      languages: {
        ...defaultLanguages,
        'x-default': locales.includes('en') ? defaultLanguages.en : '/',
      },
    },
    robots: { index: true, follow: true },
    icons: {
      icon: brand.faviconUrl ? [{ url: brand.faviconUrl }] : [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    },
  };
}

/**
 * Per-page metadata for a route that exists in every public locale.
 *
 * Precedence, highest first: the per-path override edited in Admin → SEO, then
 * the Product Manager payload when approved, then the document's own SEO block,
 * then the values this page computed.
 */
export async function localizedMetadata(args: {
  title: string;
  description: string;
  /** Path relative to site root, with leading slash, no locale prefix. */
  path: string;
  locale: Locale;
  ogImage?: string;
  /** The document's own SEO block, from `documentSeo()`. */
  seo?: DocumentSeo;
}): Promise<Metadata> {
  // No trailing slash anywhere: the slashed form redirects.
  const rawPath = args.path.replace(/\/+$/, '');
  const { public: publicLocales, main } = await getLocaleSettings();
  const mainPath = localeRelPath(main, rawPath, main);
  const canonical = localeRelPath(args.locale, rawPath, main);

  const languages: Record<string, string> = {};
  for (const l of publicLocales) languages[l] = localeRelPath(l, rawPath, main);
  // English is the international fallback while it is public.
  languages['x-default'] = publicLocales.includes('en') ? localeRelPath('en', rawPath, main) : mainPath;

  const ogLocale = ogLocaleOf(args.locale);
  const ogAlternateLocale = publicLocales.filter((l) => l !== args.locale).map(ogLocaleOf);

  const [override, payload, brand] = await Promise.all([
    getMetaOverride(mainPath, args.locale),
    getHeadPayload(mainPath, args.locale),
    siteBrand(),
  ]);
  const seo = args.seo;
  const pm = payload?.headMeta ?? null;
  const pmStrong = payload?.seoOverride === true ? pm : null;
  const pmWeak = payload?.seoOverride === true ? null : pm;

  const title = override?.title || pmStrong?.title || args.title || pmWeak?.title || args.title;
  const description =
    override?.description || pmStrong?.description || args.description || pmWeak?.description || args.description;
  // A page-level openGraph replaces the default one, so the brand's share image
  // is restated here as the last resort.
  const ogImage =
    override?.ogImage || pmStrong?.og_image || args.ogImage || pmWeak?.og_image || brand.ogImageUrl || undefined;
  const ogTitle = override?.ogTitle || pmStrong?.og_title || seo?.ogTitle || title || pmWeak?.og_title || title;
  const ogDescription =
    override?.ogDescription ||
    pmStrong?.og_description ||
    seo?.ogDescription ||
    description ||
    pmWeak?.og_description ||
    description;
  const effectiveCanonical = override?.canonical || pmStrong?.canonical || seo?.canonicalUrl || canonical;

  // Only a restriction is emitted; the default is index+follow.
  const robots =
    override?.robots ||
    pmStrong?.robots ||
    (seo && seoRestrictsRobots(seo) ? seo.robots : null) ||
    pmWeak?.robots ||
    null;

  return {
    title: { absolute: title },
    description,
    ...(robots ? { robots } : {}),
    alternates: { canonical: effectiveCanonical, languages },
    // A page-level openGraph REPLACES the default one, so restate type/siteName.
    openGraph: {
      type: 'website',
      siteName: brand.name,
      title: ogTitle,
      description: ogDescription,
      url: effectiveCanonical,
      locale: ogLocale,
      ...(ogAlternateLocale.length ? { alternateLocale: ogAlternateLocale } : {}),
      ...(ogImage && { images: [{ url: ogImage }] }),
    },
    twitter: {
      card: seo?.twitterCard ?? 'summary_large_image',
      title: ogTitle,
      description: ogDescription,
      ...(ogImage && { images: [ogImage] }),
    },
  };
}
