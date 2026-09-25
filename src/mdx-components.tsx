import type { MDXComponents } from 'mdx/types';
import type { ReactNode } from 'react';

/**
 * Components available inside CMS-authored MDX. Every capitalised key here must
 * also be listed in src/lib/cms/mdx-allowlist.ts — the core's MDX guard refuses
 * anything else, and test/components/mdx-allowlist.test.tsx compares the two.
 */
function Callout({ children }: { children?: ReactNode }) {
  return (
    <aside className="my-6 rounded-sm border-l-4 border-midnight-navy bg-bone-cream px-5 py-4 text-text-primary">
      {children}
    </aside>
  );
}

const components: MDXComponents = { Callout };

export function useMDXComponents(overrides: MDXComponents): MDXComponents {
  return { ...components, ...overrides };
}
