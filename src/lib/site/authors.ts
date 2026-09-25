/**
 * `author` documents → the profile page view and the schema.org `Person`.
 *
 * Pure, and tolerant of whatever `data` holds: author fields are typed by an
 * editor, and nothing about a half-filled profile should take a page down. Every
 * URL an editor enters is kept only if it parses as absolute http(s) — these go
 * into `href`s and into `sameAs`, where a relative path or a `javascript:` scheme
 * is either broken or dangerous.
 *
 * The author page itself (`/authors/{slug}`) exists on sites with a blog; these
 * helpers are here on every site so shared templates can import them.
 */
import { breadcrumbSchema, localePath, ORG_ID, SITE_URL, WEBSITE_ID } from '@/lib/seo/schemas';

export interface AuthorExperience {
  name: string;
  url?: string;
  role?: string;
  period?: string;
}

export interface AuthorView {
  slug: string;
  name: string;
  alternateName?: string;
  jobTitle?: string;
  summary?: string;
  /** TipTap JSON, rendered by `RichText`. */
  bio: unknown;
  avatarUrl?: string;
  /** Absolute http(s) profile URLs of this person, LinkedIn first. */
  profiles: string[];
  experience: AuthorExperience[];
  knowsAbout: { name: string; sameAs?: string }[];
}

export const authorProfilePath = (slug: string): string => `/authors/${slug}`;

const mediaPath = (uuid: string) => `/api/cms/media/file/${uuid}`;
const personId = (slug: string) => `${SITE_URL}/#person-${slug}`;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function httpUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : undefined;
  } catch {
    return undefined;
  }
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

export function presentAuthorDoc(doc: { slug: string; data: unknown }): AuthorView {
  const d = record(doc.data);

  const profiles = [httpUrl(d.linkedinUrl), ...rows(d.profiles).map((r) => httpUrl(r.url))].filter(
    (url): url is string => Boolean(url),
  );

  const experience = rows(d.experience).flatMap((r): AuthorExperience[] => {
    const name = text(r.name);
    if (!name) return [];
    return [{ name, url: httpUrl(r.url), role: text(r.role), period: text(r.period) }];
  });

  const knowsAbout = rows(d.knowsAbout).flatMap((r) => {
    const name = text(r.name);
    return name ? [{ name, sameAs: httpUrl(r.sameAs) }] : [];
  });

  const avatar = text(d.avatar);

  return {
    slug: doc.slug,
    name: text(d.name) ?? '',
    alternateName: text(d.alternateName),
    jobTitle: text(d.jobTitle),
    summary: text(d.summary),
    bio: d.bio,
    avatarUrl: avatar ? mediaPath(avatar) : undefined,
    profiles: [...new Set(profiles)],
    experience,
    knowsAbout,
  };
}

export function authorPersonSchema(view: AuthorView, locale: string): Record<string, unknown> {
  return {
    '@type': 'Person',
    '@id': personId(view.slug),
    name: view.name,
    ...(view.alternateName ? { alternateName: view.alternateName } : {}),
    ...(view.jobTitle ? { jobTitle: view.jobTitle } : {}),
    ...(view.summary ? { description: view.summary } : {}),
    worksFor: { '@id': ORG_ID },
    url: `${SITE_URL}${localePath(locale, authorProfilePath(view.slug))}`,
    ...(view.avatarUrl ? { image: `${SITE_URL}${view.avatarUrl}` } : {}),
    ...(view.profiles.length > 0 ? { sameAs: view.profiles } : {}),
    ...(view.experience.length > 0
      ? {
          alumniOf: view.experience.map((e) => ({
            '@type': 'Organization',
            name: e.name,
            ...(e.url ? { url: e.url } : {}),
          })),
        }
      : {}),
    ...(view.knowsAbout.length > 0
      ? {
          knowsAbout: view.knowsAbout.map((k) => ({
            '@type': 'Thing',
            name: k.name,
            ...(k.sameAs ? { sameAs: k.sameAs } : {}),
          })),
        }
      : {}),
  };
}

/** `ProfilePage` + breadcrumbs for `/authors/{slug}`, ready for `documentGraph`. */
export function authorProfileNodes(view: AuthorView, locale: string, homeLabel: string): Record<string, unknown>[] {
  const path = authorProfilePath(view.slug);
  const url = `${SITE_URL}${localePath(locale, path)}`;
  return [
    {
      '@type': 'ProfilePage',
      '@id': `${url}#profilepage`,
      url,
      name: view.name,
      inLanguage: locale,
      isPartOf: { '@id': WEBSITE_ID },
      mainEntity: authorPersonSchema(view, locale),
    },
    breadcrumbSchema(
      [
        { name: homeLabel, path: '/' },
        { name: view.name, path },
      ],
      locale,
    ),
  ];
}

/**
 * The articles written by an author, given the ids of that author's documents
 * (one per language — an article may point at any of them). The `author` field is
 * a relation, stored as a document id; anything else is not a link.
 */
export function articlesByAuthor<T extends { data: unknown }>(articles: readonly T[], authorIds: ReadonlySet<number>): T[] {
  return articles.filter((a) => {
    const author = record(a.data).author;
    return typeof author === 'number' && authorIds.has(author);
  });
}
