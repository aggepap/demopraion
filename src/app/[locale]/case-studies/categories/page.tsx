import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { listPublishedDocuments } from '@/cms/core';
import { PageIntro } from '@/components/site/PageIntro';
import { defaultLocale, type Locale } from '@/lib/i18n/config';
import { Link } from '@/lib/i18n/routing';
import { localizedMetadata } from '@/lib/seo/metadata';
import { breadcrumbSchema, jsonLd } from '@/lib/seo/schemas';
import { buildTermTree, presentTerm, type ContentTermNode } from '@/lib/site/content';

/**
 * /case-studies/categories — every published `scenario_category`, nested by parent.
 *
 * A code route, so it exists on every site from the first build: it is where an
 * unpublished scenario with no live category sends its visitors.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cases' });
  return localizedMetadata({
    title: t('categories'),
    description: t('categoriesMetaDescription'),
    path: '/case-studies/categories',
    locale,
  });
}

function TermList({ nodes, nested = false }: { nodes: ContentTermNode[]; nested?: boolean }) {
  return (
    <ul className={nested ? 'mt-3 ml-5 flex flex-col gap-3 border-l border-border-soft pl-5' : 'mt-12 flex flex-col gap-8'}>
      {nodes.map(({ term, children }) => (
        <li key={term.id}>
          <Link
            href={`/case-studies/categories/${term.slug}`}
            className={
              nested
                ? 'text-text-primary hover:underline underline-offset-4'
                : 'font-display text-xl font-semibold text-midnight-navy hover:underline underline-offset-4'
            }
          >
            {term.title}
          </Link>
          {!nested && term.description ? <p className="mt-1 text-text-muted">{term.description}</p> : null}
          {children.length > 0 ? <TermList nodes={children} nested /> : null}
        </li>
      ))}
    </ul>
  );
}

export default async function ScenarioCategoriesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, nav, docs] = await Promise.all([
    getTranslations({ locale, namespace: 'cases' }),
    getTranslations({ locale, namespace: 'nav' }),
    // One document per category, in the default locale, with a title per locale.
    listPublishedDocuments('scenario_category', defaultLocale),
  ]);
  const tree = buildTermTree(docs.map((doc) => presentTerm(doc, locale)));
  const breadcrumb = breadcrumbSchema(
    [
      { name: nav('home'), path: '/' },
      { name: t('title'), path: '/case-studies' },
      { name: t('categories'), path: '/case-studies/categories' },
    ],
    locale,
  );

  return (
    <section className="max-w-7xl mx-auto px-6 pt-20 pb-24">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({ '@context': 'https://schema.org', ...breadcrumb }) }} />
      <Link href="/case-studies" className="text-sm text-text-muted hover:text-text-primary">
        ← {t('back')}
      </Link>
      <div className="mt-10">
        <PageIntro title={t('categories')} />
      </div>
      {tree.length === 0 ? (
        <p className="mt-12 rounded-sm border border-border-soft bg-bone-cream p-8 text-center text-text-muted">
          {t('categoriesEmpty')}
        </p>
      ) : (
        <TermList nodes={tree} />
      )}
    </section>
  );
}
