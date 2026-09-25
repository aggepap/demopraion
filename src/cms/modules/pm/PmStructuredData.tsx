import { getHeadPayload } from '../../core/seo/resolve';
import { safeJsonLd } from './jsonld';

/**
 * The page's structured data, with Product Manager's compiled graph folded in.
 *
 * ## Why the site's own graph arrives as a prop
 *
 * The ESLint boundary forbids `src/cms/**` from importing `@/lib/*`, so this
 * component cannot reach the site's `lib/seo/schemas`. That is the right shape
 * anyway: the core has no business knowing what graph a particular site builds,
 * and passing it in keeps this component reusable by any site that clones the
 * core.
 *
 * ## Precedence
 *
 * `seo_override = true` **replaces** the page's own graph — the operator has
 * said PM's version is the one to publish. `false` emits PM's graph *alongside*
 * it as a second `<script>`, which is what search engines expect when a page
 * carries several independent nodes. No payload at all renders the fallback
 * alone, so a site with the bridge switched off behaves exactly as before.
 */
export async function PmStructuredData({
  path,
  locale,
  fallbackJson,
}: {
  path: string;
  locale: string;
  /**
   * The site's own graph for this page, **already serialised** — the templates
   * build it with `documentGraph()`, which escapes `<` on the way out. Taking
   * the string rather than the object keeps each template's edit to one line and
   * leaves the site's own escaping in charge of the site's own data.
   */
  fallbackJson: string | null;
}): Promise<React.JSX.Element | null> {
  const payload = await getHeadPayload(path, locale);

  // An override means the operator approved PM's graph as the one to publish,
  // so the generated one is dropped rather than duplicated.
  const keepFallback = !payload?.seoOverride;
  const pmJson =
    payload?.jsonld === null || payload?.jsonld === undefined ? null : safeJsonLd(payload.jsonld);

  if (!pmJson && (!keepFallback || !fallbackJson)) return null;

  return (
    <>
      {keepFallback && fallbackJson ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: fallbackJson }} />
      ) : null}
      {pmJson ? (
        // `safeJsonLd` is what makes this safe: a `</script` inside any string
        // value would otherwise close the element early and execute as markup.
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: pmJson }} />
      ) : null}
    </>
  );
}
