import Image from 'next/image';

import { RichText } from '@/components/cms/RichText';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Link } from '@/lib/i18n/routing';
import type { AuthorView } from '@/lib/site/authors';

export interface AuthorProfileLabels {
  eyebrow: string;
  experience: string;
  expertise: string;
  profiles: string;
  articles: string;
}

/** Readable label for a profile link: its host without `www.`. */
function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

const SECTION_HEADING = 'font-display text-2xl font-semibold tracking-tight text-midnight-navy mb-6';

/**
 * `/authors/{slug}` body. Every section beyond the name hides itself when the
 * editor left it empty, so a half-filled profile reads as short, not broken.
 */
export function AuthorProfile({
  view,
  labels,
  articles,
}: {
  view: AuthorView;
  labels: AuthorProfileLabels;
  articles: { href: string; title: string; summary: string }[];
}) {
  return (
    <article className="max-w-3xl mx-auto px-6 pt-16 pb-24">
      <header className="flex flex-col-reverse gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Eyebrow className="mb-4">{labels.eyebrow}</Eyebrow>
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1] text-midnight-navy">
            {view.name}
          </h1>
          {view.jobTitle ? <p className="mt-3 text-lg text-text-muted">{view.jobTitle}</p> : null}
        </div>
        {view.avatarUrl ? (
          <Image
            src={view.avatarUrl}
            alt={view.name}
            width={160}
            height={160}
            priority
            className="h-32 w-32 shrink-0 rounded-full object-cover sm:h-40 sm:w-40"
          />
        ) : null}
      </header>

      {view.summary ? <p className="mt-10 text-xl leading-relaxed text-text-primary">{view.summary}</p> : null}

      <RichText
        value={view.bio}
        className="article-prose mt-8 flex flex-col gap-4 text-base md:text-lg leading-relaxed text-text-primary"
      />

      {articles.length > 0 ? (
        <section className="mt-16">
          <h2 className={SECTION_HEADING}>{labels.articles}</h2>
          <ul className="flex flex-col gap-6">
            {articles.map((a) => (
              <li key={a.href}>
                <Link href={a.href} className="font-display text-lg font-semibold text-midnight-navy hover:underline underline-offset-4">
                  {a.title}
                </Link>
                {a.summary ? <p className="mt-1 text-text-muted">{a.summary}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.experience.length > 0 ? (
        <section className="mt-16">
          <h2 className={SECTION_HEADING}>{labels.experience}</h2>
          <ul className="flex flex-col gap-4">
            {view.experience.map((e, i) => (
              <li key={`${e.name}-${i}`} className="text-base md:text-lg">
                {e.url ? (
                  <a href={e.url} className="font-medium text-warm-gold-deep hover:underline underline-offset-4">
                    {e.name}
                  </a>
                ) : (
                  <span className="font-medium text-text-primary">{e.name}</span>
                )}
                {e.role || e.period ? (
                  <span className="text-text-muted">
                    {' · '}
                    {[e.role, e.period].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.knowsAbout.length > 0 ? (
        <section className="mt-16">
          <h2 className={SECTION_HEADING}>{labels.expertise}</h2>
          <ul className="flex flex-wrap gap-2">
            {view.knowsAbout.map((k) => (
              <li key={k.name} className="rounded-full border border-border-soft px-3 py-1 text-sm text-text-primary">
                {k.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.profiles.length > 0 ? (
        <section className="mt-16">
          <h2 className={SECTION_HEADING}>{labels.profiles}</h2>
          <ul className="flex flex-col gap-2">
            {view.profiles.map((url) => (
              <li key={url}>
                {/* `rel="me"`: these are profiles of the person this page is about. */}
                <a href={url} rel="me noopener" className="text-base text-warm-gold-deep hover:underline underline-offset-4">
                  {hostOf(url)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
