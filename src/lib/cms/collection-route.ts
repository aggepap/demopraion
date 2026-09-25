import { notFound, redirect } from 'next/navigation';

import { collectionAliasKey, type ResolvedCollection } from '@/cms/config';
import { getAdminPath } from '@/cms/core';
import config from '@/site.config';

/**
 * The collection a `/admin/<segment>/…` URL is asking for.
 *
 * The URL segment is the collection *key*, which is singular, while the admin
 * shows the plural label — the sidebar, the dashboard card and the page heading
 * all say "Pages" for the collection keyed `page`. Anyone who typed or
 * half-remembered the URL from what they had read landed on `/admin/pages` and
 * got a bare 404, with nothing to suggest the right address. A UX audit lost a
 * whole pass to it: the document editor was never reviewed, because the URL it
 * was asked to open did not exist.
 *
 * So a segment that is not a key, but unambiguously names one, redirects to the
 * canonical URL rather than 404ing (see `collectionKeyByAlias`). It is a
 * redirect, not an alias that renders in place, so there is still exactly one
 * URL per screen — bookmarks, history and `toHaveURL` assertions all keep
 * meaning one thing.
 *
 * `suffix` is whatever follows the collection in the path (`/new`, `/123`), so
 * the redirect lands on the same screen the user asked for.
 */
export function resolveAdminCollection(segment: string, suffix = ''): ResolvedCollection {
  const collection = config.collectionByKey.get(segment);
  if (collection) return collection;

  // Normalised the same way the aliases were built, so a capitalised or
  // punctuated spelling of a label resolves too. Decoded first so a non-ASCII
  // label can match at all — a browser percent-encodes it on the way out.
  // `decodeURIComponent` throws on a malformed escape rather than returning
  // its input, and a malformed URL segment is a 404, not a crash.
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Leave it as-is; it will not match an alias, and 404 is the right answer.
  }

  const canonical = config.collectionKeyByAlias.get(collectionAliasKey(decoded));
  if (canonical) redirect(`/${getAdminPath()}/${canonical}${suffix}`);

  notFound();
}
