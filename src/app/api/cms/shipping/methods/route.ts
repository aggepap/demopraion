/** Admin: create a shipping method. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { shippingMethodsRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const routes = shippingMethodsRoute();

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return routes.POST(req);
}
