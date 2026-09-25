/** Begin connecting a Google Business Profile account. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { googleOauthStartRoute } from '@/cms/modules/reviews-external';
import { siteOrigin } from '@/cms/core';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'googleReviews');

const redirectUri = `${siteOrigin()}/api/cms/integrations/google/oauth/callback`;
const handler = googleOauthStartRoute({ redirectUri });

export async function POST(req: NextRequest) {
  if (!(await enabled())) return off();
  return handler(req);
}
