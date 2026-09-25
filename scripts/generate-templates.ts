/**
 * Write the checked-in copies of the import templates under `docs/templates/`.
 *
 * `buildImportTemplate()` is the source of truth — these files are snapshots of
 * it, so an author can read one without logging in and a reviewer can see in a
 * diff what changing a field did to the authoring instructions.
 * `test/cms/import-template.test.ts` fails when the two drift.
 *
 * Note `.gitignore` excludes `*.md`, so these need `git add -f`. That is also
 * why they never reach production: the deploy workflow strips `*.md`, and an
 * authoring aid has no business being served.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import config from '@/site.config';
import { buildImportTemplate, mdxBodyField, withShippedSeoGroup } from '@/cms/core/import';

const OUT_DIR = join(process.cwd(), 'docs', 'templates');

/** Every collection a markdown file can describe: the ones with an MDX body. */
export function templatedCollections(): string[] {
  return config.collections.filter((c) => mdxBodyField(c.fields) !== null).map((c) => c.key);
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const key of templatedCollections()) {
    const collection = config.collectionByKey.get(key);
    if (!collection) continue;
    // `withShippedSeoGroup` so the snapshot carries the same `seo:` block the
    // admin's download does — see its own comment for why the overrides are not
    // read from the database here.
    const text = buildImportTemplate(withShippedSeoGroup(collection), {
      locales: config.locales,
      defaultLocale: config.defaultLocale,
    });
    const path = join(OUT_DIR, `${key}.template.md`);
    writeFileSync(path, text, 'utf8');
    console.log(`wrote ${path}`);
  }
}

main();
