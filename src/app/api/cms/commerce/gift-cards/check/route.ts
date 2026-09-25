/** Public: what is left on a gift card. Rate limited — a code is money. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { giftCardCheckRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'commerce');

const handler = giftCardCheckRoute();

export async function POST(req: NextRequest) {
  if (!(await enabled())) return off();
  return handler(req);
}
