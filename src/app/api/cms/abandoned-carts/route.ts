/**
 * Admin abandoned-cart list. Gated by the commerce module (404 when off) and by
 * the `ordersRead` permission (via the route factory's guard).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { abandonedListRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const list = abandonedListRoute();

export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return list(req);
}
