/**
 * Public shipping estimate for the checkout. Gated by the commerce module.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { createShippingQuoteRoute } from '@/cms/modules/commerce';
// Side effect: attaches Stripe, PayPal and Viva to the provider registry. Next
// builds one module graph per route bundle, so without it the configured
// provider resolved to `manual` here and the estimate's surcharge (and COD
// rule) could differ from checkout's.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = createShippingQuoteRoute();

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
