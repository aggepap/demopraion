/**
 * Content documents (articles, answers, case studies) mapped to one shape the
 * list and detail pages render. Each collection names its fields differently;
 * this is the one place that knows how (see the definitions in site.config.ts).
 */
import type { DocumentRow } from '@/cms';
import type { SchemaCategoryKey } from '@/cms/core/structured-data/policy';

export type ContentType = 'article' | 'answer' | 'scenario';

/** Each content type's category in Settings → Structured data. */
export const CONTENT_SCHEMA_CATEGORY: Record<ContentType, SchemaCategoryKey> = {
  article: 'articles',
  answer: 'answers',
  scenario: 'caseStudies',
};

export interface ContentEntry {
  slug: string;
  title: string;
  /** The line under the title on list pages; the lead on detail pages. */
  summary: string;
  /** Small line above the title, when the collection has one. */
  eyebrow?: string;
  /** Media UUID of the cover image. */
  image?: string;
  /** Rich-text (TipTap JSON) body. */
  body: unknown;
  /** Set for answers: the question and its short answer, for FAQPage JSON-LD. */
  faq?: { question: string; answer: string };
  publishedAt: Date | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function presentEntry(
  type: ContentType,
  doc: Pick<DocumentRow, 'slug' | 'data' | 'publishedAt'>,
): ContentEntry {
  const d = (doc.data ?? {}) as Record<string, unknown>;
  const base = {
    slug: doc.slug,
    body: d.body,
    publishedAt: doc.publishedAt ? new Date(doc.publishedAt) : null,
  };
  switch (type) {
    case 'answer': {
      const question = str(d.question);
      const answer = str(d.shortAnswer);
      return {
        ...base,
        title: question,
        summary: answer,
        faq: question && answer ? { question, answer } : undefined,
      };
    }
    case 'scenario':
      return {
        ...base,
        title: str(d.title),
        summary: str(d.summary),
        eyebrow: str(d.industry) || undefined,
        image: str(d.cover) || undefined,
      };
    case 'article':
      return {
        ...base,
        title: str(d.title),
        summary: str(d.excerpt),
        image: str(d.cover) || undefined,
      };
  }
}

// ── Categories ────────────────────────────────────────────────────────────

/** One category term, resolved for a locale. */
export interface ContentTerm {
  id: number;
  slug: string;
  title: string;
  description: string;
  parentId: number | null;
}

export interface ContentTermNode {
  term: ContentTerm;
  children: ContentTermNode[];
}

/** A per-locale map (or a plain string) → the text for `locale`, else any locale's. */
function localized(value: unknown, locale: string): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const map = value as Record<string, unknown>;
  const own = map[locale];
  if (typeof own === 'string' && own.trim()) return own.trim();
  const any = Object.values(map).find((v): v is string => typeof v === 'string' && v.trim() !== '');
  return any?.trim() ?? '';
}

/** A category document (one row, per-locale title) as the category pages render it. */
export function presentTerm(doc: Pick<DocumentRow, 'id' | 'slug' | 'data'>, locale: string): ContentTerm {
  const d = (doc.data ?? {}) as Record<string, unknown>;
  return {
    id: doc.id,
    slug: doc.slug,
    title: localized(d.title, locale) || doc.slug,
    description: localized(d.description, locale),
    parentId: typeof d.parent === 'number' && Number.isInteger(d.parent) ? d.parent : null,
  };
}

/**
 * Terms nested under their parents, each level sorted by title.
 *
 * A term whose parent is not in the list — unpublished, deleted — is shown at the
 * top level rather than disappearing with it. So is a term caught in a parent
 * cycle, which an editor can create by re-parenting: nothing is hidden, and
 * nothing recurses forever.
 */
export function buildTermTree(terms: ReadonlyArray<ContentTerm>): ContentTermNode[] {
  const byId = new Map(terms.map((t) => [t.id, t]));
  const hasCycleAbove = (t: ContentTerm): boolean => {
    const seen = new Set<number>([t.id]);
    let parent = t.parentId;
    while (parent !== null && byId.has(parent)) {
      if (seen.has(parent)) return true;
      seen.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    return false;
  };
  const isRoot = (t: ContentTerm): boolean =>
    t.parentId === null || t.parentId === t.id || !byId.has(t.parentId) || hasCycleAbove(t);

  const byTitle = (a: ContentTermNode, b: ContentTermNode) => a.term.title.localeCompare(b.term.title);
  const nodeFor = (t: ContentTerm): ContentTermNode => ({
    term: t,
    children: terms.filter((c) => c.parentId === t.id && c.id !== t.id && !isRoot(c)).map(nodeFor).sort(byTitle),
  });
  return terms.filter(isRoot).map(nodeFor).sort(byTitle);
}

/** Public URL of a CMS media file. */
export const mediaUrl = (uuid: string): string => `/api/cms/media/file/${uuid}`;
