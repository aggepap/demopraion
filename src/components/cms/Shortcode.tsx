import { Suspense, type ReactNode } from 'react';

import { SHORTCODES, resolveShortcode, type ParsedShortcode } from '@/cms/core/shortcodes';
import { resolveModuleFlags } from '@/cms/core';
import config from '@/site.config';

import { SHORTCODE_COMPONENTS } from '@/shortcodes';

/**
 * Renders one shortcode found in a page body — or, deliberately, nothing.
 *
 * Four ways to render nothing, and all of them are silent on the public site:
 * the name is unknown, its module is switched off, its attributes do not
 * validate, or the site has no component for it. A half-rendered block or an
 * error box would put the CMS's own problem on the customer's screen.
 *
 * Attributes reach a component ONLY after `resolveShortcode` has validated them
 * against the declared shape, so nothing an editor typed is handed to a
 * component unchecked.
 */
export async function Shortcode({ parsed }: { parsed: ParsedShortcode }): Promise<ReactNode> {
  const flags = await resolveModuleFlags(config);
  const resolution = resolveShortcode(SHORTCODES, parsed, flags);
  if (resolution.kind !== 'ok') return null;

  const Component = SHORTCODE_COMPONENTS[parsed.name];
  if (!Component) return null;

  return (
    // Its own boundary: a shortcode that fetches (reviews, brands) must not
    // hold up the rest of the page it was dropped into.
    <Suspense fallback={null}>
      <Component {...resolution.attrs} />
    </Suspense>
  );
}
