/**
 * Viva.com's webhook endpoint.
 *
 * The only webhook route that answers GET: Viva verifies an endpoint by GETting
 * it and expecting its verification key back, once, when the webhook is
 * registered in the Viva portal.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { vivaWebhookKeyRoute, vivaWebhookRoute } from '@/cms/core/payments/webhooks';
// Side effect: attaches Stripe, PayPal and Viva to the provider registry.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const post = vivaWebhookRoute();
const get = vivaWebhookKeyRoute();

/** Gated on BOTH modules — this endpoint serves orders and reservations alike. */
async function enabled(): Promise<boolean> {
  const [commerce, booking] = await Promise.all([
    isModuleEnabled(config, 'commerce'),
    isModuleEnabled(config, 'booking'),
  ]);
  return commerce || booking;
}

const notFoundRes = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

export async function GET(req: NextRequest) {
  if (!(await enabled())) return notFoundRes();
  return get(req);
}

export async function POST(req: NextRequest) {
  if (!(await enabled())) return notFoundRes();
  return post(req);
}
