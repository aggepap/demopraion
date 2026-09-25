/** Admin: "Sync now". The nightly run is the `google-reviews-sync` cron job. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { reviewSyncRoute } from '@/cms/modules/reviews-external';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'googleReviews');

const handler = reviewSyncRoute();

export async function POST(req: NextRequest) {
  if (!(await enabled())) return off();
  return handler(req);
}
