/**
 * Moving a site's brand out of its files and into the database — once.
 *
 * Sites built before Settings → Branding existed keep their brand in
 * `src/site.brand.ts` and their colours in the `@theme` block of `globals.css`.
 * The import copies both into `site_settings` so the admin opens on what the site
 * actually looks like, and writes a key only when it is absent: running it again,
 * or after an owner has edited the brand, changes nothing.
 */
import {
  BASE_PALETTE,
  parseBrandIdentity,
  type BrandDefaults,
  type BrandIdentity,
  type Palette,
} from './policy';

/** The `--color-<token>` values of the `@theme` block, for known tokens only. */
export function parseThemeColors(css: string): Partial<Palette> {
  const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];
  if (!block) return {};
  const known = new Set(Object.keys(BASE_PALETTE));
  const out: Record<string, string> = {};
  for (const [, token, value] of block.matchAll(/--color-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (known.has(token)) out[token] = value.toLowerCase();
  }
  return out as Partial<Palette>;
}

export interface BrandImportInput {
  storedIdentity: unknown;
  storedPalette: unknown;
  brandFile: BrandDefaults;
  themeColors: Partial<Palette>;
}

/** What to write. A key left undefined is already in the database. */
export interface BrandImportPlan {
  identity?: BrandIdentity;
  palette?: Palette;
}

export function planBrandImport(input: BrandImportInput): BrandImportPlan {
  const plan: BrandImportPlan = {};
  if (input.storedIdentity == null) plan.identity = parseBrandIdentity(null, input.brandFile);
  if (input.storedPalette == null) plan.palette = { ...BASE_PALETTE, ...input.themeColors };
  return plan;
}
