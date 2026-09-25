/**
 * Product comparison data (addendum §6). `?slugs=a,b,c&locale=` → the compare
 * projection for each. Gated by the commerce module.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { checkRateLimit, getClientIp, isModuleEnabled } from '@/cms/core';
import { getCompareData } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


/**
 * Rate limit, applied by hand because this handler returns its own JSON shape
 * rather than the `createRoute` envelope the storefront's siblings use.
 *
 * Every other public commerce endpoint — shipping-quote, search, review,
 * order-lookup, coupon — passes a `rateLimit` to `createRoute`; these two were
 * the only ones with no cap at all, while each request still runs product
 * queries against the database. That is a free amplifier for anyone who wants
 * to load the site, and the inconsistency was the giveaway.
 */
export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const limit = checkRateLimit('commerce-compare', getClientIp(req), { max: 120, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }
  const url = new URL(req.url);
  const slugs = (url.searchParams.get('slugs') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
  const locale = url.searchParams.get('locale') || config.defaultLocale;
  return NextResponse.json({ ok: true, data: await getCompareData(slugs, locale) });
}
