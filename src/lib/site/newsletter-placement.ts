/**
 * Where the newsletter signup appears: a section of its own on the home page,
 * the footer band on every other page — one form per page.
 *
 * `pathname` is locale-free (next-intl's `usePathname`), so the home page is `/`
 * in every language.
 */
export function showFooterNewsletter(pathname: string): boolean {
  return pathname !== '/';
}
