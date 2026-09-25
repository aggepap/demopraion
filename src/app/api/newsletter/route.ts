/**
 * Public newsletter signup — the footer band and every article sidebar card.
 *
 * Lives at `/api/newsletter` rather than under `/api/cms/*` for the same reason
 * `/api/contact` does: this is the site's own form endpoint, and `/api/cms/*`
 * is the admin surface. It also keeps the path clear of the admin list route's
 * `[id]` segment.
 *
 * Gated on the module flag: with `newsletter` off, the forms are not meant to
 * be collecting anything, and answering 404 is what makes the toggle real
 * rather than decorative.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { newsletterSubscribeRoute } from '@/cms/modules/newsletter';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = newsletterSubscribeRoute({ defaultLocale: config.defaultLocale });

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'newsletter'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
