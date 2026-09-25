/**
 * Public availability calendar. Each day carries a machine-readable reason, so
 * the date picker can explain why a day is closed rather than just greying it.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { bookingAvailabilityRoute } from '@/cms/modules/booking';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = bookingAvailabilityRoute({ defaultLocale: config.defaultLocale });

export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'booking'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
