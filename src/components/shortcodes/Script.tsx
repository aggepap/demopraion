import { publicSnippet } from '@/cms/core/scripts/schema';
import { getEnabledSnippetBySlug } from '@/cms/core/scripts/service';

import { ScriptSnippetView } from './ScriptSnippetView';

/**
 * `[script name="<slug>"]` — the snippet saved under that slug on the Scripts
 * screen, or nothing: an unknown or switched-off snippet renders silently empty,
 * like every other shortcode that cannot render.
 */
export async function Script(props: Record<string, unknown>) {
  const slug = typeof props.name === 'string' ? props.name : '';
  if (!slug) return null;
  const snippet = await getEnabledSnippetBySlug(slug);
  if (!snippet) return null;
  // Only what the browser needs crosses to the client component — never the notes.
  return <ScriptSnippetView snippet={publicSnippet(snippet)} />;
}
