/**
 * Refund an order payment through the provider that took it.
 * Permission-guarded inside the factory (`ordersWrite`).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { orderRefundRoute } from '@/cms/modules/commerce';
// Side effect: attaches Stripe and PayPal to the provider registry.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params?: Promise<Record<string, string>> };

const handler = orderRefundRoute();

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req, ctx);
}
