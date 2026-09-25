/** Admin: hide or show one synced review. Its text is never editable. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { reviewHideRoute } from '@/cms/modules/reviews-external';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'googleReviews');

const handler = reviewHideRoute();

export async function PATCH(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  if (!(await enabled())) return off();
  return handler(req, ctx);
}
