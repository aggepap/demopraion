/**
 * Validate the post-login `?next=` redirect target.
 *
 * The param has a legitimate producer — `requireAuth` (modules/auth/guards.ts)
 * emits `?next=<current admin path>` so a deep link survives the sign-in bounce
 * — but it arrives from the URL, i.e. from whoever sent the victim the link.
 * Handing it straight to `router.push()` turns the admin login into an open
 * redirect: `?next=https://evil.tld` (or the protocol-relative `//evil.tld`,
 * which a browser resolves as an absolute URL) lands a freshly-authenticated
 * admin on an attacker's page, which is exactly the moment a credential-replay
 * phish is most convincing.
 *
 * Nothing outside the admin is ever a legitimate destination here, so this is an
 * allowlist rather than a denylist: the value must be the admin root or a path
 * beneath it. Anything else falls back to the admin root rather than erroring —
 * a mangled `next` should not block a valid sign-in.
 */
export function safeNextPath(raw: string | null | undefined, adminPath: string): string {
  const root = `/${adminPath.replace(/^\/+|\/+$/g, '')}`;
  if (!raw) return root;

  // Reject anything a browser could read as an authority component. Backslashes
  // are normalised to `/` by browsers, so `/\evil.tld` is protocol-relative too.
  if (raw.includes('\\') || raw.includes('://')) return root;
  if (!raw.startsWith('/') || raw.startsWith('//')) return root;

  // `startsWith(root)` alone would accept `/adminEVIL` and `/admin@evil.tld`;
  // require the root exactly, or the root followed by a boundary character.
  if (!raw.startsWith(root)) return root;
  const rest = raw.slice(root.length);
  if (rest !== '' && !/^[/?#]/.test(rest)) return root;

  return raw;
}
