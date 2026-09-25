import { evaluate, type EvaluateOptions } from '@mdx-js/mdx';
import * as jsxRuntime from 'react/jsx-runtime';

import { mdxGuardPlugin } from '@/cms/core/fields/mdx-guard';
import { MDX_ALLOWED_COMPONENTS } from '@/lib/cms/mdx-allowlist';
// `useMDXComponents` is a plain function returning the component map (not a
// React hook despite the MDX naming convention). Alias it so the hooks lint
// rule doesn't misfire, and so we can call it outside a component.
import { useMDXComponents as getMdxComponents } from '@/mdx-components';

const guard = mdxGuardPlugin(MDX_ALLOWED_COMPONENTS);

/**
 * Render an MDX **source string** (as stored in a CMS document's `bodyMdx`
 * field) at request time, using the site's existing MDX component map — so
 * DB-authored bodies render identically to the build-time `.mdx` file imports,
 * custom components (`<QuickAnswer>`, `<Pillars>`, …) included.
 *
 * SITE code: it wires the site's component map to the core's stored MDX. The
 * CMS core stays presentation-agnostic.
 *
 * ## The guard is not optional here
 *
 * `evaluate()` compiles and **runs** the source in this process, so a body is
 * server-side JavaScript with the server's scope — `{process.env.AUTH_SECRET}`
 * renders the signing secret. `mdxGuardPlugin` runs inside that same compile,
 * before any of it executes, which is what makes this the load-bearing copy of
 * the check: the write path also validates, but only this protects rows already
 * in the database and anything the PM bridge pushes. See
 * `src/cms/core/fields/mdx-guard.ts`.
 *
 * A refused body renders as nothing rather than throwing. The page keeps its
 * header, TOC, FAQ and structured data — the same best-effort stance the read
 * layer takes when the database is unreachable (`src/cms/core/read/`), and for
 * the same reason: one bad row must not take a live page down. `label`
 * identifies the document in the log, since a body with no `<h1>` is otherwise
 * very hard to place.
 */
export async function MdxRuntime({
  source,
  label,
}: {
  source: string;
  /** Document slug or id, for the log line when a body is refused. */
  label?: string;
}) {
  if (!source || source.trim() === '') return null;

  const components = getMdxComponents({});

  // Only the compile is inside the try. Returning the element from in here would
  // catch nothing extra anyway — React renders it after this function returns —
  // and it is the compile that the guard makes throw.
  let MDXContent: Awaited<ReturnType<typeof evaluate>>['default'];
  try {
    ({ default: MDXContent } = await evaluate(source, {
      // Spread as a typed object rather than `as object`: with `remarkPlugins`
      // alongside it, erasing the runtime's type left `Fragment` missing from
      // the literal and the cast stopped being assignable.
      ...(jsxRuntime as unknown as Pick<EvaluateOptions, 'Fragment' | 'jsx' | 'jsxs'>),
      // MDX types this as taking no arguments; the site's map takes an (unused)
      // components argument. Cast the one property rather than the whole options
      // object, so `remarkPlugins` — the security-relevant part — stays checked.
      useMDXComponents: getMdxComponents as unknown as EvaluateOptions['useMDXComponents'],
      remarkPlugins: [guard],
    }));
  } catch (err) {
    console.error('[cms/mdx] body refused', { label, err });
    return null;
  }

  return <MDXContent components={components} />;
}
