'use client';

import Script from 'next/script';

import type { PublicSnippet } from '@/cms/core/scripts/schema';
import { useCategoryConsent } from '@/components/layout/CookieBanner';

import { snippetMayRun } from './snippet-consent';

/**
 * Runs one script snippet, once consent allows it.
 *
 * `next/script` rather than a bare `<script>`: React never executes a script
 * element it renders on the client, so a snippet on a page reached by client
 * navigation would silently do nothing. The `id` also dedupes — the same
 * snippet placed twice, or met again on the next page, runs once.
 *
 * Consent is read live (`useCategoryConsent` is a sync-external-store hook), so
 * accepting the category in the banner starts the snippet without a reload.
 */
export function SnippetRunner({ snippet }: { snippet: PublicSnippet }) {
  // Always called — hooks cannot be conditional. A null category reads a key no
  // catalogue has, and `snippetMayRun` ignores the answer.
  const granted = useCategoryConsent(snippet.consentCategory ?? '');
  if (!snippetMayRun(snippet.consentCategory, granted)) return null;

  const id = `snippet-${snippet.slug}`;
  const strategy = snippet.lazy ? 'lazyOnload' : 'afterInteractive';

  if (snippet.kind === 'external') {
    return snippet.src ? <Script id={id} src={snippet.src} strategy={strategy} /> : null;
  }
  return snippet.code ? (
    <Script id={id} strategy={strategy}>
      {snippet.code}
    </Script>
  ) : null;
}
