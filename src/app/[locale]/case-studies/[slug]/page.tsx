import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Image from 'next/image';
import { redirect } from 'next/navigation';

import { loadRelatedDocuments } from '@/cms/core';
import { documentSeo } from '@/cms/core/seo/document';
import { getSchemaPolicy } from '@/cms/core/structured-data';
import { log404 } from '@/cms/core/seo/resolve';
import { AdminEditTarget } from '@/components/admin-bar/AdminEditTarget';
import { RichText } from '@/components/cms/RichText';
import { resolveRenderDoc } from '@/lib/cms/resolve-doc';
import type { Locale } from '@/lib/i18n/config';
import { pageNotFoundPath } from '@/lib/i18n/page-not-found';
import { Link } from '@/lib/i18n/routing';
import { localizedMetadata } from '@/lib/seo/metadata';
import { documentStructuredData, localePath, SITE_URL } from '@/lib/seo/schemas';
import { authorPersonSchema, authorProfilePath, presentAuthorDoc } from '@/lib/site/authors';
import { CONTENT_SCHEMA_CATEGORY, mediaUrl, presentEntry, presentTerm } from '@/lib/site/content';
import config from '@/site.config';

/** /case-studies/[slug] — one `scenario` document (or its draft under Draft Mode). */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: Locale; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const doc = await resolveRenderDoc('scenario', slug, locale);
  if (!doc) return {};
  const entry = presentEntry('scenario', doc);
  const seo = documentSeo(doc);
  const og = seo.ogImageUuid ?? entry.image;
  return localizedMetadata({
    title: seo.metaTitle || entry.title,
    description: seo.metaDescription ?? entry.summary,
    path: `/case-studies/${slug}`,
    locale,
    ogImage: og ? `${SITE_URL}${mediaUrl(og)}` : undefined,
    seo,
  });
}

export default async function ScenarioPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const doc = await resolveRenderDoc('scenario', slug, locale);
  if (!doc) {
    await log404(`/case-studies/${slug}`, locale);
    redirect(pageNotFoundPath(locale));
  }

  const [t, nav, authorsT, related, categoryDocs] = await Promise.all([
    getTranslations({ locale, namespace: 'cases' }),
    getTranslations({ locale, namespace: 'nav' }),
    getTranslations({ locale, namespace: 'authors' }),
    // Only articles carry an `author` relation; for the other collections this is empty.
    loadRelatedDocuments(doc.id, 'author'),
    loadRelatedDocuments(doc.id, 'categories'),
  ]);
  // Only live categories: a link to an unpublished one would bounce to the overview.
  const categories = categoryDocs.filter((c) => c.status === 'published').map((c) => presentTerm(c, locale));
  const primaryCategory = categories[0];
  const entry = presentEntry('scenario', doc);
  const seo = documentSeo(doc);
  const path = `/case-studies/${slug}`;

  // The author, when the document names one that is published (its page would 404 otherwise).
  const authorDoc = related.find((a) => a.status === 'published');
  const author = authorDoc ? presentAuthorDoc(authorDoc) : null;
  const person = author ? authorPersonSchema(author, locale) : null;

  // The type (BlogPosting, FAQPage…) and its parts come from Settings → Structured
  // data, or from this document's own SEO panel.
  const structuredData = documentStructuredData({
    category: CONTENT_SCHEMA_CATEGORY['scenario'],
    seo,
    policy: await getSchemaPolicy(config),
    url: `${SITE_URL}${localePath(locale, path)}`,
    locale,
    facts: {
      name: seo.metaTitle || entry.title,
      description: seo.metaDescription ?? (entry.summary || undefined),
      images: entry.image ? [`${SITE_URL}${mediaUrl(entry.image)}`] : [],
      datePublished: doc.publishedAt ? new Date(doc.publishedAt) : null,
      dateModified: doc.updatedAt ? new Date(doc.updatedAt) : null,
      author: person,
      faq: entry.faq ? [entry.faq] : [],
    },
    crumbs: [
      { name: nav('home'), path: '/' },
      { name: t('title'), path: '/case-studies' },
      ...(primaryCategory
        ? [{ name: primaryCategory.title, path: `/case-studies/categories/${primaryCategory.slug}` }]
        : []),
      { name: entry.title, path },
    ],
  });

  return (
    <>
      <AdminEditTarget doc={doc} />
      {structuredData ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      ) : null}
      <article className="max-w-3xl mx-auto px-6 pt-16 pb-24">
        <Link href="/case-studies" className="text-sm text-text-muted hover:text-text-primary">
          ← {t('back')}
        </Link>
        {entry.eyebrow ? (
          <p className="mt-10 text-xs uppercase tracking-wider-2 text-text-muted">{entry.eyebrow}</p>
        ) : null}
        {/* `data-speakable` is what the article's SpeakableSpecification points at. */}
        <h1
          data-speakable="headline"
          className="mt-4 font-display text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1] text-midnight-navy"
        >
          {entry.title}
        </h1>
        {author ? (
          <p className="mt-4 text-sm text-text-muted">
            {authorsT('by')}{' '}
            <Link
              href={authorProfilePath(author.slug)}
              className="font-medium text-text-primary hover:underline underline-offset-4"
            >
              {author.name}
            </Link>
          </p>
        ) : null}
        {categories.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label={t('categories')}>
            {categories.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/case-studies/categories/${c.slug}`}
                  className="inline-block rounded-full border border-border-soft px-3 py-1 text-xs text-text-muted hover:text-text-primary"
                >
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {entry.summary ? (
          <p data-speakable="summary" className="mt-6 text-lg leading-relaxed text-text-muted">
            {entry.summary}
          </p>
        ) : null}
        {entry.image ? (
          <Image
            src={mediaUrl(entry.image)}
            alt=""
            width={1600}
            height={900}
            priority
            sizes="(max-width: 768px) 100vw, 768px"
            className="mt-10 h-auto w-full rounded-sm object-cover"
          />
        ) : null}
        <RichText value={entry.body} className="article-prose mt-10 flex flex-col gap-4 text-base md:text-lg leading-relaxed" />
      </article>
    </>
  );
}
