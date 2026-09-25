/**
 * Delete one abandoned cart. Gated by the commerce module (404 when off) and by
 * the `ordersWrite` permission (via the route factory's guard).
 *
 * Module-gated the same way its list sibling is: a site with commerce switched
 * off has no carts, and an endpoint that answers about a disabled module tells a
 * caller the module exists.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { abandonedDeleteRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const del = abandonedDeleteRoute();

export async function DELETE(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return del(req, ctx);
}
