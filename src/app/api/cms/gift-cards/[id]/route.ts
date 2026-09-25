/** Admin: one gift card's history, and voiding or restoring it. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { giftCardHistoryRoute, giftCardWriteRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'commerce');

const history = giftCardHistoryRoute();
const write = giftCardWriteRoute({ defaultLocale: config.defaultLocale });

export async function GET(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  if (!(await enabled())) return off();
  return history(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  if (!(await enabled())) return off();
  return write.PATCH(req, ctx);
}
