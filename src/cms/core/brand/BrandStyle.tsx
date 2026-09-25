import { getPaletteCss } from '.';

/**
 * The saved brand colours, as CSS variables that override the stylesheet's
 * `@theme` values. Tailwind emits those inside `@layer theme`; this rule is
 * unlayered, so it wins without `!important` — and without a rebuild.
 *
 * Every value has passed the `#rrggbb` check (see `paletteCss`), so nothing
 * stored can close the element.
 */
export async function BrandStyle() {
  const css = await getPaletteCss();
  if (!css) return null;
  return <style id="brand-palette" dangerouslySetInnerHTML={{ __html: css }} />;
}
