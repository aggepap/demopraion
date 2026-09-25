import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import Image from 'next/image';
import { redirect } from 'next/navigation';

import { documentSeo } from '@/cms/core/seo/document';
import { getSchemaPolicy } from '@/cms/core/structured-data';
import { localePrefix } from '@/cms/core/paths';
import { log404 } from '@/cms/core/seo/resolve';
import { AdminEditTarget } from '@/components/admin-bar/AdminEditTarget';
import { RichText } from '@/components/cms/RichText';
import { resolveRenderDoc } from '@/lib/cms/resolve-doc';
import { defaultLocale, type Locale } from '@/lib/i18n/config';
import { pageNotFoundPath } from '@/lib/i18n/page-not-found';
import { localizedMetadata } from '@/lib/seo/metadata';
import { documentStructuredData, SITE_URL } from '@/lib/seo/schemas';
import { PmStructuredData } from '@/cms/modules/pm/PmStructuredData';
import config from '@/site.config';

/**
 * Standalone CMS pages — the `page` collection, at `/{slug}`.
 *
 * This collection had been sitting in the admin since the first phase of the
 * CMS, fully functional there: it appears in the sidebar, takes a title, a
 * rich-text body and a hero image, and can be set to Published exactly like an
 * article. Nothing on the public site read it. Every published `page` document
 * 307'd to `/page-not-found` at the very path the admin computed for it, with
 * no error and no warning anywhere — indistinguishable, from the editor's side,
 * from never having created it at all. It was also absent from the sitemap.
 *
 * Route precedence is what makes this safe to add: Next matches static segments
 * first, so `/pricing`, `/contact`, `/legal/*`, `/insights/*` and the rest keep
 * their own routes untouched. This `[slug]` segment sees only single-segment
 * paths nothing else claims, and it is matched ahead of the `[...rest]`
 * catch-all. A slug with no document behind it ends where it always did.
 */
interface PageProps {
  params: Promise<{ locale: Locale; slug: string }>;
}

// Rendered from the DB at request time (or the latest draft under Draft Mode),
// so a newly-published page is live without a rebuild.
export const dynamic = 'force-dynamic';

const mediaUrl = (uuid: string) => `/api/cms/media/file/${uuid}`;

/** The page's own fields. `title` is required by the collection; the rest are not. */
function fieldsOf(data: unknown): { title: string; body: unknown; hero?: string } {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    title: typeof d.title === 'string' ? d.title : '',
    body: d.body,
    hero: typeof d.hero === 'string' && d.hero ? d.hero : undefined,
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const doc = await resolveRenderDoc('page', slug, locale);
  if (!doc) return {};

  const { title, hero } = fieldsOf(doc.data);
  const seo = documentSeo(doc);
  const ogUuid = seo.ogImageUuid ?? hero;

  // `noindex` used to be applied here by hand, and only here — the other five
  // document-backed routes ignored it. It now travels inside `seo`, along with
  // the OG/Twitter/canonical fields, so every route honours the same block.
  return localizedMetadata({
    title: seo.metaTitle || title,
    description: seo.metaDescription ?? '',
    path: `/${slug}`,
    locale,
    ogImage: ogUuid ? `${SITE_URL}${mediaUrl(ogUuid)}` : undefined,
    seo,
  });
}

export default async function CmsPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const doc = await resolveRenderDoc('page', slug, locale);
  if (!doc) {
    await log404(`/${slug}`, locale);
    redirect(pageNotFoundPath(locale));
  }

  const { title, body, hero } = fieldsOf(doc.data);
  const seo = documentSeo(doc);

  // The type (WebPage, ContactPage…) comes from Settings → Structured data, or
  // from this page's own SEO panel.
  const structuredData = documentStructuredData({
    category: 'pages',
    seo,
    policy: await getSchemaPolicy(config),
    url: `${SITE_URL}${localePrefix(locale, defaultLocale)}/${slug}`,
    locale,
    facts: { name: seo.metaTitle || title, description: seo.metaDescription ?? undefined },
    crumbs: [
      { name: locale === 'el' ? 'Αρχική' : 'Home', path: '/' },
      { name: title, path: `/${slug}` },
    ],
  });

  return (
    <>
      <AdminEditTarget doc={doc} />
      <PmStructuredData
        path={`/${slug}`}
        locale={locale}
        fallbackJson={structuredData}
      />

      <article className="bg-soft-pearl pt-20 md:pt-28 pb-20">
        <div className="max-w-3xl mx-auto px-6">
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1] text-midnight-navy">
            {title}
          </h1>

          {hero ? (
            <Image
              src={mediaUrl(hero)}
              alt={title}
              width={1600}
              height={900}
              // The one large image on the page, above the fold.
              priority
              sizes="(max-width: 768px) 100vw, 768px"
              className="mt-10 h-auto w-full rounded-sm object-cover"
            />
          ) : null}

          <RichText
            value={body}
            className="article-prose mt-10 flex flex-col gap-4 font-body text-base md:text-lg text-text-primary leading-relaxed"
          />
        </div>
      </article>
    </>
  );
}
