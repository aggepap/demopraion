/**
 * Same-origin belt for the public form endpoints (`/api/contact`).
 *
 * These endpoints have no session, so this is not classic CSRF — but no site
 * other than ours legitimately POSTs to them, and browsers attach `Origin` to
 * cross-site POSTs. Refusing a foreign one cuts off browser-driven spam.
 *
 * The allowed origins are the site's own URL and its `www`/apex twin, derived
 * from `siteUrl` rather than written out: a literal list is what made every
 * other site built from this code refuse its own contact form in production.
 *
 * - Not enforced outside production, so local dev (a localhost origin) works.
 * - A missing `Origin` means a non-browser client; there is nothing to compare.
 * - A malformed origin or site URL is refused, never waved through.
 */
export function isAllowedPublicOrigin(
  origin: string | null,
  siteUrl: string,
  isProduction: boolean,
): boolean {
  if (!isProduction || !origin) return true;

  let site: URL;
  let from: URL;
  try {
    site = new URL(siteUrl);
    from = new URL(origin);
  } catch {
    return false;
  }

  if (from.protocol !== site.protocol || from.port !== site.port) return false;
  const apex = site.hostname.replace(/^www\./, '');
  return from.hostname === apex || from.hostname === `www.${apex}`;
}
