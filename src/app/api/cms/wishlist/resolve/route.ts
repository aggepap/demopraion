/**
 * Saved product ids in, current price and stock out. Public: a guest's wishlist
 * lives in their own browser. 404s unless commerce AND the wishlist are on.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { wishlistResolveRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = wishlistResolveRoute({ defaultLocale: config.defaultLocale });

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
