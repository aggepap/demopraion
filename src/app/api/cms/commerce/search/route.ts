/**
 * Public product search / autocomplete. Gated by the commerce module (404 when
 * off). Read-only + rate-limited (via the factory).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { createProductSearchRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = createProductSearchRoute({ defaultLocale: config.defaultLocale });

export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
