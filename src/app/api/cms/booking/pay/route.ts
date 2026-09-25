/**
 * The payment link's endpoint. A wrong token, an expired one and an unknown
 * reference all 404 identically — the difference is not the customer's to learn.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { bookingPayGetRoute, bookingPayStartRoute } from '@/cms/modules/booking';
// Side effect: attaches Stripe and PayPal to the provider registry. Next builds
// one module graph per route bundle, so each route that resolves a provider
// must import this itself.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const get = bookingPayGetRoute();
const post = bookingPayStartRoute({ defaultLocale: config.defaultLocale });
const notFoundRes = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'booking'))) return notFoundRes();
  return get(req);
}

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'booking'))) return notFoundRes();
  return post(req);
}
