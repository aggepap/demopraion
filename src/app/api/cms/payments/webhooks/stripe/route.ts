/**
 * Stripe's webhook endpoint. One URL for the whole site — which module an event
 * belongs to travels with the payment and comes back in its metadata.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { stripeWebhookRoute } from '@/cms/core/payments/webhooks';
// Side effect: attaches Stripe and PayPal to the provider registry.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = stripeWebhookRoute();

export async function POST(req: NextRequest) {
  // Gated on BOTH modules: the endpoint serves orders and reservations alike,
  // so it only disappears when neither feature is switched on.
  const [commerce, booking] = await Promise.all([
    isModuleEnabled(config, 'commerce'),
    isModuleEnabled(config, 'booking'),
  ]);
  if (!commerce && !booking) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
