import { validateMdxSource } from '@/cms/core/fields/mdx-validate';
import { MDX_ALLOWED_COMPONENTS } from '@/lib/cms/mdx-allowlist';

/** Why a body cannot be previewed, or `null` when it is safe to render. */
export type MdxPreviewRefusal = { status: 'empty' } | { status: 'invalid'; messages: string[] };

/**
 * Decide whether a body may be rendered into the admin's preview pane.
 *
 * Split out of `mdx-preview.tsx` purely so it can be tested. That module
 * imports `MdxRuntime`, which statically imports `@mdx-js/mdx`, whose
 * `estree-walker` dependency is import-only — so under `tsx` (which compiles to
 * CJS) merely importing it throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. The same
 * trap `mdx-validate.ts` documents, met from the other side. Keeping the
 * security-relevant half free of that import is what lets
 * `test/cms/mdx-preview-classify.test.ts` exist at all.
 *
 * The allow-list is read here rather than accepted as an argument: the caller
 * is a Server Action, and the list gating what gets compiled and *run* in the
 * server process must not be something a browser can widen.
 */
export async function classifyMdxSource(source: string): Promise<MdxPreviewRefusal | null> {
  if (source.trim() === '') return { status: 'empty' };
  const violations = await validateMdxSource(source, MDX_ALLOWED_COMPONENTS);
  return violations.length > 0 ? { status: 'invalid', messages: violations } : null;
}
