import createMDX from '@next/mdx';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

/**
 * MDX wrap: lets us author Insights + Cases content as `.mdx` files. No
 * remark/rehype plugins configured here — auto-generated heading IDs are
 * produced client-side in `src/mdx-components.tsx` via `github-slugger`
 * (the same library `rehype-slug` wraps), so the IDs stay identical
 * without needing function plugin references that Turbopack's dev loader
 * can't serialise.
 */
const withMDX = createMDX({});

/**
 * Deployment target: self-hosted Node (VPS) behind Nginx + PM2 + Cloudflare.
 * Run with `npm run build && npm run start` — no Vercel-specific features used.
 *
 * `images.formats` AVIF/WebP requires `sharp` (listed as a top-level dep);
 * Next 13+ delegates image optimisation to sharp on non-Vercel runtimes.
 *
 * If a smaller deploy footprint is ever needed, uncomment `output: 'standalone'`
 * and run `node .next/standalone/server.js` instead of `npm run start`.
 */
/**
 * App-layer security headers. Nginx handles the rest in production
 * (HSTS, the bulk of CSP), but mirroring the basics in `next.config.ts`
 * keeps dev + preview + any non-Nginx environment protected and gives
 * Next a single source of truth for headers it controls regardless of
 * the reverse proxy in front of it.
 */
/**
 * Content-Security-Policy at the app layer.
 *
 * Nginx in production layers its own (and HSTS) on top; this app-layer
 * policy is the floor that protects dev + preview + any non-Nginx env.
 * The chosen ruleset is the strictest that still allows:
 *   - inline JSON-LD via `dangerouslySetInnerHTML` (every content page
 *     emits a @graph block — using nonces would require server-side
 *     wiring on every route, which is not worth the migration cost
 *     when `script-src 'unsafe-inline'` already blocks every external
 *     untrusted host)
 *   - Tailwind's inline `style` attributes on a handful of arbitrary
 *     values (`style-src 'unsafe-inline'`)
 *   - Google Tag Manager / GA4 when (and only when) the cookie banner
 *     has enabled it — both the script src and the analytics endpoints
 *     are whitelisted, but the loader gates them behind consent in
 *     `AnalyticsLoader.tsx`, so a non-consenting visitor never triggers
 *     either domain
 *   - SVG logos + dynamic OG image routes via `/_next/image` (same-origin)
 *   - data: URIs for fonts the Next bundler may inline and for any
 *     small data-URL images
 *
 * `frame-ancestors 'none'` mirrors X-Frame-Options DENY (the modern
 * browser-preferred way to express the same constraint).
 *
 * If you add a third-party script (Plausible, Vercel Analytics, etc.)
 * you must whitelist it here AND in `connect-src` for its beacon
 * endpoint, otherwise the loader will silently fail CSP.
 */
/**
 * `'unsafe-eval'` is React's dev-mode requirement (source-map
 * reconstruction, error-overlay callstacks across worker boundaries,
 * Turbopack HMR). React never uses `eval()` in production builds, so
 * production CSP omits it. Without this branch, `npm run dev` throws
 * "eval() is not supported in this environment" the moment React tries
 * to surface an error in the browser overlay.
 */
/**
 * Production-only Content-Security-Policy.
 *
 * Dev CSP was breaking the Turbopack HMR socket + RSC streaming flow
 * — combinations of `upgrade-insecure-requests` (silently upgrades
 * http://localhost to https://localhost, which doesn't exist),
 * `'unsafe-eval'` exemptions for source-map reconstruction, and ws:
 * allowances for the HMR socket each interacted with Next 16 dev mode
 * in ways that left `Failed to fetch RSC payload ... Falling back to
 * browser navigation` errors on every client-side route change.
 *
 * The CSP exists to protect *production*. Dev parity is a nice-to-have
 * but not worth a broken developer workflow. Production still gets the
 * full strict policy below; dev runs with no CSP header at all (the
 * other security headers — X-Frame-Options, Referrer-Policy, etc. —
 * still ship in both environments since they don't have this hazard).
 */
const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * reCAPTCHA v2 loads its script from www.google.com + www.gstatic.com, embeds
 * a challenge iframe from www.google.com, and posts the answer back there.
 * Only the admin tree needs any of it, so only the admin tree gets it.
 */
