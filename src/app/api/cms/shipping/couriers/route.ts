/**
 * Admin: courier credentials (BoxNow). Write-only — the list says whether each
 * is set and shows at most its last four characters, never the value.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { courierCredentialsRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const routes = courierCredentialsRoute();
const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'commerce');

export async function GET(req: NextRequest) {
  if (!(await enabled())) return off();
  return routes.GET(req);
}

export async function POST(req: NextRequest) {
  if (!(await enabled())) return off();
  return routes.POST(req);
}
