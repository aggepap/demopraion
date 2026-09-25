/** Admin: edit or remove a shipping method. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { shippingMethodsRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const routes = shippingMethodsRoute();
const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'commerce');

export async function PATCH(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  if (!(await enabled())) return off();
  return routes.PATCH(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  if (!(await enabled())) return off();
  return routes.DELETE(req, ctx);
}
