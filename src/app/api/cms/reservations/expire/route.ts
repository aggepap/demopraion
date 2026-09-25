/**
 * Sweep lapsed enquiries and abandoned payment holds. Authenticated by
 * `x-cron-secret` for a scheduler, or an admin session for a human.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { bookingExpireRoute } from '@/cms/modules/booking';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = bookingExpireRoute();

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'booking'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
