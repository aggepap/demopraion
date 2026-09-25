/** Record a payment that arrived out of band — a bank transfer, cash on arrival. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { recordPaymentRoute } from '@/cms/modules/booking';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params?: Promise<Record<string, string>> };
const handler = recordPaymentRoute();

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!(await isModuleEnabled(config, 'booking'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req, ctx);
}
