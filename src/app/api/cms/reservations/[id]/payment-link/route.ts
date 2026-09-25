/** Issue and email a payment link. Re-issuing kills the previous one. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { paymentLinkRoute } from '@/cms/modules/booking';
// Side effect: attaches Stripe and PayPal to the provider registry. Next builds
// one module graph per route bundle, so each route that resolves a provider
// must import this itself.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params?: Promise<Record<string, string>> };
const handler = paymentLinkRoute({ defaultLocale: config.defaultLocale });

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!(await isModuleEnabled(config, 'booking'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req, ctx);
}
