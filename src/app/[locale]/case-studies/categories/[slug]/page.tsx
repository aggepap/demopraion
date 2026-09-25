import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { getPublishedDocument, listPublishedByRelation } from '@/cms/core';
import { documentSeo } from '@/cms/core/seo/document';
import { AdminEditTarget } from '@/components/admin-bar/AdminEditTarget';
import { ContentCard } from '@/components/site/ContentCard';
import { ContentToolbar } from '@/components/site/ContentToolbar';
import { PageIntro } from '@/components/site/PageIntro';
import { Pagination } from '@/components/site/Pagination';
import { defaultLocale, type Locale } from '@/lib/i18n/config';
import { Link } from '@/lib/i18n/routing';
import { localizedMetadata } from '@/lib/seo/metadata';
import { breadcrumbSchema, jsonLd, localePath } from '@/lib/seo/schemas';
import { presentEntry, presentTerm } from '@/lib/site/content';
import { applyContentQuery, parseContentParams, type RawSearchParams } from '@/lib/site/content-query';

/**
 * /case-studies/categories/[slug] — the published `scenario` documents in one category.
 *
 * A category that is not live sends visitors to the category overview rather than
 * the page-not-found screen: the overview always exists, and it is where they
 * were headed anyway.
 */
export const dynamic = 'force-dynamic';

/** Read far enough to page through a real category. The read layer caps at 1000. */
const READ_LIMIT = 1000;

interface PageProps {
  params: Promise<{ locale: Locale; slug: string }>;
  searchParams: Promise<RawSearchParams>;
}

// Categories are one document in the default locale, with a title per locale.
const loadCategory = (slug: string) => getPublishedDocument('scenario_category', slug, defaultLocale);

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const { q, page } = parseContentParams(await searchParams);
  const doc = await loadCategory(slug);
  if (!doc) return {};
  const term = presentTerm(doc, locale);
  const seo = documentSeo(doc);
  const meta = await localizedMetadata({
    title: seo.metaTitle || term.title,
    description: seo.metaDescription ?? term.description,
    path: `/case-studies/categories/${slug}`,
    locale,
    seo,
  });
  // Searching inside a category makes a thin, duplicate view of the archive.
  if (q) return { ...meta, robots: { index: false, follow: true } };
  // A paged archive points at itself, not at its own first page.
  return page > 1
    ? { ...meta, alternates: { ...meta.alternates, canonical: `${meta.alternates?.canonical ?? ''}?page=${page}` } }
    : meta;
}

export default async function ScenarioCategoryPage({ params, searchParams }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const query = parseContentParams(await searchParams);

  const doc = await loadCategory(slug);
  if (!doc) redirect(localePath(locale, '/case-studies/categories'));

  const [t, nav, docs] = await Promise.all([
    getTranslations({ locale, namespace: 'cases' }),
    getTranslations({ locale, namespace: 'nav' }),
    listPublishedByRelation('scenario', 'categories', doc.id, locale, { limit: READ_LIMIT }),
  ]);
  const term = presentTerm(doc, locale);
  const result = applyContentQuery(
    docs.map((d) => presentEntry('scenario', d)),
    query,
  );
  const categoryIsEmpty = docs.length === 0 && query.q === '';
  const breadcrumb = breadcrumbSchema(
    [
      { name: nav('home'), path: '/' },
      { name: t('title'), path: '/case-studies' },
      { name: t('categories'), path: '/case-studies/categories' },
      { name: term.title, path: `/case-studies/categories/${slug}` },
    ],
    locale,
  );

  return (
    <section className="max-w-7xl mx-auto px-6 pt-20 pb-24">
      <AdminEditTarget doc={doc} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({ '@context': 'https://schema.org', ...breadcrumb }) }} />
      <Link href="/case-studies/categories" className="text-sm text-text-muted hover:text-text-primary">
        ← {t('allCategories')}
      </Link>
      <div className="mt-10">
        <PageIntro title={term.title} intro={term.description || undefined} />
      </div>
      <ContentToolbar
        namespace="cases"
        basePath={`/case-studies/categories/${slug}`}
        q={query.q}
        category=""
        categories={[]}
        total={result.total}
      />
      {result.items.length === 0 ? (
        <p className="mt-12 rounded-sm border border-border-soft bg-bone-cream p-8 text-center text-text-muted">
          {categoryIsEmpty ? t('categoryEmpty') : t('noResults')}
        </p>
      ) : (
        <>
          <ul className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((entry) => (
              <li key={entry.slug}>
                <ContentCard entry={entry} segment="case-studies" />
              </li>
            ))}
          </ul>
          <Pagination page={result.page} pageCount={result.pageCount} namespace="cases" />
        </>
      )}
    </section>
  );
}
