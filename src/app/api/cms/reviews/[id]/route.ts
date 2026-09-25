/**
 * Single review moderation — approve/reject (PATCH) or delete (DELETE). Gated
 * by the commerce module (404 when off) and by `reviewsWrite` (factory guards).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { reviewDeleteRoute, reviewUpdateRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params?: Promise<Record<string, string>> };

const patch = reviewUpdateRoute();
const del = reviewDeleteRoute();
const notFoundRes = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await isModuleEnabled(config, 'commerce'))) return notFoundRes();
  return patch(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!(await isModuleEnabled(config, 'commerce'))) return notFoundRes();
  return del(req, ctx);
}
