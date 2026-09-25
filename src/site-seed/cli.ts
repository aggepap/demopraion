/**
 * Seed this site's settings and placeholder content.
 *
 *   npm run db:seed-site                        settings + missing documents, as drafts
 *   npm run db:seed-site -- --force             also overwrite documents already present
 *   npm run db:seed-site -- --publish-samples   create them published (for QA)
 *
 * Settings (module flags, currency, booking kinds, …) are always upserted.
 * Documents are created only when absent unless --force, so re-running is safe
 * and never reverts what an editor changed. What gets written is in ./data.ts.
 *
 * Runs outside Next with `tsconfig.seed.json`, which stubs `server-only`.
 */
import '@/cms/db/adapters/mysql/load-env';

import { and, eq } from 'drizzle-orm';

import type { DocumentWriteInput } from '@/cms/core/documents/service';
import { setSetting } from '@/cms/core/settings';
import { formatMultiValue } from '@/cms/core/settings/schema';
import { getDb, schema } from '@/cms/db';
import { importBrand } from '@/cms/db/seeds/brand';
import { applySeedDocument, resolveTranslationGroupId } from '@/cms/db/seeds/documents';
import { formatSeedSummary, parseSeedMode, tally, type SeedCounts, type SeedMode } from '@/cms/db/seeds/seed-mode';
import config from '@/site.config';

import { BOOKING_KINDS, DEFAULT_LOCALE, LOCALES, PAGES, SAMPLES, SETTINGS } from './data';

const argv = process.argv.slice(2);
const mode: SeedMode = parseSeedMode(argv);
const publish = argv.includes('--publish-samples');
const counts: SeedCounts = { created: 0, updated: 0, skipped: 0 };

/** One paragraph of TipTap rich text. */
function richText(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

/** The same text in every locale — for localized (per-locale map) fields. */
function everyLocale(byLocale: Record<string, string>): Record<string, string> {
  return Object.fromEntries(LOCALES.map((l) => [l, byLocale[l] ?? byLocale.en ?? Object.values(byLocale)[0]]));
}

function status(): Pick<DocumentWriteInput, 'status' | 'publishedAt'> {
  return publish ? { status: 'published', publishedAt: new Date() } : { status: 'draft', publishedAt: null };
}

async function seedDoc(type: string, slug: string, locale: string, input: Omit<DocumentWriteInput, 'slug' | 'locale'>) {
  tally(counts, await applySeedDocument(config, type, slug, locale, mode, { slug, locale, ...input }));
}

/** One document per locale, all in one translation group. */
async function seedGroup(
  type: string,
  slug: string,
  dataFor: (locale: string) => Record<string, unknown>,
  extra: (locale: string) => Partial<DocumentWriteInput> = () => ({}),
) {
  const translationGroupId = await resolveTranslationGroupId(type, slug);
  for (const locale of LOCALES) {
    await seedDoc(type, slug, locale, { ...status(), translationGroupId, data: dataFor(locale), ...extra(locale) });
  }
}

async function idOf(type: string, slug: string, locale: string): Promise<number | null> {
  const [row] = await getDb()
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, type), eq(schema.documents.slug, slug), eq(schema.documents.locale, locale)))
    .limit(1);
  return row?.id ?? null;
}

async function seedSettings() {
  for (const [key, value] of SETTINGS) await setSetting(key, value, null);
  if (BOOKING_KINDS) await setSetting('booking.kinds', formatMultiValue(BOOKING_KINDS), null);
  console.log(`✓ ${SETTINGS.length + (BOOKING_KINDS ? 1 : 0)} settings written`);
  // The brand is only written when absent: once the owner has edited it in
  // Settings → Branding, a re-seed must not put the scaffold's values back.
  const brandKeys = await importBrand({ brandFile: config.brand });
  console.log(brandKeys.length ? `✓ brand written (${brandKeys.join(', ')})` : '✓ brand already set — left alone');
}

async function seedPages() {
  for (const page of PAGES) {
    await seedGroup(
      'page',
      page.slug,
      (l) => ({ title: page.title[l], body: richText(page.body[l]) }),
      // The home copy is shown at `/`, so that is its canonical URL.
      (l) => (page.slug === 'home' ? { canonicalPath: l === DEFAULT_LOCALE ? '/' : `/${l}` } : {}),
    );
  }
}

/**
 * The "General" category of a post collection, and its id. One document in the
 * default locale with a title per locale, like every taxonomy term. The category
 * pages themselves are routes, so they exist whether or not this is published.
 */
