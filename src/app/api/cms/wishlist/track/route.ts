/**
 * The anonymous "added to wishlist" counter: one number per product per day,
 * with nothing about who added it.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { wishlistTrackRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = wishlistTrackRoute();

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
