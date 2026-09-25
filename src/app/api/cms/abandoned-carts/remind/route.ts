/**
 * Run the abandoned-cart reminder job (addendum §9). Authorised by the
 * `x-cron-secret` header (`COMMERCE_CRON_SECRET`) for an external cron, or an
 * admin `ordersWrite` session for the "Send reminders" button. Module-gated.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { abandonedRemindRoute } from '@/cms/modules/commerce';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const remind = abandonedRemindRoute({ defaultLocale: config.defaultLocale });

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return remind(req);
}
