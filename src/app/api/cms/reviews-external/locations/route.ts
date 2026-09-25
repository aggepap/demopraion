/** Admin: the places reviews are pulled from. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { reviewLocationsRoute } from '@/cms/modules/reviews-external';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'googleReviews');

const routes = reviewLocationsRoute();

export async function GET(req: NextRequest) {
  if (!(await enabled())) return off();
  return routes.GET(req);
}

export async function POST(req: NextRequest) {
  if (!(await enabled())) return off();
  return routes.POST(req);
}