async function seedGeneralCategory(type: string): Promise<number | null> {
  await seedDoc(type, 'general', DEFAULT_LOCALE, {
    ...status(),
    data: {
      title: everyLocale({ en: 'General', el: 'Γενικά' }),
      description: everyLocale({ en: 'A placeholder category.', el: 'Προσωρινή κατηγορία.' }),
    },
  });
  return idOf(type, 'general', DEFAULT_LOCALE);
}

/** `{ categories: [id] }` when the category exists, else nothing. */
const inCategory = (id: number | null) => (id ? { categories: [id] } : {});

async function seedSamples() {
  if (SAMPLES.product) {
    // Categories are one document in the default locale with a per-locale title.
    await seedDoc('category', 'sample-category', DEFAULT_LOCALE, {
      ...status(),
      data: { title: everyLocale({ en: 'Sample category', el: 'Δείγμα κατηγορίας' }) },
    });
    const categoryId = await idOf('category', 'sample-category', DEFAULT_LOCALE);
    await seedGroup('product', 'sample-product', (l) => ({
      title: l === 'el' ? 'Δείγμα προϊόντος' : 'Sample product',
      price: 10,
      ...(categoryId ? { categories: [categoryId] } : {}),
    }));
  }

  if (SAMPLES.bookingKind) {
    for (const [type, en, el] of [
      ['booking_category', 'Sample category', 'Δείγμα κατηγορίας'],
      ['vessel_type', 'Sample type', 'Δείγμα τύπου'],
      ['departure_location', 'Sample location', 'Δείγμα τοποθεσίας'],
    ] as const) {
      await seedDoc(type, 'sample', DEFAULT_LOCALE, { ...status(), data: { title: everyLocale({ en, el }) } });
    }
    const kind = SAMPLES.bookingKind;
    await seedGroup('booking', 'sample-experience', (l) => ({
      kind,
      title: l === 'el' ? 'Δείγμα κράτησης' : 'Sample experience',
    }));
  }

  if (SAMPLES.article) {
    await seedGroup('author', 'sample-author', (l) =>
      l === 'el'
        ? { name: 'Δείγμα συντάκτη', jobTitle: 'Συντάκτης', summary: 'Προσωρινό βιογραφικό.', bio: richText('Προσωρινό κείμενο βιογραφικού.') }
        : { name: 'Sample author', jobTitle: 'Writer', summary: 'A placeholder biography.', bio: richText('Placeholder biography.') },
    );
    // Each article points at the author document in its own language.
    const articleCategory = await seedGeneralCategory('article_category');
    const authorIds = Object.fromEntries(
      await Promise.all(LOCALES.map(async (l) => [l, await idOf('author', 'sample-author', l)] as const)),
    );
    await seedGroup('article', 'hello-world', (l) => ({
      ...(l === 'el'
        ? { title: 'Πρώτο άρθρο', excerpt: 'Προσωρινό άρθρο.', body: richText('Προσωρινό κείμενο άρθρου.') }
        : { title: 'First article', excerpt: 'A placeholder article.', body: richText('Placeholder article body.') }),
      ...(authorIds[l] ? { author: authorIds[l] } : {}),
      ...inCategory(articleCategory),
    }));
  }
  if (SAMPLES.answer) {
    const answerCategory = await seedGeneralCategory('answer_category');
    await seedGroup('answer', 'sample-question', (l) => ({
      ...(l === 'el'
        ? { question: 'Δείγμα ερώτησης;', shortAnswer: 'Προσωρινή σύντομη απάντηση.', body: richText('Προσωρινή αναλυτική απάντηση.') }
        : { question: 'A sample question?', shortAnswer: 'A placeholder short answer.', body: richText('A placeholder full answer.') }),
      ...inCategory(answerCategory),
    }));
  }
  if (SAMPLES.scenario) {
    const scenarioCategory = await seedGeneralCategory('scenario_category');
    await seedGroup('scenario', 'sample-case-study', (l) => ({
      ...(l === 'el'
        ? { title: 'Δείγμα μελέτης', industry: 'Κλάδος', summary: 'Προσωρινή περίληψη.', body: richText('Προσωρινό κείμενο.') }
        : { title: 'Sample case study', industry: 'Industry', summary: 'A placeholder summary.', body: richText('Placeholder body.') }),
      ...inCategory(scenarioCategory),
    }));
  }
}

async function main(): Promise<void> {
  await seedSettings();
  await seedPages();
  await seedSamples();
  console.log(formatSeedSummary(`Site content (${publish ? 'published' : 'drafts'})`, counts, mode));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
