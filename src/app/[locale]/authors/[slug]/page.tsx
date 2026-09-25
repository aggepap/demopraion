import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { listPublishedDocuments } from '@/cms/core';
import { documentSeo } from '@/cms/core/seo/document';
import { log404 } from '@/cms/core/seo/resolve';
import { AdminEditTarget } from '@/components/admin-bar/AdminEditTarget';
import { AuthorProfile } from '@/components/site/AuthorProfile';
import { Pagination } from '@/components/site/Pagination';
import { resolveRenderDoc } from '@/lib/cms/resolve-doc';
import { locales, type Locale } from '@/lib/i18n/config';
import { pageNotFoundPath } from '@/lib/i18n/page-not-found';
import { localizedMetadata } from '@/lib/seo/metadata';
import { documentGraph, SITE_URL } from '@/lib/seo/schemas';
import { articlesByAuthor, authorProfileNodes, authorProfilePath, presentAuthorDoc } from '@/lib/site/authors';
import { presentEntry } from '@/lib/site/content';
import { applyContentQuery, parseContentParams, type RawSearchParams } from '@/lib/site/content-query';

/**
 * Author profiles — the `author` collection, at `/authors/{slug}`: who wrote the
 * articles, what they did before, where else they are, and what they wrote here.
 * The page `Person.url` points at, so search and answer engines resolve a byline
 * to the person.
 */
interface PageProps {
  params: Promise<{ locale: Locale; slug: string }>;
  searchParams: Promise<RawSearchParams>;
}

// Rendered from the DB at request time (or the latest draft under Draft Mode).
export const dynamic = 'force-dynamic';

/** Read far enough to page through a prolific author. The read layer caps at 1000. */
const READ_LIMIT = 1000;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const doc = await resolveRenderDoc('author', slug, locale);
  if (!doc) return {};

  const view = presentAuthorDoc(doc);
  const seo = documentSeo(doc);
  const ogImage = seo.ogImageUuid ? `${SITE_URL}/api/cms/media/file/${seo.ogImageUuid}` : undefined;
  const base = await localizedMetadata({
    title: seo.metaTitle || [view.name, view.jobTitle].filter(Boolean).join(' — '),
    description: seo.metaDescription ?? view.summary ?? '',
    path: authorProfilePath(slug),
    locale,
    ogImage: ogImage ?? (view.avatarUrl ? `${SITE_URL}${view.avatarUrl}` : undefined),
    seo,
  });
  return { ...base, openGraph: { ...(base.openGraph ?? {}), type: 'profile' } };
}

export default async function AuthorPage({ params, searchParams }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const doc = await resolveRenderDoc('author', slug, locale);
  if (!doc) {
    await log404(authorProfilePath(slug), locale);
    redirect(pageNotFoundPath(locale));
  }

  const query = parseContentParams(await searchParams);
  const view = presentAuthorDoc(doc);
  const [t, nav, articles, ...authorVariants] = await Promise.all([
    getTranslations({ locale, namespace: 'authors' }),
    getTranslations({ locale, namespace: 'nav' }),
    listPublishedDocuments('article', locale, { limit: READ_LIMIT }),
    ...locales.map((l) => listPublishedDocuments('author', l)),
  ]);

  // An article may point at this author's document in any language: the variants
  // share the slug.
  const authorIds = new Set<number>([doc.id, ...authorVariants.flat().filter((a) => a.slug === slug).map((a) => a.id)]);
  // A prolific author's list is paged like any other: the profile is one screen,
  // not an archive of everything they ever wrote.
  const page = applyContentQuery(
    articlesByAuthor(articles, authorIds).map((a) => presentEntry('article', a)),
    query,
  );
  const written = page.items.map((entry) => ({
    href: `/blog/${entry.slug}`,
    title: entry.title,
    summary: entry.summary,
  }));

  return (
    <>
      <AdminEditTarget doc={doc} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: documentGraph(documentSeo(doc), authorProfileNodes(view, locale, nav('home'))) }}
      />
      <AuthorProfile
        view={view}
        articles={written}
        labels={{
          eyebrow: t('eyebrow'),
          experience: t('experience'),
          expertise: t('expertise'),
          profiles: t('profiles'),
          articles: t('articles'),
        }}
      />
      <div className="max-w-7xl mx-auto px-6 pb-24">
        <Pagination page={page.page} pageCount={page.pageCount} namespace="authors" />
      </div>
    </>
  );
}
