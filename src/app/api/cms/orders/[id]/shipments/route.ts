/** Admin: an order's parcels, and creating or recording one. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { orderShipmentsListRoute, orderShipmentsRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const list = orderShipmentsListRoute();
const handler = orderShipmentsRoute();
const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'commerce');

export async function GET(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  if (!(await enabled())) return off();
  return list(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  if (!(await enabled())) return off();
  return handler(req, ctx);
}
