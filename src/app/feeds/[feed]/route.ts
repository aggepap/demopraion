/**
 * Public product feeds — `/feeds/skroutz.xml`, `/feeds/bestprice.xml`,
 * `/feeds/shopflix.xml`, `/feeds/google-merchant.xml`.
 *
 * Generated at request time from the published catalog (no rebuild needed when
 * products change) and gated by the commerce module (404 when off). A crawler /
 * marketplace fetches these on a schedule; they cache for an hour.
 *
 * Feeds render in the site's default locale — the Greek marketplaces are a
 * single-locale channel — regardless of the visitor.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { renderFeed, resolveFeedFormat } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFoundRes = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ feed: string }> }) {
  if (!(await isModuleEnabled(config, 'commerce'))) return notFoundRes();

  const { feed } = await ctx.params;
  const format = resolveFeedFormat(feed);
  if (!format) return notFoundRes();

  const { xml, contentType } = await renderFeed(format, config.defaultLocale, {
    storeName: config.name,
    generatedAt: new Date().toISOString(),
  });

  return new NextResponse(xml, {
    headers: {
      'Content-Type': contentType,
      // Marketplaces poll on a schedule; an hour of edge/CDN caching is plenty.
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
