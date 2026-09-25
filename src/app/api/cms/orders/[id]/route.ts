/**
 * Single order read + status update. Gated by the commerce module (404 when
 * off) and by `ordersRead`/`ordersWrite` (via the route factories' guards).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { orderGetRoute, orderSaveRoute, orderUpdateRoute } from '@/cms/modules/commerce';
// Side effect: attaches the gateways to the provider registry, so each payment
// in the order panel can say whether it can be refunded online.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params?: Promise<Record<string, string>> };

const get = orderGetRoute();
const patch = orderUpdateRoute();
const put = orderSaveRoute({ defaultLocale: config.defaultLocale });

async function gated() {
  return isModuleEnabled(config, 'commerce');
}
const notFoundRes = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!(await gated())) return notFoundRes();
  return get(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await gated())) return notFoundRes();
  return patch(req, ctx);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!(await gated())) return notFoundRes();
  return put(req, ctx);
}
