/**
 * One of the signed-in customer's saved addresses: edit it, or delete it.
 * Gated by the `customers` module: 404 everywhere when it is off.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { customerAddressRoute } from '@/cms/modules/customers';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = customerAddressRoute();
const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'customers');

export async function PATCH(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  if (!(await enabled())) return off();
  return handlers.PATCH(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  if (!(await enabled())) return off();
  return handlers.DELETE(req, ctx);
}
