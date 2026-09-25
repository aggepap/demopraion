/**
 * Turn the `types` / `departures` rows on each experience into shared
 * `vessel_type` / `departure_location` documents.
 *
 *   npm run db:migrate-booking-facets            # dry run — prints, writes nothing
 *   npm run db:migrate-booking-facets -- --apply # writes
 *
 * THE ONE THING THAT MATTERS
 * --------------------------
 * Each term document keeps the slug the rows already resolved to.
 *
 * That slug is the public filter key: `/booking?type=<slug>&departure=<slug>` is
 * in the wild, in bookmarks and in links. Carry it over and every one of those
 * URLs keeps selecting the same thing; mint a fresh one and they all silently
 * stop matching, with a 200 and an empty result to show for it. The slug is
 * derived with the very same `slugifyLocalized` the site used to derive it at
 * read time, so the two cannot disagree about Greek.
 *
 * A term is ONE document in the default locale with a localized `title` map —
 * not one row per locale. That is how `TermPicker` creates them, and it is what
 * keeps a selected id resolvable in every language; per-locale rows would give
 * one term two ids, and the `shared` relation on the experience can only hold
 * one of them.
 *
 * It also stamps `optionsEnabled` on any experience that already has `options`
 * rows. That flag is new, the Options fields are hidden until it is on, and an
 * absent flag reads as off — so without this pass an experience with three
 * vessels would open with its Options section collapsed to a single unchecked
 * box, which reads as "the data is gone".
 *
 * The script is idempotent: an experience whose `types` already hold ids and
 * whose `optionsEnabled` is already set is left alone, and a term document that
 * already exists is reused, so a re-run after a partial failure resumes rather
 * than duplicating.
 *
 * RUN IT IN THE SAME WINDOW AS THE DEPLOY. The read path degrades quietly on an
 * unmigrated document (unknown row shapes read as no facets), but its next SAVE
 * is a 400 — a `many` relation validates as `number[]`, and the old rows are
 * objects. Between deploy and migration, those experiences cannot be edited.
 */
import '../../adapters/mysql/load-env';

import { and, eq } from 'drizzle-orm';

import { getMysqlDb } from '../../adapters/mysql/client';
import { documentRelations, documents } from '../../adapters/mysql/schema';
import {
  collectLegacyFacetTerms,
  isMigratedFacet,
  legacyFacetSlugs,
  type FacetKey,
  type LegacyDoc,
} from '../../../modules/booking/legacy-facets';

const APPLY = process.argv.includes('--apply');
const LOCALE_FLAG = process.argv.find((a) => a.startsWith('--locale='))?.slice('--locale='.length);

const BOOKING_TYPE = 'booking';
/** Field key on the experience → collection key of the vocabulary it points at. */
const DIMENSIONS: { key: FacetKey; type: string; label: string }[] = [
  { key: 'types', type: 'vessel_type', label: 'vessel type' },
  { key: 'departures', type: 'departure_location', label: 'departure location' },
];

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * The locale a term document must be created in.
 *
 * It has to match the one `TermPicker` lists with, or the migrated terms are
 * invisible in the very picker that is supposed to offer them. The picker uses
 * the site's default locale — which this script cannot read, because
 * `src/cms/**` is the reusable core and must not import `site.config`.
 *
 * So it is taken from the taxonomy the picker already maintains: the existing
 * `booking_category` documents were created BY that picker, in that locale.
 *
 * With no categories to read, it REFUSES rather than guesses. The experiences
 * themselves are no help — they are one row per locale, so tallying them just
 * returns whichever language happens to have more rows, and a wrong answer here
 * is silent: the terms are created, the migration reports success, and the
 * picker shows an empty list.
 */
