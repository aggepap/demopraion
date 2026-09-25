/**
 * Orders CSV export. Gated by the commerce module (404 when off) and by
 * `ordersRead` (via the route factory's guard).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { orderExportRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = orderExportRoute();

export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
