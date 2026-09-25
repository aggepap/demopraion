/**
 * Where a click on an in-site link should scroll to when it points at the page
 * the visitor is already on.
 *
 * Next's router only scrolls when a navigation changes the URL. A footer link
 * to the current page — "Pricing" while reading /pricing — is a navigation to
 * the same URL, so it does nothing visible: the reader clicked, and is still
 * looking at the footer. The browser would have jumped to the top (or to the
 * anchor) for a plain `<a>`; this restores that.
 *
 * Returns `null` for a link to another page, which the router already handles.
 *
 * Both arguments are locale-less paths — `href` as written in `nav.ts`,
 * `pathname` from next-intl's `usePathname()`.
 */
export type SamePageScrollTarget = { kind: 'top' } | { kind: 'anchor'; id: string };

export function samePageScrollTarget(href: string, pathname: string): SamePageScrollTarget | null {
  const hashAt = href.indexOf('#');
  const path = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt + 1);

  // Other origins, mailto: and tel: never reach this; anything that is not a
  // root-relative path is not ours to judge.
  if (!path.startsWith('/')) return null;
  if (normalise(path) !== normalise(pathname)) return null;

  if (hash === '' || hash === 'top') return { kind: 'top' };

  return { kind: 'anchor', id: decodeURIComponent(hash) };
}

/** `/pricing/` and `/pricing` are the same page; `/` stays `/`. */
function normalise(path: string): string {
  const withoutQuery = path.split('?')[0];
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery;
}
