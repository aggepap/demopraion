import { getTranslations } from 'next-intl/server';
import Image from 'next/image';

import { listPublishedDocuments } from '@/cms/core';
import { AdminEditTarget } from '@/components/admin-bar/AdminEditTarget';
import { RichText } from '@/components/cms/RichText';
import { ButtonLink } from '@/components/ui/Button';
import { siteBrand } from '@/lib/brand';
import { resolveRenderDoc } from '@/lib/cms/resolve-doc';
import type { Locale } from '@/lib/i18n/config';
import { Link } from '@/lib/i18n/routing';
import { mediaUrl, presentEntry, type ContentType } from '@/lib/site/content';
import config from '@/site.config';

/**
 * Home page building blocks shared by every site type. Each reads the CMS and
 * renders something sensible while nothing is published yet.
 */

/** Hero from the CMS page with slug `home`; falls back to the brand name and tagline. */
export async function HomeHero({ locale, cta }: { locale: Locale; cta?: { href: string; label: string } }) {
  const [doc, brand] = await Promise.all([resolveRenderDoc('page', 'home', locale), siteBrand()]);
  const d = (doc?.data ?? {}) as Record<string, unknown>;
  const title = typeof d.title === 'string' && d.title ? d.title : brand.name;
  const hero = typeof d.hero === 'string' && d.hero ? d.hero : undefined;

  return (
    <section className="bg-bone-cream">
      {/* The hero is where the home page document is read, so it is also where
          the page offers it to the admin bar's Edit link. */}
      {doc ? <AdminEditTarget doc={doc} /> : null}
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32 grid gap-12 md:grid-cols-2 md:items-center">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] text-midnight-navy">
            {title}
          </h1>
          {doc ? (
            <RichText value={d.body} className="article-prose mt-6 max-w-xl text-lg text-text-muted" />
          ) : brand.tagline ? (
            <p className="mt-6 max-w-xl text-lg text-text-muted">{brand.tagline}</p>
          ) : null}
          {cta ? (
            <div className="mt-10">
              <ButtonLink href={cta.href} variant="primary" size="lg">
                {cta.label}
              </ButtonLink>
            </div>
          ) : null}
        </div>
        {hero ? (
          <Image
            src={mediaUrl(hero)}
            alt=""
            width={1200}
            height={900}
            priority
            sizes="(max-width: 768px) 100vw, 50vw"
            className="h-auto w-full rounded-sm object-cover"
          />
        ) : null}
      </div>
    </section>
  );
}

const FAMILIES: ReadonlyArray<{ type: ContentType; segment: string; ns: string }> = [
  { type: 'article', segment: 'blog', ns: 'blog' },
  { type: 'answer', segment: 'faq', ns: 'faq' },
  { type: 'scenario', segment: 'case-studies', ns: 'cases' },
];

/** The latest three of each content collection this site registers. */
export async function LatestContent({ locale }: { locale: Locale }) {
  const live = FAMILIES.filter((f) => config.collectionByKey.has(f.type));
  if (live.length === 0) return null;

  const [t, lists] = await Promise.all([
    getTranslations({ locale }),
    Promise.all(
      live.map(async (f) => ({
        ...f,
        entries: (await listPublishedDocuments(f.type, locale, { limit: 3 })).map((doc) => presentEntry(f.type, doc)),
      })),
    ),
  ]);
  const any = lists.some((l) => l.entries.length > 0);

  return (
    <section className="max-w-7xl mx-auto px-6 py-20">
      <h2 className="font-display text-3xl font-semibold tracking-tight text-midnight-navy">{t('home.latestTitle')}</h2>
      {!any ? (
        <p className="mt-8 rounded-sm border border-border-soft bg-bone-cream p-8 text-center text-text-muted">
          {t('home.latestEmpty')}
        </p>
      ) : (
        lists
          .filter((l) => l.entries.length > 0)
          .map((l) => (
            <div key={l.type} className="mt-12">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-display text-xl font-semibold text-midnight-navy">{t(`${l.ns}.title`)}</h3>
                <Link href={`/${l.segment}`} className="text-sm font-medium text-warm-gold-deep hover:underline underline-offset-4">
                  {t(`${l.ns}.back`)}
                </Link>
              </div>
              <ul className="mt-6 grid gap-6 sm:grid-cols-3">
                {l.entries.map((e) => (
                  <li key={e.slug} className="rounded-sm border border-border-soft p-6">
                    <Link href={`/${l.segment}/${e.slug}`} className="font-display text-lg font-semibold text-midnight-navy hover:underline underline-offset-4">
                      {e.title}
                    </Link>
                    {e.summary ? <p className="mt-2 text-sm text-text-muted line-clamp-3">{e.summary}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
    </section>
  );
}

/** Closing call to action. */
export async function ContactCta({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'home' });
  return (
    <section className="bg-midnight-navy text-soft-pearl">
      <div className="max-w-7xl mx-auto px-6 py-20 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-display text-3xl font-semibold tracking-tight">{t('contactTitle')}</h2>
          <p className="mt-3 text-soft-pearl/75">{t('contactBody')}</p>
        </div>
        <ButtonLink href="/contact" variant="secondary" size="lg">
          {t('contactCta')}
        </ButtonLink>
      </div>
    </section>
  );
}