async function resolveCanonicalLocale(db: ReturnType<typeof getMysqlDb>): Promise<string> {
  if (LOCALE_FLAG) return LOCALE_FLAG;
  const rows = await db
    .select({ locale: documents.locale })
    .from(documents)
    .where(eq(documents.type, 'booking_category'));

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.locale, (counts.get(r.locale) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (best) return best;

  console.error(
    'Cannot tell which locale terms belong in: there are no `booking_category` documents to read it from.\n' +
      'Pass the site default locale explicitly, e.g. --locale=el.',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const db = getMysqlDb();
  const defaultLocale = await resolveCanonicalLocale(db);
  console.log(
    `Terms will be created in "${defaultLocale}"` +
      (LOCALE_FLAG ? ' (--locale).' : ' — read from the existing categories. Override with --locale=xx.'),
  );

  const experiences: LegacyDoc[] = await db
    .select({
      id: documents.id,
      slug: documents.slug,
      locale: documents.locale,
      data: documents.data,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(eq(documents.type, BOOKING_TYPE));

  if (experiences.length === 0) {
    console.log('No experiences found — nothing to migrate.');
    process.exit(0);
  }

  let dropped = 0;
  // slug → document id, per dimension.
  const idsBySlug = new Map<string, Map<string, number>>();

  /* ── Pass 1 + 2: build the vocabulary, then create the term documents ──── */
  for (const dim of DIMENSIONS) {
    const scan = collectLegacyFacetTerms(experiences, dim.key, defaultLocale);
    const existing = await db
      .select({ id: documents.id, slug: documents.slug })
      .from(documents)
      .where(eq(documents.type, dim.type));
    const known = new Map(existing.map((r) => [r.slug, r.id]));

    console.log(`\n── ${dim.label}s — ${scan.terms.length} term(s) ──`);
    for (const c of scan.conflicts) console.log(`  ~ ${c}`);
    for (const d of scan.dropped) console.log(`  ! ${d}`);
    dropped += scan.dropped.length;

    for (const term of scan.terms) {
      const already = known.get(term.slug);
      if (already) {
        console.log(`  · ${term.slug} — already exists (#${already})`);
        continue;
      }
      const name = term.title[defaultLocale] ?? Object.values(term.title)[0] ?? term.slug;
      console.log(`  ${APPLY ? '✓' : '·'} ${term.slug} — "${name}"`);
      if (!APPLY) continue;
      const [res] = await db.insert(documents).values({
        type: dim.type,
        slug: term.slug,
        locale: defaultLocale,
        status: 'published',
        data: term.title ? ({ title: term.title } as never) : ({} as never),
      });
      known.set(term.slug, Number((res as { insertId: number }).insertId));
    }
    idsBySlug.set(dim.key, known);
  }

  /* ── Pass 3 + 4: point the experiences at them, and index the relations ── */
  let changed = 0;
  let linkRows = 0;
  console.log('\n── experiences ──');

  for (const exp of experiences) {
    const data = rec(exp.data);
    const where = `${exp.slug} [${exp.locale}] #${exp.id}`;
    const next: Record<string, unknown> = { ...data };
    const links: { key: FacetKey; ids: number[] }[] = [];
    let touched = false;
    const notes: string[] = [];

    for (const dim of DIMENSIONS) {
      const current = data[dim.key];
      // Absent entirely — an experience that never named one. Nothing to
      // rewrite, and reporting it as migrated would bury the real rows in noise.
      if (current === undefined) continue;
      if (isMigratedFacet(current)) {
        links.push({ key: dim.key, ids: current as number[] });
        continue;
      }
      const known = idsBySlug.get(dim.key)!;
      const slugs = legacyFacetSlugs(current);
      const ids = slugs.map((s) => known.get(s)).filter((n): n is number => typeof n === 'number');
      // In a dry run the term documents do not exist yet, so the ids are not
      // knowable; report the slugs instead of pretending to a count.
      if (!APPLY) notes.push(`${dim.key}: ${slugs.length ? slugs.join(', ') : '—'}`);
      else notes.push(`${dim.key}: ${ids.length}`);

      if (slugs.length === 0) delete next[dim.key];
      else next[dim.key] = ids;
      links.push({ key: dim.key, ids });
      touched = true;
    }

    // The new Options switch. Only stamped when there is something to reveal —
    // an experience that never had options keeps the clean, unchecked default.
    if (Array.isArray(data.options) && data.options.length > 0 && data.optionsEnabled === undefined) {
      next.optionsEnabled = true;
      notes.push(`optionsEnabled: on (${data.options.length} option(s))`);
      touched = true;
    }

    if (!touched) {
      console.log(`  · ${where} — already migrated, skipping`);
      continue;
    }

    changed++;
    console.log(`  ${APPLY ? '✓' : '·'} ${where} — ${notes.join('  ')}`);
    if (!APPLY) continue;

    await db.update(documents).set({ data: next as never }).where(eq(documents.id, exp.id));

    // `document_relations` is derived on save by `syncDocumentRelations`, and a
    // raw UPDATE bypasses that. Without these rows the reverse index is blank,
    // and it is what the delete cascade acts on — a term deleted before the
    // experience was next saved would leave nothing behind to clean up.
    for (const link of links) {
      await db
        .delete(documentRelations)
        .where(and(eq(documentRelations.fromId, exp.id), eq(documentRelations.fieldKey, link.key)));
      if (link.ids.length === 0) continue;
      await db.insert(documentRelations).values(
        link.ids.map((toId, position) => ({ fromId: exp.id, toId, fieldKey: link.key, position })),
      );
      linkRows += link.ids.length;
    }
  }

  console.log(
    `\n${APPLY ? 'Migrated' : 'Would migrate'} ${changed} experience row(s)` +
      (APPLY ? `, ${linkRows} relation row(s).` : '.'),
  );

  if (dropped > 0) {
    console.log(
      `\n${dropped} row(s) could not be migrated — see the "!" lines above. ` +
        'Give them a name, or accept that those filters disappear.',
    );
  }
  if (!APPLY) {
    console.log('\nDry run — nothing was written. Re-run with --apply.');
    process.exit(0);
  }
  process.exit(dropped > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
