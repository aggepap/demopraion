import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getPublishedDocument, listPublishedByRelation, listPublishedDocuments } from '@/cms/core';
import { AdminEditTarget } from '@/components/admin-bar/AdminEditTarget';
import { ContentCard } from '@/components/site/ContentCard';
import { ContentToolbar } from '@/components/site/ContentToolbar';
import { PageIntro } from '@/components/site/PageIntro';
import { Pagination } from '@/components/site/Pagination';
import { defaultLocale, type Locale } from '@/lib/i18n/config';
import { localizedMetadata } from '@/lib/seo/metadata';
import { presentEntry, presentTerm } from '@/lib/site/content';
import { applyContentQuery, parseContentParams, type RawSearchParams } from '@/lib/site/content-query';

/**
 * /blog — published `article` documents, newest first, searchable,
 * filterable by category and paged.
 *
 * Filter state is the URL, so a filtered listing can be linked and survives a
 * refresh. Paging matters more than it looks: the read layer returns a bounded
 * number of rows, so an unpaged listing silently loses everything past the cap.
 */
export const dynamic = 'force-dynamic';

/** Read far enough to page through a real library. The read layer caps at 1000. */
const READ_LIMIT = 1000;

interface PageProps {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<RawSearchParams>;
}

// Categories are one document in the default locale, with a title per locale.
const loadCategory = (slug: string) => getPublishedDocument('article_category', slug, defaultLocale);

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const { q, category, page } = parseContentParams(await searchParams);
  const t = await getTranslations({ locale, namespace: 'blog' });

  // A category view holds exactly what the category archive holds, so it points
  // there: one indexed URL per category, and the archive — which is in the
  // sitemap and owns the unpublish redirects — is the one that keeps it.
  const term = category ? await loadCategory(category) : null;
  const meta = await localizedMetadata({
    title: t('title'),
    description: t('metaDescription'),
    // The clean path, with no query: it is also the key an administrator's SEO
    // override and the PM payload are stored under.
    path: term ? `/blog/categories/${category}` : '/blog',
    locale,
  });

  // Search results are thin and near-endless, and every one of them duplicates
  // the listing. Follow the links, index none of them.
  if (q) return { ...meta, robots: { index: false, follow: true } };

  // Page 2 of a series is not page 1, and saying it is keeps its entries out of
  // the index — so a paged view points at itself.
  return page > 1
    ? { ...meta, alternates: { ...meta.alternates, canonical: `${meta.alternates?.canonical ?? ''}?page=${page}` } }
    : meta;
}

export default async function ArticleIndexPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = parseContentParams(await searchParams);

  const [t, termDocs] = await Promise.all([
    getTranslations({ locale, namespace: 'blog' }),
    listPublishedDocuments('article_category', defaultLocale, { limit: READ_LIMIT }),
  ]);
  const categories = termDocs.map((doc) => presentTerm(doc, locale));
  // A category slug that names nothing live filters nothing, rather than
  // emptying the page over a stale link.
  const active = query.category ? (categories.find((c) => c.slug === query.category) ?? null) : null;
  // Filtered by a category, the page shows that category: the admin bar edits it.
  const activeDoc = active ? termDocs.find((doc) => doc.id === active.id) : undefined;

  // Filtering by category is a relation query the database answers in one go;
  // doing it in memory would mean loading every entry's categories first.
  const docs = active
    ? await listPublishedByRelation('article', 'categories', active.id, locale, { limit: READ_LIMIT })
    : await listPublishedDocuments('article', locale, { limit: READ_LIMIT });

  const result = applyContentQuery(
    docs.map((doc) => presentEntry('article', doc)),
    query,
  );
  // "Nothing here yet" and "nothing matched" are different things to be told.
  const collectionIsEmpty = docs.length === 0 && query.q === '';

  return (
    <section className="max-w-7xl mx-auto px-6 pt-20 pb-24">
      {activeDoc ? <AdminEditTarget doc={activeDoc} /> : null}
      <PageIntro title={t('title')} />

      <ContentToolbar
        namespace="blog"
        basePath="/blog"
        q={query.q}
        category={active?.slug ?? ''}
        categories={categories}
        total={result.total}
      />

      {result.items.length === 0 ? (
        <p className="mt-12 rounded-sm border border-border-soft bg-bone-cream p-8 text-center text-text-muted">
          {collectionIsEmpty ? t('empty') : t('noResults')}
        </p>
      ) : (
        <>
          <ul className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((entry) => (
              <li key={entry.slug}>
                <ContentCard entry={entry} segment="blog" />
              </li>
            ))}
          </ul>
          <Pagination page={result.page} pageCount={result.pageCount} namespace="blog" />
        </>
      )}
    </section>
  );
}
