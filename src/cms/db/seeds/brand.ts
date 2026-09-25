import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { inArray } from 'drizzle-orm';

import { parseThemeColors, planBrandImport } from '../../core/brand/import';
import { BRAND_IDENTITY_KEY, BRAND_PALETTE_KEY, type BrandDefaults } from '../../core/brand/policy';
import { setSetting } from '../../core/settings';
import { checkStructuredSetting } from '../../core/settings/structured';
import { getDb, schema } from '..';

/**
 * Copy a site's brand from its files into `site_settings`, writing only keys that
 * are absent — see `core/brand/import.ts`. Reads the table directly rather than
 * through `getSetting`, whose cache only exists inside Next.
 *
 * Returns the keys it wrote; an empty list means the database already had both.
 */
export async function importBrand(opts: {
  brandFile: BrandDefaults;
  cwd?: string;
}): Promise<string[]> {
  const cssPath = join(opts.cwd ?? process.cwd(), 'src/app/globals.css');
  const css = await readFile(cssPath, 'utf8').catch(() => '');

  const rows = await getDb()
    .select({ key: schema.siteSettings.key, value: schema.siteSettings.value })
    .from(schema.siteSettings)
    .where(inArray(schema.siteSettings.key, [BRAND_IDENTITY_KEY, BRAND_PALETTE_KEY]));
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const plan = planBrandImport({
    storedIdentity: stored.get(BRAND_IDENTITY_KEY) ?? null,
    storedPalette: stored.get(BRAND_PALETTE_KEY) ?? null,
    brandFile: opts.brandFile,
    themeColors: parseThemeColors(css),
  });

  const written: string[] = [];
  for (const [key, value] of [
    [BRAND_IDENTITY_KEY, plan.identity],
    [BRAND_PALETTE_KEY, plan.palette],
  ] as const) {
    if (value === undefined) continue;
    // The same check an admin save goes through, so an import can never store
    // what the Branding screen would refuse (a malformed email in the file, say).
    const checked = checkStructuredSetting(key, value);
    if (!checked?.ok) throw new Error(`${key}: ${checked?.message ?? 'not a structured setting'}`);
    await setSetting(key, checked.value);
    written.push(key);
  }
  return written;
}
