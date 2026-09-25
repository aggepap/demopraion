/**
 * Fold the `resource`, `booking_type` and `departure` documents into the
 * experiences that use them.
 *
 *   npm run db:migrate-booking-options            # dry run — prints, writes nothing
 *   npm run db:migrate-booking-options -- --apply # writes
 *   npm run db:migrate-booking-options -- --apply --purge   # …and deletes the folded documents
 *
 * THE ONE THING THAT MATTERS
 * --------------------------
 * Each new `options[]` row keeps the resource's OLD `translation_group_id` as
 * its `id`.
 *
 * That id is the availability key. Every live row in `reservation_holds` and
 * `booking_slots` is already keyed `res:<translation_group_id>`, and
 * `reservations.resource_group_id` already stores it. Preserve it and the
 * calendar is continuous across the deploy with no ledger migration at all;
 * mint a fresh uuid instead and every existing booking silently detaches from
 * the thing it booked — the exact failure the old design existed to prevent.
 *
 * The script is idempotent: an experience whose `options` are already populated
 * is left alone, so a re-run after a partial failure resumes rather than
 * duplicating.
 */
import '../../adapters/mysql/load-env';

import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';

import { getMysqlDb } from '../../adapters/mysql/client';
import { documentRelations, documents } from '../../adapters/mysql/schema';

const APPLY = process.argv.includes('--apply');
const PURGE = process.argv.includes('--purge');

const BOOKING_TYPE = 'booking';
const RESOURCE_TYPE = 'resource';
const FOLDED_TYPES = [RESOURCE_TYPE, 'booking_type', 'departure'];

type Row = Record<string, unknown>;

function rec(v: unknown): Row {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
/** A relation field holds an array of ids, or a bare id for a single relation. */
function ids(v: unknown): number[] {
  const raw = Array.isArray(v) ? v : v == null ? [] : [v];
  return raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

/** The stable id the ledger already uses for this document. Mirrors what
 *  `read.ts` used to compute, `doc:<id>` fallback included. */
function stableId(row: { id: number; translationGroupId: string | null }): string {
  return row.translationGroupId ?? `doc:${row.id}`;
}

async function main(): Promise<void> {
  const db = getMysqlDb();

  const folded = await db
    .select({
      id: documents.id,
      type: documents.type,
      slug: documents.slug,
      locale: documents.locale,
      data: documents.data,
      translationGroupId: documents.translationGroupId,
    })
    .from(documents)
    .where(inArray(documents.type, FOLDED_TYPES));

  const byId = new Map(folded.map((r) => [r.id, r]));

  const experiences = await db
    .select({ id: documents.id, slug: documents.slug, locale: documents.locale, data: documents.data })
    .from(documents)
    .where(eq(documents.type, BOOKING_TYPE));

  if (experiences.length === 0) {
    console.log('No experiences found — nothing to migrate.');
    process.exit(0);
  }

  const dangling: string[] = [];
  let changed = 0;
  let optionRows = 0;
  let facetRows = 0;

  for (const exp of experiences) {
    const data = rec(exp.data);
    const where = `${exp.slug} [${exp.locale}] #${exp.id}`;

    // Idempotence: a document that already carries embedded rows has been done.
    if (arr(data.options).length > 0 || arr(data.types).some((t) => rec(t).label !== undefined)) {
      console.log(`· ${where} — already migrated, skipping`);
      continue;
    }

    const next: Row = { ...data };

    // ── Options, from the `resources` rows ──
    const options: Row[] = [];
    for (const row of arr(data.resources)) {
      const r = rec(row);
      const relation = Array.isArray(r.resource) ? r.resource[0] : r.resource;
      const doc = byId.get(Number(relation));
      if (!doc || doc.type !== RESOURCE_TYPE) {
        dangling.push(`${where} — resources row references missing resource ${String(relation)}`);
        continue;
      }
      const rd = rec(doc.data);
      options.push({
        // The old ledger key, carried over verbatim. See the header.
        id: stableId(doc),
        name: rd.title ?? doc.slug,
        summary: rd.description,
        image: rd.image,
        cost: r.cost,
        capacityPerDay: rd.capacityPerDay ?? 1,
        seats: rd.seats,
        seasonal: r.seasonal,
      });
    }
    if (options.length) next.options = options;
    // `resourceLabel` was renamed; carry the authored text across.
    if (data.resourceLabel !== undefined) next.optionsLabel = data.resourceLabel;

    // ── Vessel types and departure locations, from their relations ──
    const facets = (key: 'types' | 'departures', expectType: string): Row[] => {
      const out: Row[] = [];
      for (const id of ids(data[key])) {
        const doc = byId.get(id);
        if (!doc || doc.type !== expectType) {
          dangling.push(`${where} — ${key} references missing ${expectType} ${id}`);
          continue;
        }
        // The term's existing slug is reused, so filter URLs already in the
        // wild keep working.
        out.push({ id: randomUUID(), slug: doc.slug, label: rec(doc.data).title ?? doc.slug });
      }
      return out;
    };
    const types = facets('types', 'booking_type');
    const departures = facets('departures', 'departure');
    if (types.length) next.types = types;
    if (departures.length) next.departures = departures;

    // ── Kind. Nothing in the old data distinguishes a stay, and nothing was
    //    sold as one, so every migrated experience is transport. ──
    if (next.kind === undefined) next.kind = 'transport';

    // The old keys go, or the strict validator rejects the document on its next
    // save — `data` is parsed against the current field set, and `resources`
    // no longer exists in it.
    delete next.resources;
    delete next.resourceLabel;

    optionRows += options.length;
    facetRows += types.length + departures.length;
    changed++;

    console.log(
      `${APPLY ? '✓' : '·'} ${where} — ${options.length} option(s), ` +
        `${types.length} type(s), ${departures.length} departure(s)`,
    );
    for (const o of options) console.log(`    option id ${String(o.id)}  ← ledger key res:${String(o.id)}`);

    if (APPLY) {
      await db.update(documents).set({ data: next as never }).where(eq(documents.id, exp.id));
    }
  }

  if (dangling.length) {
    console.log(`\n${dangling.length} dangling reference(s) — these were DROPPED, not migrated:`);
    for (const d of dangling) console.log(`  ! ${d}`);
  }

  console.log(
    `\n${APPLY ? 'Migrated' : 'Would migrate'} ${changed} experience row(s): ` +
      `${optionRows} option(s), ${facetRows} facet row(s).`,
  );

  if (PURGE) {
    if (!APPLY) {
      console.log('--purge ignored without --apply.');
    } else if (dangling.length) {
      // Deleting now would destroy the only evidence of what the dangling
      // references were meant to point at.
      console.log(`\nRefusing to purge: ${dangling.length} dangling reference(s) above must be resolved first.`);
    } else {
      const foldedIds = folded.map((r) => r.id);
      if (foldedIds.length) {
        await db.delete(documentRelations).where(inArray(documentRelations.fromId, foldedIds));
        await db.delete(documentRelations).where(inArray(documentRelations.toId, foldedIds));
        await db.delete(documents).where(inArray(documents.id, foldedIds));
      }
      console.log(`Purged ${foldedIds.length} folded document(s) and their relations.`);
    }
  } else if (APPLY) {
    console.log(
      `\n${folded.length} resource/type/departure document(s) left in place. ` +
        'Verify the site, then re-run with --purge to delete them.',
    );
  }

  if (!APPLY) console.log('\nDry run — nothing was written. Re-run with --apply.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
