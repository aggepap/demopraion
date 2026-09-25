/**
 * Reading the PRE-migration facet rows — pure, so it can be unit-tested without
 * a database and so the migration and the live site cannot disagree.
 *
 * Vessel types and departure locations used to be rows on the experience:
 * `{ id, label, slug? }`, with the slug derived from the label when the editor
 * had not pinned one. `db:migrate-booking-facets` turns those rows into
 * `vessel_type` / `departure_location` documents and replaces the rows with the
 * documents' ids.
 *
 * THE ONE THING THAT MATTERS: the slug is carried over verbatim. It is what
 * `/booking?type=…&departure=…` carries, so a term that comes out the other side
 * under a different key silently breaks every filter URL in the wild — the same
 * rule, for the same reason, that `migrate-booking-options.ts` states about the
 * availability ledger key.
 *
 * This module exists only for that migration and can be deleted, along with its
 * test, once no database still holds the old shape.
 */
import { slugifyLocalized } from '../../core/slug';
import { arr, rec } from './data';

/** One experience, as the migration reads it. */
export interface LegacyDoc {
  id: number;
  slug: string;
  locale: string;
  data: unknown;
  updatedAt?: Date | null;
}

/** A term to be created, merged across every experience that named it. */
export interface LegacyTerm {
  slug: string;
  /** The localized `{ [locale]: string }` map that becomes `data.title`. */
  title: Record<string, string>;
}

export interface LegacyFacetScan {
  terms: LegacyTerm[];
  /** Two experiences naming one slug differently — the newest won. */
  conflicts: string[];
  /** Rows that yielded no slug and were therefore not migrated. */
  dropped: string[];
}

export type FacetKey = 'types' | 'departures';

/** True once `data[key]` holds relation ids rather than the old rows. */
export function isMigratedFacet(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === 'number');
}

/**
 * The effective slugs of one document's rows, in author order.
 *
 * Deduped, because a document listing one slug twice must not end up pointing at
 * the same term twice. A row that yields no slug is dropped rather than
 * collapsed onto `''`, which would merge every unnameable row into one term.
 */
export function legacyFacetSlugs(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of arr(value)) {
    const r = rec(row);
    const explicit = typeof r.slug === 'string' ? r.slug.trim() : '';
    const slug = explicit || slugifyLocalized(r.label);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/** The label of one row as a localized map. A bare string is attributed to the
 *  default locale, which is what an unlocalized legacy value meant. */
function labelMap(label: unknown, defaultLocale: string): Record<string, string> {
  if (typeof label === 'string') return label.trim() ? { [defaultLocale]: label.trim() } : {};
  if (label && typeof label === 'object' && !Array.isArray(label)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(label as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
  }
  return {};
}

/**
 * The vocabulary of one dimension, merged across every experience.
 *
 * Documents are processed newest first, so where two experiences disagree on the
 * name behind one slug the most recently edited wins — and every disagreement is
 * reported rather than silently resolved, because the loser is about to stop
 * existing.
 */
export function collectLegacyFacetTerms(
  docs: LegacyDoc[],
  key: FacetKey,
  defaultLocale: string,
): LegacyFacetScan {
  const bySlug = new Map<string, Record<string, string>>();
  const conflicts: string[] = [];
  const dropped: string[] = [];

  const ordered = [...docs].sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));

  for (const doc of ordered) {
    const rows = arr(rec(doc.data)[key]);
    for (const row of rows) {
      const r = rec(row);
      const explicit = typeof r.slug === 'string' ? r.slug.trim() : '';
      const slug = explicit || slugifyLocalized(r.label);
      const where = `${doc.slug} [${doc.locale}] #${doc.id}`;
      if (!slug) {
        dropped.push(`${where} — a ${key} row has no usable name, so no filter key could be derived`);
        continue;
      }
      const incoming = labelMap(r.label, defaultLocale);
      const existing = bySlug.get(slug);
      if (!existing) {
        bySlug.set(slug, incoming);
        continue;
      }
      for (const [locale, value] of Object.entries(incoming)) {
        if (existing[locale] === undefined) existing[locale] = value;
        else if (existing[locale] !== value) {
          conflicts.push(
            `${where} — "${slug}" [${locale}] is "${value}" here but "${existing[locale]}" on a ` +
              'more recently edited experience; the newer name was kept',
          );
        }
      }
    }
  }

  const terms = [...bySlug.entries()]
    .map(([slug, title]) => ({ slug, title }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return { terms, conflicts, dropped };
}
