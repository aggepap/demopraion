/**
 * Public price preview. Gated by the booking module: with booking off the route
 * 404s, like the pages that call it.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { bookingQuoteRoute } from '@/cms/modules/booking';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = bookingQuoteRoute({ defaultLocale: config.defaultLocale });

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'booking'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
