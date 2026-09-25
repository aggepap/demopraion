import type { PublicSnippet } from '@/cms/core/scripts/schema';

import { SnippetRunner } from './SnippetRunner';

/**
 * What a `[script name="…"]` leaves in the page: an empty anchor where it was
 * placed, for a widget that mounts into the page
 * (`document.querySelector('[data-script-snippet="chat-widget"]')`), and the
 * runner that injects the script itself.
 */
export function ScriptSnippetView({ snippet }: { snippet: PublicSnippet }) {
  return (
    <>
      <div data-script-snippet={snippet.slug} />
      <SnippetRunner snippet={snippet} />
    </>
  );
}
