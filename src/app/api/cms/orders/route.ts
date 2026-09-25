/**
 * Admin orders list. Gated by the commerce module (404 when off) and by the
 * `ordersRead` permission (via the route factory's guard).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { orderCreateRoute, ordersListRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const list = ordersListRoute();
const create = orderCreateRoute({ defaultLocale: config.defaultLocale });
const notFoundRes = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) return notFoundRes();
  return list(req);
}

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) return notFoundRes();
  return create(req);
}
