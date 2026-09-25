/** Google sends the administrator back here with a one-time code. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { googleOauthCallbackRoute } from '@/cms/modules/reviews-external';
import { getAdminPath, siteOrigin } from '@/cms/core';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'googleReviews');

const redirectUri = `${siteOrigin()}/api/cms/integrations/google/oauth/callback`;
const handler = googleOauthCallbackRoute({ redirectUri, adminPath: getAdminPath() });

export async function GET(req: NextRequest) {
  if (!(await enabled())) return off();
  return handler(req);
}
