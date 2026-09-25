/**
 * Refund a reservation payment through the provider that took it.
 * Permission-guarded inside the factory (`reservationsWrite`).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { refundReservationRoute } from '@/cms/modules/booking';
// Side effect: attaches Stripe and PayPal to the provider registry.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params?: Promise<Record<string, string>> };

const handler = refundReservationRoute();

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!(await isModuleEnabled(config, 'booking'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req, ctx);
}
