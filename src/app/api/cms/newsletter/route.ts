/**
 * Admin subscriber list. Gated by the newsletter module (404 when off) and by
 * the `newsletterRead` permission (via the route factory's guard).
 *
 * A static segment, so it takes precedence over the `[collection]` catch-all
 * that serves document collections — the same arrangement as `/api/cms/reviews`.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { subscribersListRoute } from '@/cms/modules/newsletter';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const list = subscribersListRoute();

export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'newsletter'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return list(req);
}
