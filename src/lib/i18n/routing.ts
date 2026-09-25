import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

import { defaultLocale, localePrefix, locales } from './config';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix,
  // Disable next-intl's auto locale detection from Accept-Language /
  // cookie. The site is Greek-default with an explicit EL/EN switcher
  // in the header — auto-redirecting English-browser users to /en/*
  // breaks the language switcher (click EL → / → proxy redirects
  // back to /en/) and produces unpredictable URLs for visitors
  // sharing links across language preferences. The URL alone
  // determines the locale; defaultLocale 'el' applies to unprefixed
  // paths regardless of the browser's preferred language.
  localeDetection: false,
  // Disable next-intl's automatic `Link: rel="alternate" hreflang` HTTP
  // response header. hreflang is already emitted as HTML `<link
  // rel="alternate">` tags per page via `localizedMetadata()`
  // (src/lib/seo/metadata.ts). Shipping both channels duplicated every
  // annotation — Screaming Frog flagged "hreflang multiple entries" (6
  // occurrences for 3 languages). The HTML channel is the single source of
  // truth: more widely supported, visible to crawlers/tools, and still
  // computed dynamically per route via generateMetadata.
  alternateLinks: false,
});

// next-intl v4: createNavigation returns wrappers that respect routing config.
// Use these in components instead of next/link / next/navigation.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
