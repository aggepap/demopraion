import { draftMode } from 'next/headers';
import { redirect } from 'next/navigation';
import { type NextRequest, NextResponse } from 'next/server';

import { safeRedirectPath } from '@/cms/core/paths';
import { PERMISSIONS, requireApiPerm } from '@/cms/modules/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Enable Next.js Draft Mode, then redirect to the target page — which will
 * then render the latest draft via `resolveRenderDoc`. Admin-only.
 * Usage: /api/cms/preview?redirect=/insights/answers/some-slug
 */
export async function GET(req: NextRequest) {
  // Draft mode shows unpublished content, so it needs read rights on content —
  // not merely a valid session. Both shipped roles already have it, so nothing
  // changes today; it stops the guard drifting from its intent the moment a
  // narrower role (commerce-only, forms-only) is added.
  const auth = await requireApiPerm(PERMISSIONS.contentRead);
  if (auth instanceof NextResponse) return auth;

  (await draftMode()).enable();
  redirect(safeRedirectPath(req.nextUrl.searchParams.get('redirect')));
}
