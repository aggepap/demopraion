import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata, Viewport } from 'next';
import { draftMode } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { ANALYTICS_GA_ID_KEY, getAdminPath, getSetting, isModuleEnabled } from '@/cms/core';
import { BrandProvider } from '@/cms/core/brand/BrandProvider';
import { BrandStyle } from '@/cms/core/brand/BrandStyle';
import { getSchemaPolicy } from '@/cms/core/structured-data';
import { getCurrentUser } from '@/cms/modules/auth';
import { getSiteCurrency, getWishlistConfig } from '@/cms/modules/commerce';
import { readCustomerCookie } from '@/cms/modules/customers';
import { AdminBarProvider } from '@/components/admin-bar/AdminBar';
import { AnalyticsLoader } from '@/components/layout/AnalyticsLoader';
import { CookieBanner } from '@/components/layout/CookieBanner';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { NewsletterProvider } from '@/components/layout/NewsletterProvider';
import { CartDrawer } from '@/components/shop/cart/CartDrawer';
import { CartProvider } from '@/components/shop/cart/CartProvider';
import { PopupHost } from '@/components/popups/PopupHost';
import { WishlistProvider } from '@/components/shop/wishlist/WishlistProvider';
import { CompareProvider } from '@/components/shop/compare/CompareProvider';
import { CompareTray } from '@/components/shop/compare/CompareTray';
import { adminBarFor } from '@/lib/admin-bar';
import { siteBrand } from '@/lib/brand';
import { inter } from '@/lib/fonts';
import { locales } from '@/lib/i18n/config';
import { getLocaleSettings } from '@/lib/i18n/locale-settings';
import { routing } from '@/lib/i18n/routing';
import { siteMetadata } from '@/lib/seo/metadata';
import { globalGraph, jsonLd } from '@/lib/seo/schemas';
import config from '@/site.config';

import '../globals.css';

// Both read the brand from Settings → Branding, so a change there is live on
// the next request.
export async function generateMetadata(): Promise<Metadata> {
  return siteMetadata(await siteBrand());
}

export async function generateViewport(): Promise<Viewport> {
  return { themeColor: (await siteBrand()).palette['midnight-navy'] };
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// A `[locale]` value outside `generateStaticParams()` is a clean 404.
export const dynamicParams = false;

// Rendered per request: CMS content is live without a rebuild, and module flags
// are re-read each time. The reads inside are cached and tag-invalidated.
export const dynamic = 'force-dynamic';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [
    messages,
    ui,
    gaId,
    localeSettings,
    commerceEnabled,
    bookingEnabled,
    newsletterEnabled,
    customersEnabled,
    popupsEnabled,
    currency,
    wishlist,
    brand,
    schemaPolicy,
    sessionUser,
    draft,
  ] =
    await Promise.all([
      getMessages(),
      getTranslations({ locale, namespace: 'ui' }),
      getSetting<string>(ANALYTICS_GA_ID_KEY),
      getLocaleSettings(),
      isModuleEnabled(config, 'commerce'),
      isModuleEnabled(config, 'booking'),
      isModuleEnabled(config, 'newsletter'),
      isModuleEnabled(config, 'customers'),
      isModuleEnabled(config, 'popups'),
      getSiteCurrency(),
      getWishlistConfig(),
      siteBrand(),
      getSchemaPolicy(config),
      // Signed-cookie read, no DB: the admin bar is links only, and every admin
      // screen it links to re-checks permissions fresh.
      getCurrentUser(),
      draftMode(),
    ]);

  /*
   * Only whether a session cookie is present, and only when accounts are on.
   * The wishlist provider needs to know which list to load; it does not need to
   * know who, so this stays a cookie read rather than a database lookup on
   * every page.
   */
  const signedInCustomer = customersEnabled ? (await readCustomerCookie()) !== null : false;

  // Installed but not made Public in the admin → not on the front end yet.
  if (!localeSettings.public.includes(locale)) notFound();

  const adminBar = adminBarFor(sessionUser, getAdminPath(), {
    preview: draft.isEnabled,
    siteLocale: locale,
  });

  return (
    <html lang={locale} className={inter.variable}>
      <head>
        {/* The saved brand colours, over the stylesheet's defaults. */}
        <BrandStyle />
      </head>
      <body
        className="font-body bg-soft-pearl text-text-primary flex min-h-screen flex-col antialiased"
        suppressHydrationWarning
      >
        <a
          href="#main-content"
          className="focus:bg-midnight-navy focus:text-soft-pearl sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-2"
        >
          {ui('skipToContent')}
        </a>

        {/* Organization (as the business type in Settings → Structured data) + WebSite, on every page. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(globalGraph(locale, brand, schemaPolicy.business)) }} />

        <NextIntlClientProvider locale={locale} messages={messages}>
          <BrandProvider value={brand}>
          <NewsletterProvider enabled={newsletterEnabled}>
            <CartProvider currency={currency}>
              <CompareProvider>
                <WishlistProvider
                  enabled={commerceEnabled && wishlist.enabled}
                  maxItems={wishlist.maxItems}
                  signedIn={customersEnabled && signedInCustomer}
                >
                <AdminBarProvider bar={adminBar}>
                <Header
                  publicLocales={localeSettings.public}
                  mainLocale={localeSettings.main}
                  commerceEnabled={commerceEnabled}
                  bookingEnabled={bookingEnabled}
                  customersEnabled={customersEnabled}
                />
                <main id="main-content" className="flex-1">
                  {children}
                </main>
                <Footer />
                <CartDrawer commerceEnabled={commerceEnabled} />
                {commerceEnabled ? <CompareTray /> : null}
                {/* After the banner in the tree as well as in z-index: consent
                    is answered before anything is offered. */}
                {popupsEnabled ? <PopupHost locale={locale} /> : null}
                <CookieBanner />
                <AnalyticsLoader gaId={gaId ?? undefined} />
                </AdminBarProvider>
                </WishlistProvider>
              </CompareProvider>
            </CartProvider>
          </NewsletterProvider>
          </BrandProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
