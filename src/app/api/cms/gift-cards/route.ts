/** Admin: the gift card list, and issuing one by hand. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { giftCardsListRoute, giftCardWriteRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'commerce');

const list = giftCardsListRoute();
const write = giftCardWriteRoute({ defaultLocale: config.defaultLocale });

export async function GET(req: NextRequest) {
  if (!(await enabled())) return off();
  return list(req);
}

export async function POST(req: NextRequest) {
  if (!(await enabled())) return off();
  return write.POST(req);
}
