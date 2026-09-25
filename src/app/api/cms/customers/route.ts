/** Admin: shop customer accounts. Gated by the `customers` module. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { customersListRoute } from '@/cms/modules/customers';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const list = customersListRoute();

export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'customers'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return list(req);
}
