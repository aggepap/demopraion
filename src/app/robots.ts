import type { MetadataRoute } from 'next';

import { isProductionHost } from '@/cms/core/paths';
import { settingLines } from '@/cms/core/seo/setting-lines';
import { SITE_URL } from '@/lib/seo/schemas';
import config from '@/site.config';

/**
 * AI answer-engine crawlers we explicitly welcome. Listed by user-agent
 * so the site signals priority access (the same rules already apply via
 * the `*` wildcard, but an explicit allow is the recommended pattern for
 * AEO-positioned sites in 2026).
 *
 * Coverage matches the four major answer engines — ChatGPT (OpenAI), Claude (Anthropic), Perplexity, and
 * Google's AI Overviews surface (which respects the Google-Extended
 * directive separately from Googlebot).
 */
const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
];

/**
 * Production gate. `NEXT_PUBLIC_SITE_URL` is inlined at build time, so
 * any deploy that doesn't point at the canonical production origin
 * (staging URLs, preview builds, accidental dev builds) ships a noindex
 * robots.txt. Without this gate, every non-prod build was emitting the
 * same `Allow: /` + sitemap host as production — a regular source of
 * duplicate-content / indexation surprises.
 */
const IS_PRODUCTION_HOST = isProductionHost(SITE_URL, config.productionOrigin);

/** The two paths that are blocked whatever the admin has configured. */
const ALWAYS_DISALLOW = ['/api/', '/admin/'];

/**
 * Assemble the rule list, given the extra paths the admin added on Settings → SEO.
 *
 * Pure and exported so it can be tested: the production gate below reads
 * `NEXT_PUBLIC_SITE_URL`, which is inlined at build time, so a request cannot flip
 * it and an HTTP-level test can never observe this branch on a dev host. That is
 * also how the setting came to be read by nobody at all without anyone noticing
 * (F-059) — the wiring lived somewhere nothing could look at it.
 *
 * The additions apply to every user-agent rule, not only the wildcard one: a path
 * worth hiding from a search engine is worth hiding from an answer engine, and
 * naming the AI crawlers explicitly would otherwise hand them access the wildcard
 * rule denies.
 */
export function robotsRules(extraDisallow: readonly string[]): MetadataRoute.Robots['rules'] {
  const disallow = [
    ...ALWAYS_DISALLOW,
    ...extraDisallow.filter((path) => !ALWAYS_DISALLOW.includes(path)),
  ];
  return [
    { userAgent: '*', allow: '/', disallow },
    ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: '/', disallow })),
  ];
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!IS_PRODUCTION_HOST) {
    return {
      rules: [
        {
          userAgent: '*',
          disallow: '/',
        },
      ],
      host: SITE_URL,
    };
  }

  return {
    rules: robotsRules(await settingLines('seo.robotsExtraDisallow')),
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
