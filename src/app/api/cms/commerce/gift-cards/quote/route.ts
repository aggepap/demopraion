/** Public: what these codes would cover on this order. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { giftCardQuoteRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'commerce');

const handler = giftCardQuoteRoute();

export async function POST(req: NextRequest) {
  if (!(await enabled())) return off();
  return handler(req);
}