const RECAPTCHA_SCRIPT_HOSTS = 'https://www.google.com https://www.gstatic.com';

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  // Images: same-origin assets (logos, favicons, OG images, founder
  // photo, dynamic /opengraph-image route) + inline `data:` URIs that
  // the bundler may emit for small inline assets + GA4 tracking pixel
  // hosts when consent has loaded analytics. Previously this allowed
  // any HTTPS origin via the `https:` wildcard, which made the
  // policy effectively unable to constrain image-based exfiltration
  // if an XSS ever landed; tightened to the exact GA4 hosts in use.
  "img-src 'self' data: https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com",
  "font-src 'self' data:",
  "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

/**
 * The admin's CSP: the site policy plus exactly the three reCAPTCHA
 * allowances, and a `frame-src` (the site policy has none, so the challenge
 * iframe would otherwise fall through to `default-src 'self'` and be blocked).
 */
const ADMIN_CSP = PRODUCTION_CSP.split('; ')
  .map((directive) => {
    if (directive.startsWith('script-src ')) return `${directive} ${RECAPTCHA_SCRIPT_HOSTS}`;
    if (directive.startsWith('connect-src ')) return `${directive} https://www.google.com`;
    return directive;
  })
  .concat("frame-src 'self' https://www.google.com")
  .join('; ');

const baseSecurityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  /**
   * Cross-origin isolation.
   *
   * COOP severs this page's window-group ties to any cross-origin document
   * that opened it or that it opens. The site has no OAuth or payment popups
   * that would need `window.opener`, so `same-origin` costs nothing here.
   *
   * COEP is `credentialless` rather than `require-corp` deliberately.
   * `require-corp` BLOCKS any cross-origin subresource that does not send a
   * CORP header; `credentialless` instead fetches it without credentials.
   * Both yield a cross-origin-isolated context, but the strict form would
   * silently break GA4 — and only for visitors who accepted cookies, since
   * gtag is consent-gated, which is precisely the group that would go
   * unnoticed in a manual check. Switch this one word to 'require-corp' only
   * after verifying every third party in use sends CORP.
   */
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
  /**
   * CORP stops other sites hotlinking our assets — a foreign page embedding
   * `praion.gr/logos/…` now gets a broken image instead of our bandwidth.
   * Social link previews are unaffected: Facebook and LinkedIn fetch og:image
   * server-side, and CORP is only enforced by browsers.
   *
   * `same-site`, NOT `same-origin`: praion.gr and www.praion.gr both serve the
   * site directly (neither redirects to the other), and those count as
   * different ORIGINS. `same-origin` would therefore break assets for anyone
   * who landed on the www host. `same-site` covers both while still blocking
   * every third-party domain, which is the actual goal.
   */
  { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
  {
    key: 'Permissions-Policy',
    value: 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const securityHeaders = IS_DEV
  ? baseSecurityHeaders
  : [...baseSecurityHeaders, { key: 'Content-Security-Policy', value: PRODUCTION_CSP }];

/**
 * The admin URL segment, mirroring `getAdminPath()` in `src/cms/core/paths.ts`
 * — INCLUDING its slug rule. Duplicated rather than imported: this file is
 * loaded before the `@/*` path alias exists, so importing the real one fails at
 * config load. The two must agree, or the admin renders at one path while the
 * headers below protect another.
 *
 * The rule exists because this value is interpolated into a path-to-regexp
 * `source`: a segment carrying `:`, `(`, `*`, a space or a further slash either
 * breaks the pattern or matches something that is not the admin, and does it
 * silently. Anything that is not a plain slug falls back to the default, which
 * is what `getAdminPath()` will independently have resolved to as well.
 */
const ADMIN_SEGMENT = (() => {
  const raw = process.env.ADMIN_PATH?.trim().replace(/^\/+|\/+$/g, '');
  return raw && /^[A-Za-z0-9_-]+$/.test(raw) ? raw : 'admin';
})();

/**
 * The admin gets the same hardening as the site, MINUS `Cross-Origin-Embedder-
 * Policy`.
 *
 * COEP — in `credentialless` mode just as in `require-corp` — requires a
 * cross-origin IFRAME to opt in by sending COEP of its own, or to carry the
 * `credentialless` attribute. reCAPTCHA's challenge frames do neither, and the
 * widget is created by Google's script so we cannot add the attribute. With
 * COEP on, the checkbox renders and then silently refuses to open its
 * challenge, which locks the only door into the CMS.
 *
 * Nothing here needs cross-origin isolation (no SharedArrayBuffer, no
 * high-resolution timers), so dropping it on this subtree costs nothing. COOP,
 * CORP and the rest still apply.
 */
const adminSecurityHeaders = [
  ...baseSecurityHeaders.map((h) =>
    // Explicitly `unsafe-none`, not merely omitted: the site-wide rule above
    // has already set this header, and a later rule only overrides a key it
    // actually names. `unsafe-none` is COEP's own default — the value the
    // header carries when nobody sends it.
    h.key === 'Cross-Origin-Embedder-Policy' ? { key: h.key, value: 'unsafe-none' } : h
  ),
  ...(IS_DEV ? [] : [{ key: 'Content-Security-Policy', value: ADMIN_CSP }]),
];

/**
 * Build directory, overridable per instance.
 *
 * Two dev servers run from this one checkout: the human's on :3002 against
 * `praion_v2`, and the agents' on :3003 against `praion_qa` (see `dev:qa`).
 * Next 16 keeps a dev lock inside the build directory and refuses to start a
 * second server that would share it — so the QA instance gets its own
 * `.next-qa`. Both are gitignored; nothing else reads this.
 */
const DIST_DIR = process.env.NEXT_DIST_DIR ?? '.next';

const nextConfig: NextConfig = {
  /**
   * Next 16.3 began writing `AGENTS.md` and a `CLAUDE.md` that imports it into
   * the project root on every dev run and build. Both are generated files in a
   * repo whose `.gitignore` blocks `*.md` precisely so that loose working
   * documents stay out — and a `CLAUDE.md` at the root is read as project
   * instructions by anyone running an AI agent here, which is a surprising
   * thing for a framework upgrade to start doing silently.
   *
   * Set to `true` to opt back in.
   */
  agentRules: false,
  /**
   * Next advertises itself in `X-Powered-By` on every response. It tells an
   * attacker which framework — and by extension which advisory list — to try
   * first, and it buys nothing in return. Cheapest hardening there is.
   */
  poweredByHeader: false,
  reactStrictMode: true,
  distDir: DIST_DIR,
  // output: 'standalone',
  pageExtensions: ['ts', 'tsx', 'mdx'],
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      /**
       * Listed AFTER the site-wide rule on purpose: Next applies each matching
       * entry in order with `setHeader`, so the later, more specific one
       * replaces what the first set for the same key.
       */
      {
        source: `/${ADMIN_SEGMENT}`,
        headers: adminSecurityHeaders,
      },
      {
        source: `/${ADMIN_SEGMENT}/:path*`,
        headers: adminSecurityHeaders,
      },
      /**
       * Static assets under `/public` — logos, favicons, the founder photo,
       * the OG background plates.
       *
       * Next serves everything in `/public` with `Cache-Control: public,
       * max-age=0`, so every one of these was re-downloaded on every visit
       * while `/_next/static/*` (which Next fingerprints and marks
       * `immutable`) cached correctly for a year. A whole-site crawl counted
       * ~80 such requests per page load.
       *
       * These filenames carry NO content hash, so `immutable` would be wrong:
       * replacing a logo would leave visitors on the stale one until the TTL
       * expired. A day of browser cache plus a week of `stale-while-revalidate`
       * gets the repeat-visit win while keeping a brand change visible within
       * a day — and revalidation still returns 304 for unchanged bytes.
       */
      {
        source: '/:path*.(svg|png|jpg|jpeg|gif|webp|avif|ico|webmanifest)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
    ];
  },
  /**
   * The home copy lives in the CMS page with slug `home`, whose own URL would be
   * `/home` (or `/<locale>/home`). The home itself is `/` (or `/<locale>`), so
   * those URLs only ever redirect there — in whichever language is prefixed.
   */
  async redirects() {
    return [
      { source: '/home', destination: '/', permanent: true },
      { source: '/:locale(el|en)/home', destination: '/:locale', permanent: true },
    ];
  },
};

export default withNextIntl(withMDX(nextConfig));
