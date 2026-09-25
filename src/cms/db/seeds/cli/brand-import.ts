/**
 * Move this site's brand into the database. `npm run db:brand-import`
 *
 * Copies `src/site.brand.ts` (via the site config) and the `@theme` colours of
 * `src/app/globals.css` into `brand.identity` / `brand.palette`, once. A key that
 * already exists is left alone, so it is safe to re-run and never reverts an edit
 * made in Admin → Settings → Branding.
 */
import '../../adapters/mysql/load-env';

import config from '@/site.config';

import { importBrand } from '../brand';

async function main(): Promise<void> {
  const written = await importBrand({ brandFile: config.brand });
  console.log(
    written.length
      ? `Brand imported: ${written.join(', ')}.`
      : 'Brand already in the database — nothing to import. Edit it in Admin → Settings → Branding.'
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
