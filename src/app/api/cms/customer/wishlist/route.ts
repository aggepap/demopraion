/**
 * The signed-in customer's wishlist, which follows them between devices.
 * Needs both the commerce and customers modules.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { customerWishlistRoutes } from '@/cms/modules/commerce';
import { resolveCheckoutCustomerId } from '@/cms/modules/customers';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const routes = customerWishlistRoutes({
  currentCustomerId: resolveCheckoutCustomerId,
  defaultLocale: config.defaultLocale,
});

const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = async () =>
  (await isModuleEnabled(config, 'commerce')) && (await isModuleEnabled(config, 'customers'));

export async function GET(req: NextRequest) {
  if (!(await enabled())) return off();
  return routes.GET(req);
}

export async function POST(req: NextRequest) {
  if (!(await enabled())) return off();
  return routes.POST(req);
}
