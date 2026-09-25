/** Anonymous popup counters: impressions, clicks and closes. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { popupTrackRoute } from '@/cms/modules/popups';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = popupTrackRoute();

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'popups'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
