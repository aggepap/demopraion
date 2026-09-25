/**
 * Public abandoned-cart endpoints (addendum §9): POST captures the checkout
 * cart; GET recovers one by token. Gated by the commerce module (404 when off).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { createCaptureRoute, createRecoverRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const capture = createCaptureRoute({ defaultLocale: config.defaultLocale });
const recover = createRecoverRoute();
const notFoundRes = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) return notFoundRes();
  return capture(req);
}

export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) return notFoundRes();
  return recover(req);
}
