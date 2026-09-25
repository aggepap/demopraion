/**
 * The signed-in customer's own orders.
 * Gated by the `customers` module: 404 everywhere when it is off.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { customerOrdersRoute } from '@/cms/modules/customers';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = customerOrdersRoute();
const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'customers');

export async function GET(req: NextRequest) {
  if (!(await enabled())) return off();
  return handler(req);
}
