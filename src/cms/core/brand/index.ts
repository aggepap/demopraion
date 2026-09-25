import 'server-only';

import { cache } from 'react';

import { applyEmailBrand, type EmailBrand } from '../email/brand';
import { siteOrigin } from '../paths';
import { getSetting } from '../settings';
import {
  BRAND_IDENTITY_KEY,
  BRAND_PALETTE_KEY,
  paletteCss,
  parseBrandIdentity,
  parsePalette,
  resolveBrand,
  type BrandDefaults,
  type SiteBrand,
} from './policy';

/**
 * The brand read layer. Both keys go through `getSetting`, so they share its
 * cache and its `cms:settings` tag — a save in Settings → Branding is live on the
 * next request — and its failure mode: an unreachable database reads as nothing
 * stored, which falls back to `defaults` rather than taking the page down.
 */

export * from './policy';

/**
 * The site's brand. Pass `config.brand` so a database that has never been
 * branded still shows the code defaults; without it, nothing stored reads as an
 * unnamed site.
 */
export const getBrand = cache(async (defaults?: BrandDefaults): Promise<SiteBrand> => {
  const [identity, palette] = await Promise.all([
    getSetting(BRAND_IDENTITY_KEY),
    getSetting(BRAND_PALETTE_KEY),
  ]);
  return resolveBrand(parseBrandIdentity(identity, defaults), parsePalette(palette));
});

/** The saved colours as a `:root` rule — empty when none are saved. */
export async function getPaletteCss(): Promise<string> {
  return paletteCss(await getSetting(BRAND_PALETTE_KEY));
}

/** What email needs: the name, the palette, and the logo as an absolute URL. */
export async function getEmailBrand(): Promise<EmailBrand> {
  const brand = await getBrand();
  const origin = siteOrigin();
  return {
    name: brand.name,
    // A relative URL is useless in a mail client, so no origin means no logo.
    logoUrl: brand.logoUrl && origin ? `${origin}${brand.logoUrl}` : null,
    palette: brand.palette,
  };
}

/** Brand an email body. Never fails a send over branding — plain beats undelivered. */
export async function brandEmailHtml(html: string): Promise<string> {
  try {
    return applyEmailBrand(html, await getEmailBrand());
  } catch (err) {
    console.error('[cms/brand] could not brand an email', err);
    return applyEmailBrand(html, { name: '', logoUrl: null, palette: parsePalette(null) });
  }
}
