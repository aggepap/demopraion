import type { MetadataRoute } from 'next';

import type { DocumentRow } from '@/cms';
import { isModuleEnabled } from '@/cms/core';
import { listAllPublishedDocuments } from '@/cms/core/read';
import { settingLines } from '@/cms/core/seo/setting-lines';
import { getLocaleSettings } from '@/lib/i18n/locale-settings';
import { SITE_URL } from '@/lib/seo/schemas';
import config from '@/site.config';

// Generated per request, so a newly published document is listed without a rebuild.
export const dynamic = 'force-dynamic';

/** Routes with no document behind them. Module and content indexes are added below. */
export const STATIC_ROUTES = ['/', '/contact', '/legal/cookies'] as const;

export interface Family {
  /** Collection key. */
  type: string;
  /** URL prefix; the document's slug is appended. */
  prefix: string;
  /** Listed only while this module is on. */
  module?: 'commerce' | 'booking';
  /** The family's own index route, if it has one. */
  index?: string;
}

/**
 * Every document family with a public route. Content collections appear only
 * when the site registers them; module families only while the module is on.
 */
export const SITEMAP_FAMILIES: ReadonlyArray<Family> = [
  { type: 'page', prefix: '' },
  { type: 'article', prefix: '/blog', index: '/blog' },
  { type: 'article_category', prefix: '/blog/categories', index: '/blog/categories' },
  { type: 'author', prefix: '/authors' },
  { type: 'answer', prefix: '/faq', index: '/faq' },
  { type: 'answer_category', prefix: '/faq/categories', index: '/faq/categories' },
  { type: 'scenario', prefix: '/case-studies', index: '/case-studies' },
  { type: 'scenario_category', prefix: '/case-studies/categories', index: '/case-studies/categories' },
  { type: 'product', prefix: '/shop', module: 'commerce', index: '/shop' },
  { type: 'category', prefix: '/shop/category', module: 'commerce' },
  { type: 'booking', prefix: '/booking', module: 'booking', index: '/booking' },
];

/** Page documents whose own URL is not where they are shown. */
const PAGE_SLUGS_NOT_LISTED = new Set(['home', 'contact']);

function docYmd(doc: DocumentRow): string {
  const d = doc.modifiedAt ?? doc.publishedAt ?? doc.createdAt;
  return new Date(d).toISOString().slice(0, 10);
}

/** Absolute URL for a route in a locale; the main locale is unprefixed. */
function localeUrl(locale: string, route: string, main: string): string {
  if (locale === main) return route === '/' ? SITE_URL : `${SITE_URL}${route}`;
  return `${SITE_URL}/${locale}${route === '/' ? '' : route}`;
}

async function liveFamilies(): Promise<Family[]> {
  const [commerce, booking] = await Promise.all([
    isModuleEnabled(config, 'commerce'),
    isModuleEnabled(config, 'booking'),
  ]);
  const on = { commerce, booking };
  return SITEMAP_FAMILIES.filter(
    (f) => config.collectionByKey.has(f.type) && (!f.module || on[f.module]),
  );
}

async function documentRoutes(
  publicLocales: string[],
  families: Family[],
): Promise<{ routes: string[]; lastMod: Map<string, string> }> {
  const routes: string[] = [];
  const lastMod = new Map<string, string>();
  for (const { type, prefix } of families) {
    // Every document, not the first page: `listPublishedDocuments` defaults to 200,
    // and a sitemap that silently stops at 200 posts hides the rest from search.
    const perLocale = await Promise.all(publicLocales.map((l) => listAllPublishedDocuments(type, l)));
    const bySlug = new Map<string, string>();
    for (const doc of perLocale.flat()) {
      // `noindex` asks not to be listed; `includeInSitemap: false` asks the same
      // of the sitemap alone.
      if (doc.noindex || doc.includeInSitemap === false) continue;
      if (type === 'page' && PAGE_SLUGS_NOT_LISTED.has(doc.slug)) continue;
      const iso = docYmd(doc);
      const prev = bySlug.get(doc.slug);
      if (!prev || iso > prev) bySlug.set(doc.slug, iso);
    }
    for (const [slug, iso] of bySlug) {
      const route = `${prefix}/${slug}`;
      routes.push(route);
      lastMod.set(route, iso);
    }
  }
  return { routes, lastMod };
}

/**
 * `lastmod` for a route, or `undefined` when nothing records when it changed.
 *
 * Only document-backed routes have a real date. Stamping the rest with
 * `new Date()` would claim, on every fetch of this per-request sitemap, that they
 * had all just changed — which teaches Google to ignore `lastmod` for the whole
 * file, the real dates included. `lastmod` is optional; leaving it out says
 * "unknown", which is true.
 */
export function getRouteLastModified(route: string, lastMod: Map<string, string>): Date | undefined {
  const iso = lastMod.get(route);
  if (!iso) return undefined;
  // UTC noon, so a timezone offset cannot shift the date in the emitted XML.
  return new Date(`${iso}T12:00:00Z`);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Only public locales: a language toggled off in the admin 404s.
  const { public: publicLocales, main } = await getLocaleSettings();
  const families = await liveFamilies();
  const docs = await documentRoutes(publicLocales, families);
  const indexes = families.flatMap((f) => (f.index ? [f.index] : []));
  const routes = [...new Set<string>([...STATIC_ROUTES, ...indexes, ...docs.routes])];

  const out: MetadataRoute.Sitemap = [];
  for (const route of routes) {
    const lastModified = getRouteLastModified(route, docs.lastMod);
    const languages: Record<string, string> = {};
    for (const l of publicLocales) languages[l] = localeUrl(l, route, main);
    // Must agree with `localizedMetadata()` in src/lib/seo/metadata.ts.
    languages['x-default'] = localeUrl(publicLocales.includes('en') ? 'en' : main, route, main);
    for (const l of publicLocales) {
      out.push({
        url: localeUrl(l, route, main),
        ...(lastModified && { lastModified }),
        changeFrequency: route === '/' ? 'weekly' : 'monthly',
        priority: route === '/' ? 1 : 0.6,
        alternates: { languages },
      });
    }
  }

  // URLs added in Admin → Settings → SEO, for pages outside the CMS. No lastmod:
  // nothing here knows when they changed.
  const known = new Set(out.map((e) => e.url));
  for (const url of await settingLines('seo.sitemapExtraUrls')) {
    if (!/^https?:\/\//i.test(url) || known.has(url)) continue;
    known.add(url);
    out.push({ url, changeFrequency: 'monthly', priority: 0.5 });
  }
  return out;
}
