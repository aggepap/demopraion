import { draftMode } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { safeRedirectPath } from '@/cms/core/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Exit Draft Mode and return to the given page. Open (turning preview off is
 *  harmless). Usage: /api/cms/preview/disable?redirect=/insights */
export async function GET(req: NextRequest) {
  (await draftMode()).disable();
  redirect(safeRedirectPath(req.nextUrl.searchParams.get('redirect')));
}
