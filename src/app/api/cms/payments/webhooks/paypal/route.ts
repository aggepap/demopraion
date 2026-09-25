/**
 * PayPal's webhook endpoint. One URL for the whole site — which module an event
 * belongs to travels with the payment as `custom_id` and comes back on it.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { paypalWebhookRoute } from '@/cms/core/payments/webhooks';
// Side effect: attaches Stripe and PayPal to the provider registry.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = paypalWebhookRoute();

export async function POST(req: NextRequest) {
  const [commerce, booking] = await Promise.all([
    isModuleEnabled(config, 'commerce'),
    isModuleEnabled(config, 'booking'),
  ]);
  if (!commerce && !booking) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
