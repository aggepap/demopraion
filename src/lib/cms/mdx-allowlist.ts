/**
 * The components a CMS-authored MDX body may use — the allow-list the core's
 * MDX guard enforces (bodies are compiled and executed server-side).
 *
 * Strings only, because `site.config.ts` and `src/cms/**` both need it and
 * neither may import React components. Must match the component map in
 * `src/mdx-components.tsx` exactly (test/components/mdx-allowlist.test.tsx).
 *
 * This site's collections use rich text, not MDX; the list is kept for the
 * admin's MDX preview and for any MDX field added later.
 */
export const MDX_ALLOWED_COMPONENTS = ['Callout'] as const;
