/**
 * Admin-side pricing-config check, called by the experience editor so a broken
 * config surfaces in the form rather than as "price on request" on the live
 * site. Advisory: the quote engine refuses a broken config either way.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { bookingValidatePricingRoute } from '@/cms/modules/booking';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = bookingValidatePricingRoute({ defaultLocale: config.defaultLocale });

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'booking'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
