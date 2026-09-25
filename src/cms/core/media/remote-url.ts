/**
 * Whether a URL from a third-party API response may be fetched by the server.
 *
 * The URL is untrusted — it arrived in someone else's JSON — so this is an
 * allowlist, not a blocklist: HTTPS, the default port, no credentials, and a
 * host the caller named. A `*.` entry matches subdomains only, on a dot
 * boundary, so `*.googleusercontent.com` does not match
 * `evilgoogleusercontent.com` or `googleusercontent.com.evil.test`.
 *
 * IP literals and `localhost` are refused outright, even if someone lists
 * them: a server-side fetch to an internal address is the whole of SSRF.
 */

export type RemoteUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

function hostAllowed(host: string, allowHosts: readonly string[]): boolean {
  return allowHosts.some((entry) => {
    const pattern = entry.toLowerCase();
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".googleusercontent.com"
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === pattern;
  });
}

function isIpLiteral(host: string): boolean {
  return host.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || /^\d+$/.test(host);
}

export function checkRemoteImageUrl(raw: string, allowHosts: readonly string[]): RemoteUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not https' };
  if (url.port !== '') return { ok: false, reason: 'non-default port' };
  if (url.username || url.password) return { ok: false, reason: 'credentials in URL' };
  const host = url.hostname.toLowerCase();
  if (isIpLiteral(host) || host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, reason: 'internal host' };
  }
  if (!hostAllowed(host, allowHosts)) return { ok: false, reason: 'host not allowed' };
  return { ok: true, url };
}
