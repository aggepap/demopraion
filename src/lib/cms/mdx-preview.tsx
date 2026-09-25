import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import type { MdxPreviewResult } from '@/cms/admin';
import { MdxRuntime } from '@/components/cms/MdxRuntime';
import { classifyMdxSource } from '@/lib/cms/mdx-preview-classify';

/**
 * Render an unsaved body for the admin's live preview pane.
 *
 * SITE code, and the only place the CMS core's editor meets the site's MDX
 * renderer — the same seam `MdxRuntime` is for the read path. The core cannot
 * import any of this (`src/cms/**` may not reach `@/components` or `@/lib`), so
 * the admin receives it as a Server Action prop typed only as
 * `RenderMdxPreview`.
 *
 * ## Why this reuses `MdxRuntime` rather than calling `evaluate` itself
 *
 * `MdxRuntime` *is* the renderer, guard plugin and component map included. A
 * second copy would drift, and a preview that disagrees with the page is worse
 * than no preview — it teaches an editor to distrust what they see. Same
 * argument `src/cms/admin/advisories.ts` makes for running the real pricing
 * engine in the browser instead of approximating it.
 */
export async function renderMdxPreview(source: string, locale: string): Promise<MdxPreviewResult> {
  /*
   * Locale for the `<Link>`s inside the preview.
   *
   * Both halves are needed, and finding that out cost a runtime error worth
   * recording: an internal markdown link renders through next-intl's `Link`
   * (`src/mdx-components.tsx`), and that resolves to the **client** navigation
   * component here — so without a provider it throws outright, "No intl context
   * found", and the whole pane dies. The admin tree sits outside `[locale]` and
   * has no `NextIntlClientProvider` of its own, so the preview brings one.
   *
   * `setRequestLocale` covers the server side of the same problem: the admin
   * carries no `X-NEXT-INTL-LOCALE` header, so `src/lib/i18n/request.ts` would
   * fall back to `defaultLocale` and the EN tab would preview every link as
   * `/pricing` instead of `/en/pricing` — silently, which is worse than the
   * throw.
   *
   * `messages` is deliberately empty: nothing in the allow-listed component set
   * calls `useTranslations`, and shipping the site's whole message catalogue
   * into the admin bundle for a preview would be waste.
   */
  setRequestLocale(locale);

  // Empty or unsafe bodies never reach `MdxRuntime`. `classifyMdxSource` runs
  // the same guard the renderer would, so a refusal arrives as a list of
  // messages the author can act on rather than as a silently blank pane.
  const refusal = await classifyMdxSource(source);
  if (refusal) return refusal;

  return {
    status: 'ok',
    node: (
      <NextIntlClientProvider locale={locale} messages={{}}>
        {/* Mirrors the real article body wrapper so the preview inherits the
            same measure and background —
            `src/app/[locale]/insights/[article]/page.tsx`. The admin already
            loads `globals.css` and both brand fonts, so nothing else is needed
            to make this look like the page. */}
        <div className="bg-soft-pearl">
          <article className="min-w-0 max-w-3xl px-6 py-8">
            <MdxRuntime source={source} label={`preview:${locale}`} />
          </article>
        </div>
      </NextIntlClientProvider>
    ),
  };
}
